# Divyanshu: Track G2, bridge (`bridge/`)

This file covers `bridge/bridge.py`. Your decoder work is in [guard/docs/divyanshu.md](../../guard/docs/divyanshu.md).

## 1. Your part, in plain words

Think of the server as an office building and every running program as a person inside it. SyscallGuard is a guard at the exit doors: anyone who touched a confidential file gets a stamp on their hand, and a stamped person may only go to approved rooms.

The guard writes every incident to a log, one line at a time. The bridge is the **radio** that relays that log to the security screen in another room (Devansh's dashboard on the host laptop). It also keeps a whiteboard of the current state: which people are stamped right now, the approved rooms, the last 50 incidents. So when a screen is switched on mid-shift, the bridge hands it the whiteboard first and the screen is instantly up to date.

The bridge only relays. It never needs root, never touches the kernel and never changes an event.

**`--fake` is urgent.** It plays a realistic story with no kernel and no VM, on any OS. Devansh can't build the dashboard until it exists. Ship `--fake` first, on day one.

## 2. Where it sits

```
 VM:   guard.py (root) ──stdout JSON lines──▶ bridge.py stdin
                                               │  state: mode, protect, allow,
                                               │         tagged set, last 50 events
                                               ▼
                                         WebSocket server :8765
                                               │  SNAPSHOT on connect, then every event
 host: Electron dashboard (Devansh) ◀──ws──────┘

 anywhere:  bridge.py --fake  (generates the story itself, no stdin)
```

## 3. Files you own

- `bridge/bridge.py`
- `bridge/docs/divyanshu.md`: this file (sections 6, 9, 10 only, during development)
- Also `guard/events.py` (see your other file)

Do not edit: `guard/guard.py`, `guard/policy.py` (Hifza), `guard/bpf/` (Azaan), `dashboard/` (Devansh), `demo/`, `scripts/`, `tests/attack_matrix.py` (Suyash).

## 4. What to build

`bridge/bridge.py`, Python 3 + `websockets` (asyncio). Never imports `bcc`. Runs unprivileged.

CLI:

```
python3 bridge/bridge.py --host 0.0.0.0 --port 8765     # read guard events from stdin
python3 bridge/bridge.py --fake --port 8765             # no kernel, any OS
```

- `--host`: bind address, default `127.0.0.1`. In the VM pass `0.0.0.0` so the host laptop can reach it.
- `--port`: default `8765`.
- `--fake`: ignore stdin, generate the story instead.

**Input.** One JSON object per line on stdin (Contract 3). Read it without blocking the event loop (e.g. a reader thread or `loop.connect_read_pipe`).

**Broadcast.** Send each input line, **unchanged**, to every connected client. Don't re-serialise or add fields.

**State** (updated from each event):

- `mode`, `protect`, `allow`: from `READY` (`mode` also from each event's `mode`). Before `READY` arrives, `SNAPSHOT.mode` is `null`.
- `tagged`: add on `TAG` / `TAG_INHERIT`, remove on `UNTAG`, keyed by `tgid`. Each entry: `tgid`, `comm`, `file`, `since` (the event's `ts`), `parent_tgid`. A repeat `TAG` for a tgid already in the set keeps the original `since`.
- `recent`: the last 50 events (a `collections.deque(maxlen=50)`).
- `guard_connected`: `true` while stdin is open, `false` after EOF; always `true` in `--fake`. Included in `SNAPSHOT`.

**On client connect:** send one `SNAPSHOT` message first (format below), then live events.

**Client messages:** ignore them. Read-only feed.

**`--fake` story**, looped every ~10 s, with realistic Contract 3 fields:

`READY` → `TAG` (python3) → `ALLOW` 127.0.0.1:8080 → `TAG_INHERIT` (comm `python3`, the name at fork) → `BLOCK` (comm `curl`) 192.168.122.1:9999 → `UNTAG`

As in the real feed, the fake `TAG_INHERIT` carries comm `python3` (the name at fork) and `curl` appears only on the `BLOCK`. The fake `ALLOW` has `hook: "connect"` (only hook B emits `ALLOW`). Fake events go through the same state and broadcast path as real ones, so `SNAPSHOT` works in fake mode too.

**Errors.** A malformed (non-JSON) stdin line: skip it and log to stderr. On stdin EOF (guard gone): keep running, keep serving the last state, log to stderr, and broadcast `{"v":1,"type":"GUARD_STATE","connected":false}`. It stays `false`; there is no reconnect. Restarting the guard means restarting the whole pipeline. `GUARD_STATE` is not added to `recent`. A client disconnecting mid-send must not affect other clients.

## 5. Contract excerpts

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 4: Bridge WebSocket protocol"):

> - Reads JSON lines from stdin (or generates them in `--fake` mode) and broadcasts each one, unchanged, to every connected WebSocket client.
> - Keeps state: mode, protect, allow, the current tagged set (add on `TAG`/`TAG_INHERIT`, remove on `UNTAG`), and the last 50 events.
> - When a client connects, it first sends:
>   ```json
>   {"v":1,"type":"SNAPSHOT","mode":"enforce","guard_connected":true,"protect":[...],"allow":[...],
>    "tagged":[{"tgid":4421,"comm":"python3","file":"...","since":1760600000.1,"parent_tgid":null}],
>    "recent":[ ...last 50 events... ]}
>   ```
>   So a dashboard that restarts mid-demo recovers its full state.
> - `--fake` loops a realistic story every ~10 s: `READY` → `TAG` (python3) → `ALLOW` 127.0.0.1:8080 → `TAG_INHERIT` (comm `python3`, the name at fork) → `BLOCK` (comm `curl`) 192.168.122.1:9999 → `UNTAG`.
> - Guard state: the bridge sends `{"v":1,"type":"GUARD_STATE","connected":false}` to every client on stdin EOF (guard gone). It stays `false`: stdin can't reopen, so restarting the guard means restarting the whole `guard.py | bridge.py` pipeline, and the new bridge starts with `true`. `SNAPSHOT` carries the current value as `"guard_connected"`. `--fake` always reports `true`. `GUARD_STATE` is a bridge message, not a guard event, so it is not added to `recent`.
> - Read-only feed. Ignore messages from clients.
> - Never imports `bcc`. Runs unprivileged.
> - `--host` defaults to `127.0.0.1` (pass `0.0.0.0` in the VM). A malformed stdin line is skipped and logged to stderr. A repeat `TAG` for an already-tagged tgid keeps its original `since`. Before `READY` arrives, `SNAPSHOT.mode` is `null`. On stdin EOF (guard gone) the bridge keeps running, serves the last state, and sends `GUARD_STATE` (below).

Your input is Contract 3 (field table in ARCHITECTURE.md and in [guard/docs/divyanshu.md](../../guard/docs/divyanshu.md)). The `READY` event carries `"protect": [...]` and `"allow": [...]`.

## 6. Your milestones

- [ ] **M5 Live dashboard** (G + U, fake: 19 Oct, real: 20 Oct): Electron shows `SNAPSHOT` state on connect; `BLOCK` turns the banner red within 1 s; restarting Electron mid-run recovers state

Bridge side: `--fake` with `SNAPSHOT` by 19 Oct; piped from the real guard in the VM by 20 Oct.

**Start now:** everything. `--fake` first.
**Blocked by:** nothing for fake. For real: Hifza's `guard.py` stdout and your own `decode_event`.
**You block:** Devansh (the whole dashboard is built against `--fake`), and P/Suyash's rehearsals.

## 7. How to run and test your part

Any OS, no VM, no root:

```bash
pip install websockets          # if missing
python3 bridge/bridge.py --fake --port 8765
# second terminal: watch the feed
python3 -m websockets ws://127.0.0.1:8765
```

Expected: the first message is `{"v":1,"type":"SNAPSHOT",...}`, then the six-event story repeating every ~10 s. Disconnect and reconnect mid-story: the new `SNAPSHOT` lists the currently tagged processes and up to 50 recent events.

Test stdin mode without the kernel:

```bash
printf '%s\n' '{"v":1,"ts":1760600000.1,"type":"TAG","hook":"file_open","tgid":4421,"parent_tgid":null,"comm":"python3","file":"/x/.env","family":null,"daddr":null,"dport":null,"mode":"audit"}' \
  | python3 bridge/bridge.py --port 8765
```

Real, in the VM:

```bash
sudo python3 guard/guard.py -p policy/policy.toml --mode audit | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
sudo firewall-cmd --add-port=8765/tcp      # once, so the host laptop can connect
```

| If this happens | Check |
|---|---|
| Dashboard on the host can't connect | `--host 0.0.0.0` (not 127.0.0.1); VM firewall port 8765 open; right VM IP. |
| Events appear only in bursts | guard.py isn't flushing stdout (Hifza), or you're reading stdin with a blocking call on the event loop. |
| Dashboard still shows guard feeding after the guard died | No `GUARD_STATE` false sent on EOF, or `guard_connected` missing from `SNAPSHOT`. |
| Bridge exits when stdin closes | It shouldn't: on EOF it keeps serving the last state. Fix that, then check the guard's stderr for why it died. |
| `SNAPSHOT` tagged list never shrinks | `UNTAG` not removing by `tgid`, or keyed by a different type (str vs int). |
| `ImportError: bcc` | Something imported guard code that pulls in bcc. The bridge must import nothing from `guard/`. |
| One slow client stalls everyone | Send to clients concurrently, drop failed ones. |

## 8. Working with AI agents

Safety rules that apply here (from AGENTS.md):

- `bridge/` must never import `bcc` or need root.
- Contract 4 is law. Changing the `SNAPSHOT` shape or adding message types is a `contract:` commit with a `docs/shared.md` entry. Devansh depends on it.

Conventions: Python 3.11+, `asyncio` + `websockets`, `argparse`, single file. Broadcast raw lines; parse a copy only to update state.

Common pitfalls: re-serialising events (field order/format changes break "unchanged"); faking data in non-fake mode; blocking `sys.stdin.readline()` on the event loop; unbounded `recent` list.

Commit format: `feat(bridge): M5 --fake story and SNAPSHOT`, `fix(bridge): ...`.

Start-here prompt to paste to an agent:

> I'm Divyanshu, Track G2. Read AGENTS.md, docs/shared.md, bridge/docs/divyanshu.md and ARCHITECTURE.md Contracts 3 and 4. Work only in bridge/bridge.py. Build --fake first, with SNAPSHOT on connect, exactly per section 4 of my file. No bcc, no root, stdlib + websockets only. At the end, update only sections 6, 9 and 10 of my file.

## 9. Open questions

None open. Resolved 18 Oct: no guard reconnect; `GUARD_STATE` stays `false` after EOF and restarting the guard means restarting the whole pipeline.

## 10. Work log

- 2026-10-18: file created. Bootstrap only; `bridge.py` is a stub.
- 2026-10-18: docs updated with team decisions (TAG_INHERIT name not asserted, hook C emits no ALLOW, native IPv6 dropped, open questions resolved). See docs/shared.md.
- 2026-10-18: contract: added GUARD_STATE and SNAPSHOT.guard_connected (see docs/shared.md).
- 2026-10-18: GUARD_STATE has no reconnect case; restart = whole pipeline (see docs/shared.md).
- 2026-10-19: implemented stdin and `--fake` WebSocket bridge. Local checks passed for snapshot, unchanged forwarding, state recovery at EOF, repeat TAG, malformed input, fake story, and client-disconnect isolation; real VM and dashboard integration remain unverified.
- 2026-10-19: re-verified `python -m py_compile guard/events.py bridge/bridge.py tests/test_events.py`, `python -m unittest tests/test_events.py` (6 passed), and `git diff --check`; live local WebSocket fake-story and stdin forwarding/EOF/reconnect-snapshot checks passed. M5 dashboard and real-guard acceptance remain pending their owners' implementations.
