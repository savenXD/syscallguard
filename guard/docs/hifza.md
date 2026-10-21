# Hifza: Track G1, guard core (`guard/guard.py`, `guard/policy.py`)

## 1. Your part, in plain words

Think of the server as an office building and every running program as a person inside it. SyscallGuard is a guard at the exit doors: anyone who touched a confidential file gets a stamp on their hand, and a stamped person may only go to approved rooms.

Azaan builds the guard itself (kernel code). You are the one who **briefs the guard and starts the shift**. `guard.py` reads the policy (which files are confidential, which rooms are approved, audit or enforce), loads Azaan's kernel program, hands it those lists, announces "on duty" (`READY`), and then relays every report the guard makes out to the rest of the system as one JSON line each. When you stop `guard.py`, the guard goes home: every hook detaches. That's the safety valve.

`policy.py` is the briefing check: it refuses a bad policy loudly (exit code 2) instead of starting a guard with the wrong instructions.

## 2. Where it sits

```
 policy/policy.toml ──▶ policy.py ──▶ guard.py ──loads──▶ syscallguard.bpf.c (Azaan)
                                         │  fills: protected_inodes, allow_v4, allow_v6, config
                                         │
                       kernel hooks ──▶ events ring buffer
                                         │ raw bytes
                                         ▼
                   guard.py poll loop ──▶ events.decode_event (Divyanshu) ──▶ dict
                                         │ json.dumps, one line, flush
                                         ▼
                                      stdout ──pipe──▶ bridge.py (Divyanshu)
                                      stderr ──▶ your terminal (logs)
```

## 3. Files you own

- `guard/guard.py`: CLI, loader, map population, poll loop, shutdown
- `guard/policy.py`: parse and validate the policy file
- `tests/test_policy.py`: unit tests for your validation
- `guard/docs/hifza.md`: this file (sections 6, 9, 10 only, during development)
- `policy/docs/hifza.md`: your policy schema notes
- Shared: the **schema and validation** of `policy/` is yours; Suyash keeps `policy/policy.example.toml` correct for the VM.

Do not edit: `guard/bpf/` (Azaan), `guard/events.py`, `bridge/` (Divyanshu), `dashboard/` (Devansh), `demo/`, `scripts/`, `tests/attack_matrix.py` (Suyash).

## 4. What to build

### `guard/policy.py`

- Parse with `tomllib` (stdlib, Python 3.11+).
- Keys: `mode`, `protect`, `allow` (see Contract 2 excerpt).
- Validate:
  - `mode` ∈ {`audit`, `enforce`}. A CLI `--mode` overrides the file.
  - every `protect` path is absolute and exists. Use `os.stat` (follows symlinks, so we protect the real file). Keep `st_ino` for each.
  - every `allow` entry parses with `ipaddress.ip_network(entry, strict=False)`. Split into IPv4 and IPv6 networks.
- On any error: one clear message to **stderr** naming the bad key/value, then exit **2**.
- Exact function names and return type inside `policy.py` are yours to choose; nothing outside `guard/` calls it except `tests/test_policy.py`. If you change them after tests exist, add a `signature` entry to `docs/shared.md`.

### `guard/guard.py`

CLI (Contract 3):

```
sudo python3 guard/guard.py -p policy/policy.toml [--mode audit|enforce] [--debug]
```

Startup, in order:

1. Parse args, load and validate the policy (exit 2 on error). `--debug` turns on verbose logging, to stderr only.
2. Load the BPF program:
   `BPF(src_file=<abs path>/guard/bpf/syscallguard.bpf.c, cflags=["-I<abs path to guard/bpf>"])`. Build paths from `__file__` so it works from any working directory. LSM, tracepoint and raw-tracepoint probes auto-attach on load. If loading fails (compile error, verifier rejection), write an `ERROR` event with `"message"` = the bcc error to stdout, then exit **3**.
