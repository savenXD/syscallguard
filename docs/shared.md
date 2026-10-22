# Shared changes log

## Purpose

If you change something another track depends on, record it here. If you are about to start work, read the entries added since you last worked.

This is how news travels between tracks. Nobody edits another person's file; they read this log, and their agent picks up the change next session.

## When to write an entry (required)

- Any `contract:` change: structs in `guard/bpf/sg_common.h`, map names, the JSON event schema, the WebSocket protocol, the policy format.
- Any change to a function signature another track calls (e.g. `decode_event` in `guard/events.py`).
- Renaming or moving a file another track references.
- Changing a CLI flag, port, or file path used in another track's runbook or commands.
- Discovering that a documented behaviour is wrong (in `ARCHITECTURE.md`, `AGENTS.md`, `README.md` or someone's person file).
- Creating a new person file because you started work in a new folder.

A `contract:` commit must include its entry here **in the same commit**.

## When not to write

Work that stays inside your own files and changes nothing another track can see. That goes in the work log of your own person file instead.

## Format

- Newest entries at the bottom. Append-only.
- Never edit or delete someone else's entry. To correct one, add a new `correction` entry that points at it.
- Heading line: `### <date> · <person> (track <X>) · <kind>`, where `<kind>` is exactly one of `contract`, `signature`, `path`, `correction`.
- Then exactly these four fields: **What changed**, **Who is affected**, **Action required**, **Commit**.

Template:

```
### YYYY-MM-DD · Name (track X) · contract|signature|path|correction
**What changed:** one or two sentences.
**Who is affected:** names, and which of their files.
**Action required:** name — what they must do. Or "none, informational".
**Commit:** the commit subject line.
```

---

## Entries

### 2026-10-18 · Setup (track all) · contract
**What changed:** Initial contracts are in place: Contract 1 (`guard/bpf/sg_common.h` structs and the six map names), Contract 2 (policy TOML), Contract 3 (guard CLI and JSON event schema), Contract 4 (bridge WebSocket protocol). All are written down in `ARCHITECTURE.md`. The `decode_event(data, ctx)` signature in `guard/events.py` is agreed and documented in `guard/docs/divyanshu.md`.
**Who is affected:** Everyone. Azaan (structs/maps), Hifza (loader, policy), Divyanshu (decoder, bridge), Devansh (dashboard consumes Contracts 3 and 4), Suyash (demo and tests rely on all four).
**Action required:** none, informational. Build against these; propose changes with a `contract:` commit plus an entry here.
**Commit:** chore: bootstrap SyscallGuard repository

### 2026-10-18 · Azaan (track K) · contract
**What changed:** `TAG_INHERIT` no longer asserts a process name. Hook D runs at fork, before `exec`, so its `comm` is the parent's name. M2 acceptance (PROJECT_BRIEF Part 9, AGENTS.md) now checks `TAG_INHERIT` for the child tgid with `parent_tgid` = the python3 tgid instead of `TAG_INHERIT (sleep)`. Contract 3 `comm` row documents this. Contract 4 `--fake` story: `TAG_INHERIT` carries comm `python3`; `curl` appears only on the `BLOCK`.
**Who is affected:** Divyanshu (bridge `--fake` story; decoder passes `comm` through as-is), Devansh (tagged list shows the fork-time name for inherited entries), Suyash (M2 run in the VM).
**Action required:** Divyanshu — build the fake story with the new comms. Devansh — don't assume an inherited entry's `comm` is the child's program.
**Commit:** contract: TAG_INHERIT name not asserted, hook C emits no ALLOW, resolve open questions

### 2026-10-18 · Azaan (track K) · contract
**What changed:** Hook C (`socket_sendmsg`) never emits `ALLOW`; only hook B (`socket_connect`) does. Allowed sends are silent; disallowed sends still emit `WOULD_BLOCK`/`BLOCK`. Hook table and `check_dest` updated in ARCHITECTURE.md and PROJECT_BRIEF 5.2.
**Who is affected:** Azaan (`syscallguard.bpf.c`), Divyanshu (`ALLOW` always has `hook = "connect"`, fake `ALLOW` too), Devansh (fewer `ALLOW` log lines), Suyash (M3 `ALLOW` still comes from the connect).
**Action required:** Azaan — emit `ALLOW` only when `hook == SG_HOOK_CONNECT`. Others: none.
**Commit:** contract: TAG_INHERIT name not asserted, hook C emits no ALLOW, resolve open questions

### 2026-10-18 · Azaan (track K) · contract
**What changed:** Open questions resolved into Contracts 2–4. Contract 2: missing `mode` → `audit`; `protect` must be non-empty; `allow` may be empty; unknown keys rejected; no map-size checks. Contract 3: `comm` is `null` on `READY`/`ERROR`; guard exit codes `0` clean shutdown, `2` bad policy, `3` BPF load failure (an `ERROR` event goes to stdout first); `--debug` is verbose stderr only. Contract 4: bridge `--host` defaults to `127.0.0.1`; malformed stdin line skipped and logged to stderr; repeat `TAG` keeps the original `since`; `SNAPSHOT.mode` is `null` before `READY`; on stdin EOF the bridge keeps serving the last state. Decoder: `decode_event` returns `None` only for a short/malformed buffer; unknown inode → still emitted with `file: null`. Dashboard: banner green except `BLOCK` (red), `WOULD_BLOCK` (amber), `ERROR` (red, shows `message`); null fields omitted from banner text; log keeps 100 entries.
**Who is affected:** Hifza (policy.py, guard.py), Divyanshu (events.py, bridge.py), Devansh (dashboard), Suyash (runbook, exit codes in scripts).
**Action required:** Each person — build to the updated section 4 of your person file.
**Commit:** contract: TAG_INHERIT name not asserted, hook C emits no ALLOW, resolve open questions

### 2026-10-18 · Azaan (track K) · path
**What changed:** Native IPv6 dropped from the demo: `agent.py --exfil ipv6` removed from the spec (PROJECT_BRIEF 5.6, AGENTS.md), the `--exfil ipv6 blocked` clause removed from M4, the native IPv6 row removed from the attack matrix and the judge invitation list. IPv4-mapped IPv6 stays in the matrix (it uses IPv4 routing). The "any port" matrix row uses ports 9999 and 4444. `agent.py --exfil curl` detects failure by curl exit code 7.
**Who is affected:** Suyash (agent.py, attack_matrix.py, runbook), Azaan (M4 acceptance).
**Action required:** Suyash — don't build the `ipv6` mode; matrix confirms the curl block via the guard's `BLOCK` event, since exit 7 also means "refused".
**Commit:** contract: TAG_INHERIT name not asserted, hook C emits no ALLOW, resolve open questions

### 2026-10-18 · Azaan (track K) · correction
**What changed:** Ownership and paths corrected. `tests/test_policy.py` belongs to Hifza; the rest of `tests/` stays Suyash's. S2 belongs to Track K only (was "K + G"). Track P (presentation, `docs/presentation/`) is Suyash's second hat. The backup video: Suyash records, Azaan verifies. `policy/policy.toml` is now gitignored; `policy/policy.example.toml` stays committed with its `/home/demo/...` placeholder.
**Who is affected:** Hifza, Suyash, Azaan.
**Action required:** Suyash — keep VM paths in your local `policy/policy.toml` only. Hifza — you write `tests/test_policy.py`.
**Commit:** contract: TAG_INHERIT name not asserted, hook C emits no ALLOW, resolve open questions

### 2026-10-18 · Azaan (track K) · path
**What changed:** New file `tests/test_events.py` (unprivileged decoder tests), owned by Divyanshu. The rest of `tests/` stays Suyash's except `tests/test_policy.py` (Hifza). AGENTS.md, README and Divyanshu's person file updated.
**Who is affected:** Divyanshu (owns it), Suyash (`tests/` no longer entirely his).
**Action required:** Divyanshu — put decoder tests there. Suyash — don't edit it.
**Commit:** contract: add GUARD_STATE to bridge protocol; test_events.py ownership; editor/inode gap

### 2026-10-18 · Azaan (track K) · contract
**What changed:** Contract 4 gains a bridge message `{"v":1,"type":"GUARD_STATE","connected":bool}`. The bridge sends `connected:false` on stdin EOF (guard gone) and `connected:true` when the guard feed reconnects; `SNAPSHOT` carries the current value as `"guard_connected"`; `--fake` always reports `true`; `GUARD_STATE` is not added to `recent`. The dashboard shows two separate indicators: bridge reachable and guard feeding. Also: the `ERROR` banner is sticky until the next event (dashboard only, not a contract change).
**Who is affected:** Divyanshu (bridge.py), Devansh (dashboard).
**Action required:** Divyanshu — send `GUARD_STATE` and add `guard_connected` to `SNAPSHOT`. Devansh — add the guard-feeding indicator; don't log `GUARD_STATE`.
**Commit:** contract: add GUARD_STATE to bridge protocol; test_events.py ownership; editor/inode gap

### 2026-10-18 · Azaan (track K) · correction
**What changed:** Documented a gap: the guard reads the protected file's inode once at startup, so an editor that saves by writing a new file and renaming it silently ends protection until the guard restarts. Recorded in `guard/docs/azaan.md` (known gaps) and the demo runbook rule: never edit `demo/project/.env` while the guard is running; restart the guard if you do.
**Who is affected:** Suyash (runbook, rehearsals), everyone who edits `.env` during testing.
**Action required:** Suyash — follow the rule in rehearsals and on stage. Others — restart the guard after editing `.env`.
**Commit:** contract: add GUARD_STATE to bridge protocol; test_events.py ownership; editor/inode gap

### 2026-10-18 · Azaan (track K) · contract
**What changed:** Contract 4: `GUARD_STATE` has no reconnect case. The bridge sends `connected:false` on guard EOF and stays there; the earlier entry's "`connected:true` when the guard feed reconnects" is withdrawn. Restarting the guard means restarting the whole `guard.py | bridge.py` pipeline; the new bridge starts with `guard_connected: true`. Documented as the normal reset in Suyash's runbook and `docs/presentation/demo-runbook.md`.
**Who is affected:** Divyanshu (bridge.py), Devansh (guard-feeding indicator only goes back to true via a new `SNAPSHOT` after the pipeline restarts), Suyash (runbook).
**Action required:** Divyanshu — don't implement a reconnect path. Suyash — never restart `guard.py` alone; restart the pipeline.
**Commit:** contract: GUARD_STATE has no reconnect; restart means whole pipeline

### 2026-10-19 · Azaan (track K) · correction
**What changed:** The BPF program needs `-fms-extensions` in bcc's cflags. Kernel 7.x headers use anonymous tagged struct members (`struct __filename_head;` in `struct filename`, `linux/fs.h`), which clang only accepts with that flag. Without it, compiling `guard/bpf/syscallguard.bpf.c` fails on `static_assert(sizeof(struct filename) % 64 == 0)`, and any such struct would get wrong field offsets. The documented load call `BPF(src_file=..., cflags=["-I<abs path to guard/bpf>"])` (ARCHITECTURE.md implementation notes, brief 5.2, guard/docs/hifza.md) is therefore incomplete. Verified on a host compile against 7.2.9 headers; VM confirmation pending in the M1 run, after which ARCHITECTURE.md/brief get a `contract:` update.
**Who is affected:** Hifza (`guard/guard.py` load call).
**Action required:** Hifza — load with `cflags=["-I" + <abs path to guard/bpf>, "-fms-extensions"]`.
**Commit:** feat(kernel): M1 hook A file_open tagging

### 2026-10-20 · Azaan (track K) · contract
**What changed:** Contract 2 clarified for cases it didn't state. A missing `allow` key is treated as empty. A missing `protect` key is rejected, same as an empty one. `allow` entries must be strings; a non-string entry is rejected (an integer like `5` would otherwise silently become `0.0.0.5/32`). No change to any case the contract already covered.
**Who is affected:** Hifza (`guard/policy.py` and `test_policy.py`).
**Action required:** Hifza, check that `policy.py` does all three; the string check on `allow` entries is the one most likely to be missing. Add a test for each.
**Commit:** contract: clarify Contract 2 edge cases (missing/empty keys, allow entry types)

### 2026-10-20 · Devansh (track U) · path
**What changed:** Dashboard-only mock rehearsal and proposed stretch payload handoff are documented in `dashboard/docs/phase4-demo.md` and `dashboard/docs/stretch-demo-protocol.md`. `dashboard/mock_bridge.py --scenario stage|stretch|all` labels its SNAPSHOT as mock; S1/S2 prototype payloads are accepted only in that mock context. Actual ARCHITECTURE.md Contracts 1–4 are unchanged.
**Who is affected:** Azaan (future S1/S2 kernel output), Divyanshu (future decoder/bridge provenance and snapshots), Suyash (rehearsal/video).
**Action required:** Informational for now. Before real integration, K/G must agree actual raw-socket and taint event/snapshot metadata and update the shared contracts; the mock payload document is a proposal, not an implemented kernel interface. The recorded video is labelled mock and is not enforcement evidence.
**Commit:** uncommitted working-tree changes (dashboard demo preparation)

### 2026-10-20 · Devansh (track U) · path
**What changed:** Added `dashboard/README.md` desktop run instructions, `dashboard/branding/` editable logo sources, generated native/browser icons, and Linux AppImage/unpacked outputs under gitignored `dashboard/release/`. `npm run demo` uses an embedded loopback mock feed and needs no Python terminal. Packaged apps default to visibly labelled demo mode unless `--bridge=`, `SG_BRIDGE_URL`, or `--live` selects the real feed; source `npm start` retains its real localhost default.
**Who is affected:** Divyanshu (real bridge integration), Suyash (stage launches and fallback distribution), Devansh (branding and releases).
**Action required:** Use an explicit VM bridge address for real packaged demonstrations. `npm run demo -- --kiosk` is the self-contained mock rehearsal command. Existing guard/bridge contracts and other tracks' implementation files are unchanged.
**Commit:** uncommitted working-tree changes (desktop branding and packaging)

### 2026-10-22 · Azaan (track K) · contract
**What changed:** The BPF load call now includes `-fms-extensions`: `BPF(src_file=..., cflags=["-I<abs path to guard/bpf>", "-fms-extensions"])` in ARCHITECTURE.md (implementation notes), PROJECT_BRIEF 5.2 and guard/docs/hifza.md. This lands the contract update promised in the 2026-10-19 correction; without the flag the program does not compile on 7.x headers. Also corrected guard/docs/hifza.md: hook B emits the `ALLOW` on connect, so M3 does not need hook C.
**Who is affected:** Hifza (guard.py load call; already uses the flag on fix/demo-ready).
**Action required:** none, informational.
**Commit:** contract: add -fms-extensions to BPF load cflags
