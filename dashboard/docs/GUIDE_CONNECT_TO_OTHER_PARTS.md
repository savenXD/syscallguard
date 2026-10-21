# Guide: connecting the dashboard to the other parts of SyscallGuard (bridge, guard, VM)

Audience: a developer or AI agent who has to wire the dashboard to `guard.py`, `bridge.py`, a VM, or any other event source. Read this top to bottom once; sections 3 and 4 are the contract the dashboard enforces.

Last verified against the code: 2026-10-21 (`src/lib/guardClient.ts`, `main.js`, `preload.js`, `mock_bridge.py`).

---

## 1. The one-paragraph version

The dashboard is a **read-only WebSocket client**. It connects to one URL (default `ws://127.0.0.1:8765`), receives JSON text frames, and draws them. It never sends anything. To feed it, run any process that serves a WebSocket and sends (a) one `SNAPSHOT` message on every new connection, then (b) one JSON message per event, then optionally (c) `GUARD_STATE` messages. In production that process is `bridge/bridge.py`, which reads JSON lines from `guard.py` on stdin and rebroadcasts them.

```
guard.py (root, VM) --stdout JSON lines--> bridge.py --WebSocket :8765--> dashboard
                                          (stdin)      (SNAPSHOT, events,    (Electron or
                                                        GUARD_STATE)          any browser)
```

Anything that speaks this protocol works as a source: `bridge.py`, `bridge.py --fake`, `dashboard/mock_bridge.py`, a test script, a different language.

---

## 2. Quick start: pick your situation

| I want to... | Run |
|---|---|
| See the UI with no backend at all | `cd dashboard && npm ci && npm run demo` (embedded mock feed, labelled "Demo") |
| Develop against a fake feed | `python3 dashboard/mock_bridge.py --port 8765` then `npm start` |
| Use the team's fake bridge (once implemented) | `python3 bridge/bridge.py --fake --port 8765` then `npm start` |
| Connect to the real guard in the VM | In VM: `sudo python3 guard/guard.py -p policy/policy.toml \| python3 bridge/bridge.py --host 0.0.0.0 --port 8765`. On host: `SG_BRIDGE_URL=ws://<vm-ip>:8765 npm start` |
| Use a plain browser (no Electron) | Open `dashboard/renderer/index.html?bridge=ws://<host>:8765` (after `npm run build`) |
| Test by hand with no bridge | Write ~30 lines of Python with `websockets` (see section 8) |

`bridge/bridge.py` in this checkout is **still a comment-only stub** (TODO list, no code). Until it exists, use `dashboard/mock_bridge.py` as the working reference of Contract 4. It is intentionally close to what the real bridge must do.

---

## 3. How the dashboard picks its bridge URL

Resolution order, first match wins (`main.js`, `preload.js`, `resolveBridgeUrl` in `src/lib/guardClient.ts`):

1. `--bridge=ws://host:port` command-line argument (Electron).
2. `SG_BRIDGE_URL` environment variable (Electron).
3. Electron default `ws://127.0.0.1:8765`.
4. Browser only (no Electron): `?bridge=ws://host:port` query parameter on the page URL.
5. Fallback `ws://127.0.0.1:8765`.

Mechanics: `main.js` passes the chosen URL to the renderer as the process argument `--bridge-url=...` through `webPreferences.additionalArguments`. `preload.js` reads it and exposes exactly one value, `window.bridgeUrl`, via `contextBridge`. The React hook `useSyscallGuard` reads `window.bridgeUrl` (or `?bridge=`). Only `ws:` and `wss:` URLs are accepted; anything else silently falls back to the default.

Launch modes (Electron, `main.js`):

| Flag / env | Effect |
|---|---|
| `--bridge=ws://...` / `SG_BRIDGE_URL` | Use that real bridge. Overrides demo mode. |
| `--demo` | Start the embedded loopback mock feed (no Python) and connect to it. |
| `--live` | Packaged app only: use the default localhost bridge instead of demo. |
| `--kiosk`, `--fullscreen` | Fullscreen stage mode. |
| (packaged app, none of the above) | **Starts in demo mode.** A packaged app with no `--bridge` shows mock data. |

Gotcha: `npm start` (from source) connects to the real default `ws://127.0.0.1:8765`; a *packaged* app defaults to demo. When showing real data from a packaged build, always pass `--bridge=`.

The renderer's Content-Security-Policy allows `connect-src ws: wss:` only. No remote scripts, fonts or images. A bridge on another host works; an HTTP API does not.

---

## 4. The protocol the dashboard accepts (Contract 4, as enforced)

