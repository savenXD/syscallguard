#!/usr/bin/env python3
"""attack_matrix.py — automated end-to-end verdict matrix (ROOT).

For each policy mode (audit, enforce) x each agent exfil mode
(direct, curl, udp, b64, preconnect, ipv6), it starts the real guard on a
temp policy, runs agent.py as a FRESH subprocess, and asserts on the
guard's OWN JSON events:

    enforce: TAG + BLOCK (+ ALLOW for the legitimate API call)
    audit:   TAG + WOULD_BLOCK (+ ALLOW)
    curl:    TAG_INHERIT for the curl child (fork inheritance proof)

The exfil target is --target (default 192.168.122.1:9999): the real
attacker.py on the host, which must be running. Its window must show 0 bytes
from the tagged cells in enforce mode. An untagged control connect per policy
mode must SUCCEED (proves it's not a firewall). udp and preconnect need hook C
(socket_sendmsg); until it lands they leak and are reported as XFAIL.

The matrix parent NEVER reads the secret itself, so it never gets tagged;
every agent run is a fresh, cleanly-tagged process — no manual fresh
terminals needed.

Usage:
    sudo python3 tests/attack_matrix.py [--target 192.168.122.1:9999]   # audit + enforce
    sudo python3 tests/attack_matrix.py --quick                          # enforce only
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_PORT = 18081
READY_TIMEOUT = 90        # first bcc compile can be slow
DRAIN_AFTER_AGENT = 4

AGENT_MODES = ("direct", "curl", "udp", "b64", "preconnect", "ipv6")
# modes whose verdict must arrive via the sendmsg hook (their raison d'etre)
SENDMSG_MODES = ("udp", "preconnect")
# Expected to leak until hook C (socket_sendmsg) lands: failures there are XFAIL, not FAIL.
HOOK_C_MODES = SENDMSG_MODES


class Guard:
    """A running guard.py subprocess with its JSON events collected."""

    def __init__(self, policy_path, log_path):
        self.events = []
        self._ready = threading.Event()
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(REPO, "guard", "guard.py"),
             "-p", policy_path],
            stdout=subprocess.PIPE, stderr=open(log_path, "w"),
            text=True, bufsize=1)
        self._thread = threading.Thread(target=self._reader, daemon=True)
        self._thread.start()

    def _reader(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            self.events.append(msg)
            if msg.get("type") == "READY":
                self._ready.set()

    def wait_ready(self):
        return self._ready.wait(READY_TIMEOUT)

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    def for_tgid(self, tgid):
        """Events about tgid or its children."""
        return [e for e in self.events
                if e.get("tgid") == tgid or e.get("parent_tgid") == tgid]


def untagged_control(guard, host, port):
    """An untagged process must reach the target: proves it's not a firewall."""
    guard.events.clear()
    code = (f"import socket; socket.create_connection(({host!r}, {port}), timeout=5)"
            ".sendall(b'untagged-control')")
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=20)
    time.sleep(1)
    verdicts = [e for e in guard.events
                if e.get("type") in ("BLOCK", "WOULD_BLOCK") and e.get("daddr") == host]
    notes = []
    if p.returncode != 0:
        notes.append(f"connect failed: {p.stderr.strip().splitlines()[-1] if p.stderr.strip() else p.returncode}")
    if verdicts:
        notes.append(f"guard emitted {verdicts[0].get('type')} for an untagged process")
    return not notes, notes


def write_secret(tmp):
    """Create the fake secret ONCE, before any guard is running.

    The matrix parent must never open the protected file while a guard
    is alive (hook A tags on *any* open, including write). Creating it
    once up front makes that structural instead of relying on ordering.
    """
    secret = os.path.join(tmp, ".env")
    with open(secret, "w") as f:
        f.write("FAKE-SECRET-FOR-MATRIX\n")
    return secret


def write_policy(tmp, mode, secret):
    pol = os.path.join(tmp, "policy.toml")
    with open(pol, "w") as f:
        f.write(f'mode = "{mode}"\n'
                f'protect = ["{secret}"]\n'
                f'allow = ["127.0.0.0/8", "::1/128"]\n')
    return pol


