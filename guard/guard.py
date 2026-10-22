#!/usr/bin/env python3
# guard.py: SyscallGuard loader and main loop. Runs as root, inside the VM only.
# Track: G1 (guard core)
# Contracts: ARCHITECTURE.md Contract 1 (maps), Contract 2 (policy), Contract 3 (CLI + JSON schema).
#
#   sudo python3 guard/guard.py -p POLICY [--mode audit|enforce] [--debug]
#
# stdout: one JSON object per line, flushed. Every log line goes to stderr.
# Exit codes: 0 clean shutdown on SIGINT/SIGTERM, 2 bad policy, 3 BPF load failure.
import argparse
import ctypes
import json
import logging
import os
import signal
import sys
import time

import events
import policy

BPF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bpf")
SG_MODE = {"audit": 1, "enforce": 2}   # SG_MODE_AUDIT / SG_MODE_ENFORCE in sg_common.h

log = logging.getLogger("guard")
stdout_open = True


def emit(obj):
    """One JSON object per line on stdout, flushed: the bridge reads it as a stream.

    If the bridge is gone, stop emitting but keep running so the hooks stay attached.
    BrokenPipeError must be caught here: bcc's ring-buffer wrapper calls exit() on any
    EPIPE that escapes the callback, which would detach every hook.
    """
    global stdout_open
    if not stdout_open:
        return
    try:
        sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        stdout_open = False
        # Point fd 1 at /dev/null so the exit-time flush of the unsent buffer can't raise.
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
        os.close(devnull)
        log.error("stdout closed (bridge gone?): hooks stay attached, no longer emitting events")


def guard_event(type_, mode, **extra):
    """READY/ERROR come from the guard, not the kernel. They carry all 12 Contract 3 fields:
    the dashboard rejects a partial event, and one in the bridge's `recent` breaks SNAPSHOT."""
    return {"v": 1, "ts": time.time(), "type": type_, "hook": None, "tgid": None,
            "parent_tgid": None, "comm": None, "file": None, "family": None,
            "daddr": None, "dport": None, "mode": mode, **extra}


def load_bpf(pol):
    """Compile and load the kernel program (hooks auto-attach), then fill its maps."""
    from bcc import BPF   # here, so a missing bcc is a load failure like any other: ERROR + exit 3
    b = BPF(src_file=os.path.join(BPF_DIR, "syscallguard.bpf.c"),
            cflags=["-I" + BPF_DIR, "-fms-extensions"])   # 7.x headers need it: docs/shared.md, 2026-10-19

    # Hard order: the kernel treats an unset config (mode 0) as enforce, so the allowlist and
    # the mode must be in place before anything can be tagged. protected_inodes goes last.
    for name, nets in (("allow_v4", pol.allow_v4), ("allow_v6", pol.allow_v6)):
        t = b[name]
        for net in nets:
            k = t.Key()
            k.prefixlen = net.prefixlen
            k.addr = type(k.addr)(*net.network_address.packed)   # network byte order
            t[k] = t.Leaf(1)
    cfg = b["config"]
    cfg[cfg.Key(0)] = cfg.Leaf(SG_MODE[pol.mode])
    prot = b["protected_inodes"]
    for i, ino in enumerate(pol.inodes):   # value = index into pol.protect
        prot[prot.Key(ino)] = prot.Leaf(i)
    log.debug("maps filled: %d allow_v4, %d allow_v6, mode=%s, %d protected",
              len(pol.allow_v4), len(pol.allow_v6), pol.mode, len(pol.inodes))
    return b


def main():
    ap = argparse.ArgumentParser(description="SyscallGuard: load the kernel hooks, print JSON events.")
    ap.add_argument("-p", "--policy", required=True, help="policy TOML file")
    ap.add_argument("--mode", choices=policy.MODES, help="override the policy's mode")
    ap.add_argument("--debug", action="store_true", help="verbose logging on stderr")
    args = ap.parse_args()
    logging.basicConfig(stream=sys.stderr, level=logging.DEBUG if args.debug else logging.INFO,
                        format="guard: %(levelname)s %(message)s")

    try:
        pol = policy.load_policy(args.policy, mode_override=args.mode)
    except policy.PolicyError as e:
        log.error("bad policy: %s", e)
        return 2
    for ino, path in pol.inode_paths.items():
        log.info("protecting ino=%d %s", ino, path)

    # Before the (slow) BPF compile, so Ctrl-C during load still shuts down cleanly.
    stop = []
    signal.signal(signal.SIGINT, lambda signum, _frame: stop.append(signum))
    signal.signal(signal.SIGTERM, lambda signum, _frame: stop.append(signum))

    if os.geteuid() != 0:
        log.warning("not root: loading BPF will fail")
    try:
        b = load_bpf(pol)
    except Exception as e:
        emit(guard_event("ERROR", pol.mode, message=f"BPF load failed: {e}"))
        log.error("BPF load failed: %s", e)
        return 3

    # bpf_ktime_get_ns() is CLOCK_MONOTONIC, so the offset pairs wall time with that clock.
    ctx = events.EventContext(inode_paths=pol.inode_paths,
                              boot_time_epoch=time.time() - time.clock_gettime(time.CLOCK_MONOTONIC),
                              mode=pol.mode)

    def on_event(_cb_ctx, data, size):
        ev = events.decode_event(ctypes.string_at(data, size), ctx)
        if ev is None:
            log.warning("dropped malformed event (%d bytes)", size)
            return
        log.debug("%s tgid=%s comm=%s", ev["type"], ev["tgid"], ev["comm"])
        emit(ev)

    b["events"].open_ring_buffer(on_event)
    emit(guard_event("READY", pol.mode, protect=pol.protect, allow=pol.allow))
    log.info("ready: mode=%s; Ctrl-C to stop", pol.mode)
    while not stop:
        b.ring_buffer_poll(timeout=100)   # wakes every 100 ms to notice a signal
    log.info("signal %d: shutting down, hooks detach on exit", stop[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