Transport: WebSocket, **text frames**, one JSON object per frame. Binary frames are ignored. Every object must have `"v": 1`; anything else is dropped without an error.

The dashboard **drops invalid messages silently**. There is no error toast. If events "don't show up", the cause is almost always validation (section 4.5). Validation lives in `isGuardEvent`, `isTagged` and the `SNAPSHOT` branch of `GuardClient.receive` in `src/lib/guardClient.ts`.

### 4.1 Connection handshake

1. Dashboard opens the socket. Bridge state in the UI becomes "connected"; guard state becomes **unknown** (neither feeding nor not feeding).
2. Bridge must immediately send a `SNAPSHOT`.
3. Bridge then forwards live events and sends `GUARD_STATE` when the guard appears or disappears.
4. If the socket closes or errors, the UI shows reconnecting and retries every 2 s. On reconnect it receives a fresh `SNAPSHOT`, which replaces all state.

The dashboard never sends messages. Ignore anything a client sends.

### 4.2 `SNAPSHOT` (send first, on every new connection)

```json
{"v":1,"type":"SNAPSHOT","mode":"enforce","guard_connected":true,
 "protect":["/home/demo/syscallguard/demo/project/.env"],
 "allow":["127.0.0.0/8","::1/128"],
 "tagged":[{"tgid":4421,"comm":"python3","file":"/home/demo/.../.env","since":1760600001.2,"parent_tgid":null}],
 "recent":[ /* up to 50 event objects (section 4.3), any order */ ]}
```

| Field | Required type | Notes |
|---|---|---|
| `mode` | `"audit"` \| `"enforce"` \| `null` | `null` before the guard sent `READY`. |
| `guard_connected` | boolean | **Must be a boolean**; a missing value rejects the whole snapshot. |
| `protect` | array of strings | Protected file paths. Shown in the Policy panel and the hero's "Protected file" box. |
| `allow` | array of strings | Allowed CIDRs. |
| `tagged` | array of tagged-process objects | Each needs `tgid` (int), `comm` (string\|null), `file` (string\|null), `parent_tgid` (int\|null), `since` (finite number, Unix seconds). |
| `recent` | array of events | Every element must validate as an event. **One bad event rejects the entire snapshot.** |

A `SNAPSHOT` **replaces** all dashboard state (mode, policy, tagged list, event history, counters). It is how a restarted dashboard recovers. `recent` may be oldest-first or newest-first; the client sorts newest-first and keeps 100.

Optional `"source":"mock"` marks the feed as demo: the UI shows a "Demo · mock feed" badge and additionally accepts the stretch payloads of section 6. Real bridges must **not** set it.

### 4.3 Guard events (one frame each, forwarded unchanged)

Every field below must be **present**. Use `null`, never omit:

```json
{"v":1,"ts":1760600004.0,"type":"BLOCK","hook":"connect","tgid":4430,"parent_tgid":4421,
 "comm":"curl","file":"/home/demo/project/.env","family":"ipv4","daddr":"192.168.122.1","dport":9999,"mode":"enforce"}
```

| Field | Accepted values |
|---|---|
| `v` | `1` |
| `ts` | finite number, Unix epoch **seconds** (float OK). Not milliseconds. |
| `type` | `READY` `TAG` `TAG_INHERIT` `ALLOW` `BLOCK` `WOULD_BLOCK` `UNTAG` `ERROR` |
| `hook` | `null` `"file_open"` `"connect"` `"sendmsg"` `"fork"` `"exit"` |
| `tgid`, `parent_tgid` | non-negative integer or `null` |
| `comm`, `file`, `daddr` | string or `null` |
| `family` | `"ipv4"` `"ipv6"` or `null` |
| `dport` | integer 0 to 65535 or `null` |
| `mode` | `"audit"` or `"enforce"` (never null on an event) |
| `READY` extra | `protect`: string[] and `allow`: string[] are **required** |
| `ERROR` extra | `message`: string is **required** |

What each event does in the UI:

| Event | Effect |
|---|---|
| `READY` | Sets mode, protected files and allowlist (Policy panel, hero). Send first after the guard starts. |
| `TAG` / `TAG_INHERIT` | Adds or updates a row in Processes. `TAG_INHERIT` shows `parent_tgid` as "inherited from". A repeat `TAG` for the same `tgid` keeps its original `since`. |
| `UNTAG` | Removes that `tgid` from Processes. |
| `ALLOW` | Counts as an allowed request (green bars, Total allowed, Total requests). Becomes the hero's "last allowed" destination. |
| `BLOCK` | Counts as blocked. Hero turns red for **5 s** ("Exfiltration blocked."), toast, optional audio ping. |
| `WOULD_BLOCK` | Audit-mode equivalent: hero turns amber for 5 s. Not counted as blocked. |
| `ERROR` | Hero shows the `message` in red and **stays until the next event arrives** (sticky). |