3. Fill maps (names are Contract 1):
   - `protected_inodes`: key `st_ino` (u64), value = index into the policy `protect` list (u32).
   - `allow_v4` / `allow_v6`: one LPM entry per network. Key `prefixlen` = `net.prefixlen`, `addr` = `net.network_address.packed`. The value (u8) is unused by `check_dest`, only a hit matters.
   - `config[0].mode` = `SG_MODE_AUDIT` (1) or `SG_MODE_ENFORCE` (2).
4. Build the `EventContext` for Divyanshu's decoder (see `guard/docs/divyanshu.md`):
   - `inode_paths`: `{st_ino: path}` from the policy.
   - `boot_time_epoch`: `bpf_ktime_get_ns()` is CLOCK_MONOTONIC, so `time.time() - time.monotonic()`.
   - `mode`: the effective mode after `--mode` override.
5. Emit `READY` with `"protect": [...]` and `"allow": [...]`. `comm` is `null` on `READY` and `ERROR`.
6. Open the ring buffer: `b["events"].open_ring_buffer(callback)`, then loop `b.ring_buffer_poll()` forever. In the callback, copy the bytes with `ctypes.string_at(data, size)`, call `decode_event(raw, ctx)`; if it returns a dict, write `json.dumps(d)` + newline to stdout and flush; if `None`, drop it.

Shutdown: on SIGINT and SIGTERM, leave the loop and exit **0**. All hooks detach when the process exits.

Exit codes: `0` clean shutdown, `2` bad policy, `3` BPF load failure.

Output rule: **stdout carries JSON lines only**, one object per line, flushed after each. Every log, warning and debug message goes to stderr. Anything else on stdout breaks the bridge.

## 5. Contract excerpts

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 2: Policy file"):

> Parsing (`guard/policy.py`): use `tomllib`. Validate that `mode` ∈ {audit, enforce}; that every `protect` path is absolute and exists (`os.stat`, which follows symlinks, so we protect the real file); and that every `allow` entry parses with `ipaddress.ip_network(strict=False)`. On any error, print a clear message to stderr and exit 2. A CLI `--mode` flag overrides the file. A missing `mode` means `audit`. `protect` must be non-empty; `allow` may be empty (a tagged process then reaches nothing, useful for testing). Unknown keys are rejected. Map-size limits are not checked.

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 3: Guard CLI and JSON event schema"):

> - Loads the BPF program, fills `protected_inodes` (`st_ino`), `allow_v4`/`allow_v6` and `config`, emits `READY`, then polls the ring buffer forever.
> - On SIGINT/SIGTERM, exits cleanly. All hooks detach when the process exits; this is the safety valve.
> - Exit codes: `0` clean shutdown on SIGINT/SIGTERM, `2` bad policy, `3` BPF load failure (an `ERROR` event is written to stdout first). `--debug` only adds verbose logging on stderr.
> - **Stdout = one JSON object per line, flushed after each line.** Nothing else goes to stdout.

> The `READY` event also carries `"protect": [...]` and `"allow": [...]`. The `ERROR` event carries `"message": "..."`.

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 1: Kernel structs and maps"), the maps you write:

| Name | bcc declaration | Written by |
|---|---|---|
| `protected_inodes` | `BPF_HASH(protected_inodes, u64, u32, 256)` | guard.py at startup (value = index into policy `protect` list) |
| `allow_v4` | `BPF_LPM_TRIE(allow_v4, struct sg_lpm_v4, u8, 1024)` | guard.py |
| `allow_v6` | `BPF_LPM_TRIE(allow_v6, struct sg_lpm_v6, u8, 1024)` | guard.py |
| `config` | `BPF_ARRAY(config, struct sg_config, 1)` | guard.py |

The full JSON field table is in ARCHITECTURE.md, Contract 3. Divyanshu's decoder produces every event except `READY` and `ERROR`, which you build.

## 6. Your milestones