def main(argv=None):
    ap = argparse.ArgumentParser(description="SyscallGuard attack matrix")
    ap.add_argument("--quick", action="store_true",
                    help="enforce mode only")
    ap.add_argument("--target", default="192.168.122.1:9999", metavar="HOST:PORT",
                    help="exfil destination: the host's attacker.py (default 192.168.122.1:9999)")
    args = ap.parse_args(argv)
    attacker_ip, _, port = args.target.rpartition(":")
    if not attacker_ip or not port.isdigit():
        ap.error("--target must be HOST:PORT")
    attacker_port = int(port)

    if os.geteuid() != 0:
        print("FAIL: must run as root: sudo python3 tests/attack_matrix.py",
              file=sys.stderr)
        return 1

    modes = ["enforce"] if args.quick else ["audit", "enforce"]
    results = []  # (policy_mode, agent_mode, ok|None, notes)

    print(f"attacker target: {attacker_ip}:{attacker_port} (attacker.py on the host must be running)")

    tmp = tempfile.mkdtemp(prefix="sg_matrix_")
    secret = write_secret(tmp)  # before any guard exists; never touched again
    api = subprocess.Popen(
        [sys.executable, os.path.join(REPO, "demo", "internal_api.py"),
         "--host", "127.0.0.1", "--port", str(API_PORT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)

    try:
        for pmode in modes:
            pol = write_policy(tmp, pmode, secret)
            guard = Guard(pol, os.path.join(tmp, f"guard-{pmode}.log"))
            if not guard.wait_ready():
                print(f"FAIL: guard did not become READY in {pmode} mode")
                guard.stop()
                return 1
            print(f"== policy mode: {pmode} ==")
            ok, notes = untagged_control(guard, attacker_ip, attacker_port)
            print(f"  [{'PASS' if ok else 'FAIL'}] untagged control (must connect)"
                  + ("" if ok else f"  <-- {'; '.join(notes)}"))
            results.append((pmode, "untagged-control", ok, notes))

            for amode in AGENT_MODES:
                guard.events.clear()
                agent = subprocess.Popen(
                    [sys.executable, os.path.join(REPO, "demo", "agent.py"),
                     "--mode", amode, "--env", secret,
                     "--attacker", attacker_ip, "--port", str(attacker_port),
                     "--api", f"http://127.0.0.1:{API_PORT}"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True)
                agent_pid = agent.pid
                try:
                    stdout, _ = agent.communicate(timeout=90)
                except subprocess.TimeoutExpired:
                    agent.kill()
                    stdout, _ = agent.communicate()
                time.sleep(DRAIN_AFTER_AGENT)
                evs = guard.for_tgid(agent_pid)
                by_type = {}
                for e in evs:
                    by_type.setdefault(e.get("type"), []).append(e)

                notes, ok = [], True

                def need(name, cond, hint=""):
                    nonlocal ok
                    if not cond:
                        ok = False
                        notes.append(f"missing {name} {hint}".strip())

                need("TAG", len(by_type.get("TAG", [])) > 0)
                verdict = "BLOCK" if pmode == "enforce" else "WOULD_BLOCK"
                # Match the exfil verdict by DESTINATION across the whole
                # cell's event window (guard.events was cleared at cell
                # start). Tgid linkage alone isn't enough: curl re-tags
                # itself via hook A when it opens the .env for
                # --data-binary, so its BLOCK/WOULD_BLOCK carries
                # parent_tgid=None and never lands in the tgid-filtered
                # `evs` list.
                cell_hits = [e for e in guard.events
                             if e.get("type") == verdict
                             and e.get("daddr") == attacker_ip]
                need(verdict, len(cell_hits) > 0)
                if amode in SENDMSG_MODES:
                    need(f"{verdict} via sendmsg",
                         any(e.get("hook") == "sendmsg" for e in cell_hits))
                need("ALLOW for internal API",
                     any(e.get("daddr") == "127.0.0.1"
                         for e in by_type.get("ALLOW", [])))
                if amode == "curl":
                    need("TAG_INHERIT for curl child",
                         any(e.get("parent_tgid") == agent_pid
                             for e in by_type.get("TAG_INHERIT", [])))
                # The EPERM lands in the curl *child*, which the agent
                # can't see — the guard's BLOCK event is the proof there.
                if pmode == "enforce" and amode != "curl":
                    need("agent reported BLOCKED",
                         "BLOCKED by the guard" in stdout)
                xfail = not ok and amode in HOOK_C_MODES
                status = "PASS" if ok else ("XFAIL" if xfail else "FAIL")
                print(f"  [{status}] {amode:10s} "
                      f"{' '.join(sorted(by_type))}"
                      + ("" if ok else f"  <-- {'; '.join(notes)}")
                      + ("  (expected to leak until hook C)" if xfail else ""))
                if not ok and not xfail:
                    for line in stdout.strip().split("\n")[-5:]:
                        print(f"      | {line}")
                    # diagnostic: dump every event seen this cell, plus any
                    # BLOCK/WOULD_BLOCK in the whole run that didn't match
                    print(f"      # matched events: {len(evs)}, "
                          f"total this guard run: {len(guard.events)}")
                    for e in guard.events:
                        if e.get("type") in ("BLOCK", "WOULD_BLOCK"):
                            m = "MATCHED" if e in evs else "stray"
                            print(f"      # {m} {e.get('type')} hook={e.get('hook')} "
                                  f"tgid={e.get('tgid')} parent={e.get('parent_tgid')} "
                                  f"daddr={e.get('daddr')}:{e.get('dport')}")
                results.append((pmode, amode, None if xfail else ok,
                                ["expected to leak until hook C"] if xfail else notes))

            guard.stop()
    finally:
        api.terminate()

    ran = [r for r in results if r[2] is not None]
    passed = sum(1 for _, _, ok, _ in ran if ok)
    xfails = [r for r in results if r[2] is None]
    print(f"== {passed}/{len(ran)} cells passed"
          + (f", {len(xfails)} XFAIL (udp/preconnect leak until hook C)" if xfails else "") + " ==")
    for pmode, amode, ok, notes in results:
        if ok is False:
            print(f"  FAIL {pmode}/{amode}: {'; '.join(notes)}")
    return 0 if passed == len(ran) else 1


if __name__ == "__main__":
    raise SystemExit(main())