Counters: "Total requests" = ALLOW + BLOCK only; lifecycle events (`TAG`, `UNTAG`, ...) are excluded. The dashboard keeps only the newest 100 events.

### 4.4 `GUARD_STATE` (bridge-originated, not a guard event)

```json
{"v":1,"type":"GUARD_STATE","connected":false}
```

Send when `guard.py` goes away (stdin EOF): `connected:false`. The UI then shows "Guard not feeding" while the bridge stays "connected". It is not added to the event log. There is no reconnect case: it stays false until the whole `guard.py | bridge.py` pipeline restarts (new bridge starts with `guard_connected:true`).

### 4.5 Why would a message be silently dropped? (checklist)

1. Frame is not valid JSON, or not a JSON object, or `v` is not `1`.
2. A required field is **missing** (not just null). Omitting `dport` on a `TAG` event drops it. Always send all 11 fields.
3. `ts` sent as a string or in milliseconds (a millisecond value parses but breaks time axes).
4. `family` is something other than `ipv4`/`ipv6`/null (for example `"AF_INET"`).
5. `hook` is a value not in the list (for example `"socket_create"` on a real feed; see section 6).
6. `mode` is null or missing on an event.
7. `READY` without `protect`/`allow` arrays, or `ERROR` without `message`.
8. A `SNAPSHOT` whose `recent` contains any invalid event, or whose `guard_connected` isn't a boolean.
9. `tgid`/`parent_tgid` negative, float, or string.

Debug tip: open DevTools (Ctrl+Shift+I in Electron, or F12 in the browser), Network, WS, and look at frames; compare each against section 4.3.

---

## 5. What the guard must print for the bridge (Contract 3)

`guard.py` writes **only** JSON lines to stdout, one event per line, flushed after each line, with the 11 fields of section 4.3. Logs go to stderr. `bridge.py` forwards each line **unchanged**, so the guard is responsible for emitting complete, valid events.

Sequence a healthy run produces (this is also what `--fake` should loop every ~10 s):

```
READY (protect, allow)
TAG        python3  file_open     tgid 4421
ALLOW      python3  connect       127.0.0.1:8080
TAG_INHERIT (child) fork          tgid 4430, parent_tgid 4421
BLOCK      curl     connect       192.168.122.1:9999
UNTAG      (each tagged tgid) exit
```

---

## 6. Mock-only stretch payloads (do not use on a real feed)

For rehearsals the dashboard also understands proposed S1/S2 payloads, **only when `SNAPSHOT.source === "mock"`**. On a real feed these are rejected by design because Contracts 1 to 4 do not define them yet.

- Raw sockets: `hook:"socket_create"` with `type` `BLOCK`/`WOULD_BLOCK` and `socket_family` (`AF_PACKET`/`AF_INET`/`AF_INET6`) plus `socket_type` (`SOCK_RAW`/`SOCK_DGRAM`).
- Taint: `type:"TAINT"` with `hook:"file_permission"` and a `taint` medium `{inode:"<digits>", kind:"pipe"|"file", path:string|null}`; tagged rows may carry `lineage`: an ordered chain of hops `{writer_tgid, writer_comm, reader_tgid, reader_comm, inode, kind, path}`.

To make these real, K and G must agree the schema, update `ARCHITECTURE.md` plus `docs/shared.md` in a `contract:` commit, then the dashboard validation in `isGuardEvent` is relaxed. Details: the (currently missing) `phase4-demo.md` and `stretch-demo-protocol.md` referenced from `devansh.md`.

---

## 7. Bridge implementation checklist (for whoever finishes `bridge/bridge.py`)

State the bridge keeps: `mode`, `protect`, `allow`, `tagged` (dict by tgid), `recent` (last 50 events, newest-first is fine), `guard_connected` (starts true; false on stdin EOF).

Per stdin line:
1. `json.loads`; on failure log to **stderr** and skip.
2. Update state: `READY` sets `mode`/`protect`/`allow`; `TAG`/`TAG_INHERIT` upsert into `tagged` (keep original `since` if the tgid already exists; use event `ts` otherwise; `parent_tgid` is null for `TAG`); `UNTAG` deletes.
3. Append to `recent` (cap 50).
4. Broadcast the **original line unchanged** to every client.