- [ ] **M1 Tagging** (K + G, 18–19 Oct): Guard starts in audit mode and prints `READY`; `cat demo/project/.env` → `TAG` event for `cat`; `sudo bpftool map dump name tagged` shows the entry
- [ ] **M3 Connect enforcement** (K + G, 19 Oct): Enforce mode: tagged `agent.py --exfil direct` → `PermissionError` + `BLOCK`; its POST to 127.0.0.1:8080 succeeds with `ALLOW`; an untagged `python3 -c` connect to the attacker succeeds; audit mode → all succeed + `WOULD_BLOCK`

**Start now:** `policy.py` and its validation are **done** (see section 10): parsing, validation and the CLI are implemented and tested on any machine, no VM needed. Next is `guard/guard.py` -- CLI, BPF load, map population, `READY` emission, poll loop and signal handling. Use Azaan's 2026-10-19 correction when loading: `cflags=["-I" + <abs path to guard/bpf>, "-fms-extensions"]`.
**Blocked by:** Contract 1 is agreed and Azaan's maps are already in `guard/bpf/syscallguard.bpf.c` (`protected_inodes`, `allow_v4`, `allow_v6`, `config` from section 5, plus Azaan's `tagged` and the `events` ring buffer), together with hook A (file_open tagging), fork/exit inheritance and hook B (socket_connect). Still outstanding: **hook C** (`socket_sendmsg`) exists only as a comment in the `.bpf.c` and is needed for M3's `ALLOW` event on the POST to 127.0.0.1:8080; and **Divyanshu's `guard/events.py`** is still a TODO stub with no `decode_event`, which the poll loop needs (stub it with `None` until it lands).
**You block:** Azaan (your loader is how his hooks get tested), Divyanshu's bridge real mode (M5 real), Suyash's attack matrix (M6).

## 7. How to run and test your part

Without the VM (any machine):

```bash
python3 -m unittest tests/test_policy.py
python3 -c "import sys; sys.path.insert(0,'guard'); import policy"   # imports cleanly, no bcc needed
```

`policy.py` must not import `bcc`, so it stays testable anywhere.

In the VM:

```bash
cp policy/policy.example.toml policy/policy.toml          # fix protect path for the VM
sudo python3 guard/guard.py -p policy/policy.toml --mode audit
# expected first stdout line: {"v":1, ..., "type":"READY", ..., "protect":[...], "allow":[...]}
cat demo/project/.env                                       # in another shell → a TAG line
sudo python3 guard/guard.py -p policy/policy.toml 2>/dev/null | head -1   # stdout is pure JSON
sudo python3 guard/guard.py -p /nope.toml; echo $?          # → message on stderr, 2
```

| If this happens | Check |
|---|---|
| Bridge chokes on a line | Something printed non-JSON to stdout. Every `print` without `file=sys.stderr` is suspect. |
| Events arrive in bursts, late | Missing `flush=True` / `sys.stdout.flush()` after each line (pipes are block-buffered). |
| `KeyError` looking up a map | Map name mismatch with Azaan's `.bpf.c`. Names are Contract 1. |
| bcc compile errors about headers | `kernel-devel` doesn't match `uname -r`; or the `-I` path isn't absolute. |
| No TAG for `cat .env` | `protected_inodes` empty or wrong inode: `sudo bpftool map dump name protected_inodes` vs `stat -c %i demo/project/.env`. |
| Timestamps are off by hours | Using `time.time()` alone; `ts_ns` is time since boot. Check `boot_time_epoch`. |
| Guard exits 3 | BPF load failed; the `ERROR` line on stdout and stderr carry the bcc/verifier message. Tell Azaan. |
| Ctrl-C leaves hooks attached | It can't: hooks detach on process exit. Check `bpftool prog list` to confirm. |

## 8. Working with AI agents

Safety rules that apply here (from AGENTS.md):

- Default `mode` is `audit`. Use `enforce` only inside the VM. Never run `guard.py` on a developer's host machine in enforce mode.
- `sudo` is only for `guard.py`, `lsm_smoke_test.py` and `attack_matrix.py`.
- `guard.py` writes **only** JSON lines to stdout. All logs go to stderr.

