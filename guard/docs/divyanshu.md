# Divyanshu: Track G2, event decoder (`guard/events.py`)

This file covers `guard/events.py` only. Your bridge work is in [bridge/docs/divyanshu.md](../../bridge/docs/divyanshu.md).

## 1. Your part, in plain words

Think of the server as an office building and every running program as a person inside it. SyscallGuard is a guard at the exit doors: anyone who touched a confidential file gets a stamp on their hand, and a stamped person may only go to approved rooms.

The guard (Azaan's kernel code) writes every incident down in shorthand: raw bytes, numbers for event types, an inode number instead of a file name, a timestamp counted from when the machine booted. You are the **translator**. `decode_event` turns one shorthand note into a plain JSON record: "BLOCK, curl, PID 4421, read /home/.../.env, tried 192.168.122.1:9999".

Your output is exactly what Devansh's dashboard shows on screen. The JSON schema (Contract 3) is the interface between you and him.

## 2. Where it sits

```
 kernel hooks (Azaan) ──struct sg_event──▶ ring buffer
                                               │ raw bytes
                                               ▼
                guard.py poll loop (Hifza) ──▶ decode_event(data, ctx)   ◀── YOU
                                               │ dict (or None = drop)
                                               ▼
                guard.py json.dumps ──stdout──▶ bridge.py (you) ──ws──▶ dashboard (Devansh)
```

## 3. Files you own

- `guard/events.py`: the decoder
- `tests/test_events.py`: decoder unit tests (unprivileged, hand-packed bytes, no VM)
- `guard/docs/divyanshu.md`: this file (sections 6, 9, 10 only, during development)
- Also `bridge/` (see your other file)

Do not edit: `guard/bpf/` including `sg_common.h` (Azaan; struct changes go through a `contract:` commit), `guard/guard.py`, `guard/policy.py` (Hifza), `dashboard/` (Devansh), `demo/`, `scripts/`, `tests/attack_matrix.py` (Suyash).

## 4. What to build

### The agreed signature (already decided, do not change)

```python
# guard/events.py

@dataclass
class EventContext:
    """Everything the decoder needs that it cannot derive from the raw bytes."""
    inode_paths: dict[int, str]   # st_ino -> absolute protected path, from policy
    boot_time_epoch: float        # epoch seconds at boot; ts_ns is added to this
    mode: str                     # "audit" or "enforce", for the event's mode field

def decode_event(data: bytes, ctx: EventContext) -> dict | None:
    """Decode one raw sg_event from the ring buffer into a Contract 3 dict.

    data: raw bytes of struct sg_event as laid out in guard/bpf/sg_common.h
    ctx:  resolution context supplied by guard.py at startup
    returns: a JSON-ready dict matching Contract 3, or None to drop the event

    Must not write to stdout, stderr, or any file. guard.py performs
    json.dumps and the write.
    """
```

Hifza builds the `EventContext` once at startup and calls `decode_event` once per ring-buffer record. Changing this signature needs a `signature` entry in `docs/shared.md` and agreement from Hifza.

### Unpacking the bytes

`struct sg_event` fields in order: `u64 ts_ns, u64 ino, u32 type, u32 hook, u32 tgid, u32 parent_tgid, u16 family, u16 dport, u8 daddr[16], char comm[16]`. Every field is already naturally aligned, so `struct.unpack_from("<QQIIIIHH16s16s", data)` reads it (68 bytes, little-endian on x86_64). The C `sizeof` is 72 because of tail padding to 8-byte alignment, so `data` may be longer than 68 bytes. Use `unpack_from`, not `unpack`.

### When to return `None`

Only when the buffer is short (fewer than 68 bytes) or otherwise malformed. Every well-formed event is emitted.

### Building each field

| Field | From | Rule |
|---|---|---|
| `v` | constant | `1` |
| `ts` | `ts_ns` | `ctx.boot_time_epoch + ts_ns / 1e9` |
| `type` | `type` | 1 `TAG`, 2 `TAG_INHERIT`, 3 `ALLOW`, 4 `BLOCK`, 5 `WOULD_BLOCK`, 6 `UNTAG` (the `SG_EV_*` values) |
| `hook` | `hook` | 1 `file_open`, 2 `connect`, 3 `sendmsg`, 4 `fork`, 5 `exit`; 0 (`SG_HOOK_NONE`) → `null` |
| `tgid` | `tgid` | int |
| `parent_tgid` | `parent_tgid` | int on `TAG_INHERIT`; `null` otherwise (the Contract 3 example shows `null` on a `BLOCK`) |
| `comm` | `comm` | bytes up to the first NUL, decoded as text (use `errors="replace"`). On `TAG_INHERIT` this is the name at fork (usually the parent's); pass it through as-is |
| `file` | `ino` | `ctx.inode_paths.get(ino)`; `null` when `ino` is 0 or not in `ctx.inode_paths` (the event is still emitted) |
| `family` | `family` | 2 → `"ipv4"`, 10 → `"ipv6"`, 0 → `null` |
| `daddr` | `daddr` | ipv4: `str(ipaddress.IPv4Address(daddr[:4]))`; ipv6: `str(ipaddress.IPv6Address(daddr))`; no family → `null` |
| `dport` | `dport` | int (already host byte order); `null` when there is no address |
| `mode` | `ctx.mode` | `"audit"` or `"enforce"` |

`ALLOW` only ever comes from hook B, so it always has `hook = "connect"`. Hook C (`sendmsg`) emits only `WOULD_BLOCK`/`BLOCK`.

`READY` and `ERROR` events are **not** yours. `guard.py` builds those directly.

### IPv4-mapped IPv6

The kernel side normalises `::ffff:a.b.c.d` to `AF_INET` + `a.b.c.d` in `check_dest` before emitting, so mapped addresses arrive as `family = 2`. The decoder formats whatever family arrives; no special-casing.

### Purity

No printing, no logging, no file writes. Raise nothing for well-formed input. That keeps it testable on any machine with hand-packed bytes.

## 5. Contract excerpts

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 1: Kernel structs and maps"):

```c
struct sg_event {
    u64 ts_ns;
    u64 ino;            /* protected file inode (from tag info), 0 if n/a */
    u32 type;           /* SG_EV_* */
    u32 hook;           /* SG_HOOK_* */
    u32 tgid;
    u32 parent_tgid;    /* TAG_INHERIT only */
    u16 family;         /* AF_INET=2, AF_INET6=10, 0 if n/a */
    u16 dport;          /* host byte order */
    u8  daddr[16];      /* IPv4 in first 4 bytes, network order */
    char comm[16];
};
```

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 3: Guard CLI and JSON event schema"):

```json
{"v":1,"ts":1760600000.123,"type":"BLOCK","hook":"connect","tgid":4421,"parent_tgid":null,
 "comm":"curl","file":"/home/demo/syscallguard/demo/project/.env",
 "family":"ipv4","daddr":"192.168.122.1","dport":9999,"mode":"enforce"}
```

| Field | Type | Notes |
|---|---|---|
| `v` | int | schema version, `1` |
| `ts` | float | Unix epoch seconds (convert from `ts_ns` using boot-time offset) |
| `type` | string | `READY` `TAG` `TAG_INHERIT` `ALLOW` `BLOCK` `WOULD_BLOCK` `UNTAG` `ERROR` |
| `hook` | string or null | `file_open` `connect` `sendmsg` `fork` `exit` |
| `tgid`, `parent_tgid` | int or null | |
| `comm` | string or null | process name; `null` on `READY`/`ERROR`. On `TAG_INHERIT` it is the name at fork time (usually the parent's); consumers must not rely on it |
| `file` | string or null | protected path resolved from `ino` |
| `family` | `"ipv4"`/`"ipv6"`/null | |
| `daddr` | string or null | formatted with `ipaddress` |
| `dport` | int or null | |
| `mode` | string | current mode |

## 6. Your milestones

`events.py` has no milestone of its own; it is on the critical path of these:

- [ ] **M1 Tagging** (K + G, 18–19 Oct): Guard starts in audit mode and prints `READY`; `cat demo/project/.env` → `TAG` event for `cat`; `sudo bpftool map dump name tagged` shows the entry
- [ ] **M2 Inheritance & cleanup** (K, 19 Oct): `python3 -c "open('demo/project/.env').read(); import subprocess; subprocess.run(['sleep','1'])"` → `TAG` (python3) + `TAG_INHERIT` for the child tgid with `parent_tgid` = the python3 tgid (process name not asserted); after exit both get `UNTAG` and the map is empty of them
- [ ] **M3 Connect enforcement** (K + G, 19 Oct): Enforce mode: tagged `agent.py --exfil direct` → `PermissionError` + `BLOCK`; its POST to 127.0.0.1:8080 succeeds with `ALLOW`; an untagged `python3 -c` connect to the attacker succeeds; audit mode → all succeed + `WOULD_BLOCK`

**Start now:** all of it. The struct layout and schema are fixed; test with hand-packed bytes, no VM.
**Blocked by:** nothing.
**You block:** Hifza's event output (M1, M2, M3) and, through the bridge, Devansh's real-data dashboard (M5 real).

Do the bridge's `--fake` mode first (it unblocks Devansh today), then this.

## 7. How to run and test your part

No VM needed. Your tests live in `tests/test_events.py`: `python3 -m unittest tests/test_events.py`.

Quick manual check, pack a fake event and decode it:

```bash
python3 - <<'EOF'
import struct, sys
sys.path.insert(0, "guard")
from events import EventContext, decode_event
raw = struct.pack("<QQIIIIHH16s16s", 5_000_000_000, 1234, 4, 2, 4421, 0, 2, 9999,
                  bytes([192,168,122,1]) + bytes(12), b"curl")
ctx = EventContext({1234: "/home/demo/syscallguard/demo/project/.env"}, 1760600000.0, "enforce")
print(decode_event(raw + bytes(4), ctx))
EOF
```

Expected: a dict with `"type": "BLOCK"`, `"hook": "connect"`, `"tgid": 4421`, `"parent_tgid": None`, `"comm": "curl"`, the `.env` path, `"family": "ipv4"`, `"daddr": "192.168.122.1"`, `"dport": 9999`, `"ts": 1760600005.0`, `"mode": "enforce"`.

In the VM, the real check is guard.py's stdout: `sudo python3 guard/guard.py -p policy/policy.toml --mode audit` then `cat demo/project/.env`.

| If this happens | Check |
|---|---|
| `struct.error: unpack requires a buffer of 68 bytes` | You're using `unpack` on 72 bytes, or the C struct changed. Use `unpack_from`; compare with `sg_common.h`. |
| `daddr` reads `1.122.168.192` | You byte-swapped. `daddr` is network order; `ipaddress` wants exactly those bytes. |
| `dport` is 3879 instead of 9999 | The kernel didn't convert to host order. That's a kernel bug: tell Azaan, don't swap in the decoder. |
| `comm` has trailing `\x00` | Split at the first NUL before decoding. |
| `ts` is ~1970 or decades off | Missing `ctx.boot_time_epoch`, or mixing ns and s. |
| `file` is null on a TAG | `ino` not in `ctx.inode_paths`: policy inode vs kernel inode mismatch. Check with Hifza. |

## 8. Working with AI agents

Safety rules that apply here (from AGENTS.md):

- Contracts are law. You don't change `sg_event` or the JSON schema without a `contract:` commit that updates ARCHITECTURE.md, `sg_common.h` and `docs/shared.md` together.
- `guard.py` writes only JSON lines to stdout. Your decoder writes nothing at all.

Conventions: stdlib only (`struct`, `ipaddress`, `dataclasses`). No `bcc` import in `events.py`; it must import on any OS. Constants mirror `sg_common.h` names (`SG_EV_TAG = 1`, ...).

Common pitfalls: decoding `daddr` as an int; forgetting tail padding; inventing extra JSON fields (the dashboard renders only Contract 3); printing inside the decoder.

Commit format: `feat(guard): M1 decode TAG events`, `fix(guard): strip NUL from comm`, `test(guard): ...`.

Start-here prompt to paste to an agent:

> I'm Divyanshu, Track G2. Read AGENTS.md, docs/shared.md, guard/docs/divyanshu.md and ARCHITECTURE.md Contracts 1 and 3. Work only in guard/events.py. Implement EventContext and decode_event exactly as in section 4 of my file; do not change the signature. Stdlib only, no output. Leave one small runnable self-check. At the end, update only sections 6, 9 and 10 of my file.

## 9. Open questions

None open. Resolved 18 Oct: decoder tests live in `tests/test_events.py`, which you own.

## 10. Work log

- 2026-10-18: file created. Bootstrap only; `events.py` is a stub.
- 2026-10-18: docs updated with team decisions (TAG_INHERIT name not asserted, hook C emits no ALLOW, native IPv6 dropped, open questions resolved). See docs/shared.md.
- 2026-10-18: you now own tests/test_events.py (see docs/shared.md).
- 2026-10-19: implemented the Contract 1/3 decoder and added hand-packed unprivileged tests; `python -m unittest tests/test_events.py` passed (6 tests). Linux VM integration remains unverified.