On client connect: send `SNAPSHOT` first (with `guard_connected`), then stream. Ignore client messages. Default `--host 127.0.0.1`; pass `0.0.0.0` in the VM. Never import `bcc`; must run unprivileged. On stdin EOF: keep serving, set `guard_connected=false`, broadcast `GUARD_STATE`.

`--fake`: loop the story in section 5 every ~10 s; always `guard_connected:true`.

Run a bridge only after verifying one rule from AGENTS.md: **stdout of guard.py must contain nothing but JSON lines**, or the bridge will skip/log junk lines.

---

## 8. Verify your wiring in five minutes

Minimal feeder (Python, `pip install websockets`; works with websockets 12 to 16):

```python
import asyncio, json, time, websockets

PROTECT = ["/home/demo/project/.env"]
ALLOW = ["127.0.0.0/8"]
def ev(t, **kw):
    e = dict(v=1, ts=time.time(), type=t, hook=None, tgid=None, parent_tgid=None, comm=None,
             file=None, family=None, daddr=None, dport=None, mode="enforce"); e.update(kw); return e

async def handler(ws):
    await ws.send(json.dumps(dict(v=1, type="SNAPSHOT", mode="enforce", guard_connected=True,
                                  protect=PROTECT, allow=ALLOW, tagged=[], recent=[])))
    await ws.send(json.dumps(ev("READY", protect=PROTECT, allow=ALLOW)))
    await ws.send(json.dumps(ev("TAG", hook="file_open", tgid=4421, comm="python3", file=PROTECT[0])))
    await asyncio.sleep(1)
    await ws.send(json.dumps(ev("BLOCK", hook="connect", tgid=4421, comm="python3", file=PROTECT[0],
                                family="ipv4", daddr="192.168.122.1", dport=9999)))
    await ws.wait_closed()

async def main():
    async with websockets.serve(handler, "127.0.0.1", 8765):
        await asyncio.Future()
asyncio.run(main())
```

Expected in the dashboard within about a second: both connection indicators green; Policy panel lists the `.env` file and `127.0.0.0/8`; one tagged process `python3` (4421); then the hero turns red "Exfiltration blocked." for 5 s and an alert appears in the bell.

Acceptance checks (from the milestone M5):

- Kill the bridge: UI shows reconnecting; restart it: reconnects within ~2 s and state is restored from `SNAPSHOT`.
- Close the guard side (EOF on bridge stdin): "Guard not feeding" while the bridge stays connected.
- Restart Electron mid-run: state returns from `SNAPSHOT`.
- Open `renderer/index.html?bridge=ws://127.0.0.1:8765` in a browser: works with no Electron.

Automated: `cd dashboard && npm test` (needs permission to bind loopback ports).

---

## 9. Common failures

| Symptom | Likely cause |
|---|---|
| Hero says "Bridge offline." forever | Wrong URL/port; bridge not running; VM firewall blocks the port; bridge bound to `127.0.0.1` instead of `0.0.0.0` when the dashboard is on another machine. |
| "Bridge connected" but "Guard unknown" | Bridge never sent `SNAPSHOT`, or its `guard_connected` isn't a boolean (snapshot rejected). |
| "Guard not feeding" | `GUARD_STATE connected:false` was sent, or snapshot had `guard_connected:false`. |
| Connected, but no events/rows | Events failing validation (section 4.5). Check missing `null` fields first. |
| Policy panel empty | `READY` not sent, or `protect`/`allow` missing from `SNAPSHOT`. |
| Everything works but shows "Demo · mock feed" | A packaged app launched without `--bridge`, or the feed sets `source:"mock"`. |
| Works in Electron, not in browser | Page opened without `?bridge=`, or browser blocks `ws://` from an `https://` page (use `wss://`). Opening via `file://` is fine. |
| Red banner never clears | Only `ERROR` is sticky by design; `BLOCK` clears after 5 s. |
| Counters look low | Only ALLOW/BLOCK count, and only the newest 100 events are retained. |

---

## 10. Files to read next

- `ARCHITECTURE.md` (Contracts 3 and 4: source of truth for the protocol).
- `dashboard/src/lib/guardClient.ts` (the exact validation and state machine).
- `dashboard/mock_bridge.py` (a working Contract 4 server; scenarios `basic|stage|stretch|all`).
- `dashboard/docs/devansh.md` (everything about the dashboard itself).
- `docs/shared.md` (cross-track change log; add an entry whenever you change a contract).
- In the dashboard itself, the **Readme** button in the top bar shows a visual version of section 4.