Conventions: Python 3.11+, stdlib plus `bcc` only. `argparse` for the CLI. Build file paths from `__file__`. Import `bcc` only in `guard.py`, never in `policy.py`.

Common pitfalls: printing debug info to stdout; forgetting to flush; computing timestamps from wall clock; relative `-I` path; validating the policy *after* loading BPF (validate first, fail fast).

Commit format: `feat(guard): M1 load BPF and emit READY`, `fix(guard): flush stdout per event`, `test(guard): policy validation cases`.

Start-here prompt to paste to an agent:

> I'm Hifza, Track G1. Read AGENTS.md, docs/shared.md, guard/docs/hifza.md, policy/docs/hifza.md and ARCHITECTURE.md (Contracts 1–3). Work only in guard/guard.py and guard/policy.py. Implement the next unticked milestone in section 6 of my file. Keep stdout JSON-only. Don't run sudo; give me the VM commands. At the end, update only sections 6, 9 and 10 of my file.

## 9. Open questions

None open. Resolved 18 Oct (see docs/shared.md): exit codes 0/2/3, `ERROR` on load failure, `--debug` is stderr-only, `comm` is `null` on `READY`/`ERROR`, you own `tests/test_policy.py`, S2 belongs to Track K.

**Applied 20 Oct (Azaan, Contract 2 clarifications).** All three are implemented in `guard/policy.py`, each with a test in `tests/test_policy.py`:
- a missing `allow` key is treated as empty, not an error;
- a missing `protect` key is rejected, same as an empty one;
- `allow` entries must be strings; a non-string entry is rejected (an integer like `5` would otherwise silently become `0.0.0.5/32`).

**Open:**
- Should a valid CLI `--mode` override accept a policy file whose `mode` value is invalid? Contract 2 says "validate that `mode` is audit or enforce" and "a CLI `--mode` flag overrides the file", but does not say which wins when the file's value is invalid. Current behaviour: the file is validated first, so an invalid file `mode` is rejected even when `--mode` supplies a valid value. **Behaviour deliberately left unchanged.** If the team decides otherwise it is a behaviour change and needs a `contract:` entry in `docs/shared.md`.

## 10. Work log

- 2026-10-18: file created. Bootstrap only; `guard.py` and `policy.py` are stubs.
- 2026-10-18: docs updated with team decisions (TAG_INHERIT name not asserted, hook C emits no ALLOW, native IPv6 dropped, open questions resolved). See docs/shared.md.
- 2026-10-21: Contract 2 policy parsing/validation implemented in `guard/policy.py` (stdlib only, imports no `bcc`): `mode` in {audit, enforce} with missing -> `audit`; `protect` absolute, existing and non-empty, resolved with `os.stat` (follows symlinks, keeps `st_ino`); `allow` parsed with `ipaddress.ip_network(entry, strict=False)` and split into IPv4/IPv6; unknown keys rejected; map-size limits not checked; `--mode` overrides the file; errors print one clear message to stderr and exit 2. `load_policy` raises `PolicyError` instead of exiting, so the CLI owns the exit code.
- 2026-10-21: `tests/test_policy.py` = **31 tests, all passing, 1 skipped**. The skip is `test_symlink_resolves_to_target_inode`: on Windows creating a symlink needs the `SeCreateSymbolicLink` privilege (or Developer Mode), so it is skipped here and must be re-run on Linux in the VM. The companion test proving `os.stat` is used instead of `os.lstat` does pass on Windows.
- 2026-10-21: all three 20 Oct Contract 2 clarifications implemented and tested (missing `allow` -> empty, missing `protect` -> rejected, non-string `allow` entry rejected). One open question recorded in section 9: whether a valid `--mode` override should accept a file with an invalid `mode`. No behaviour changed.
- 2026-10-21: `guard.py` not started yet (Phase 2, pending approval). Milestone boxes M1 and M3 stay unticked: policy validation is only a prerequisite, M1 still needs the guard to start in audit mode, print `READY` and tag `cat demo/project/.env` in the VM.
