# reset.sh: reset the demo between runs (inside the VM).
# Track: D (Demo kit & verification).
#
# TODO (M7 Freeze):
#   - kill leftover agent.py / internal_api.py / curl
#   - restart internal_api.py
#   - clear the screen
#!/usr/bin/env bash
# reset.sh — clean the demo stage between runs.
#
# Run BEFORE each demo run, in the terminal you will demo from:
#     bash demo/reset.sh
#
# Kills leftover demo processes and removes temp artifacts. What it CANNOT
# do is untag your current shell: taint is hereditary via fork, so if this
# shell (or any ancestor) ever opened the protected .env, every child it
# spawns is born tagged. If a run looks wrong, open a FRESH terminal.
set -uo pipefail

echo "== SyscallGuard demo reset =="

# 1. Kill leftover demo processes, by script path (never by port — ports
#    can be reused by unrelated programs).
#
#    The SERVERS (internal_api, attacker) never exit on their own: they
#    listen forever, so a second run would crash with "address already in
#    use" if we didn't kill them. The guard/bridge are long-running too.
#    agent.py normally exits by itself after each mode — killing it is just
#    insurance against a stuck run (e.g. a hung curl child) contaminating
#    the next demo with stale tagged processes.
for pat in "guard/guard.py" "bridge/bridge.py" "demo/agent.py" \
           "demo/internal_api.py" "demo/attacker.py" \
           "scripts/lsm_smoke_test.py"; do
    if pkill -f "$pat" 2>/dev/null; then
        echo "  killed: $pat"
    fi
done
# Electron dashboard, if started from this repo (its window title carries
# the app name).
if pkill -f "syscallguard-dashboard" 2>/dev/null; then
    echo "  killed: dashboard"
fi

# 2. BPF programs detach THEMSELVES: when the loader (guard.py) dies, the
#    kernel closes its file descriptors and unlinks the LSM hooks. There is
#    nothing to unload by hand. Best-effort check that nothing of ours is
#    still attached:
if command -v bpftool >/dev/null 2>&1; then
    if bpftool prog show 2>/dev/null | grep -qi "syscallguard"; then
        echo "  WARNING: a syscallguard BPF program still shows in bpftool;"
        echo "           its loader may still be alive — check ps."
    else
        echo "  no syscallguard BPF programs attached"
    fi
else
    echo "  (bpftool not installed — skipping attach check)"
fi

# 3. Temp artifacts from smoke tests and demo runs.
rm -f /tmp/sg_smoke_secret /tmp/sg_demo_*.log /tmp/agent_exfil_*.tmp
echo "  temp files cleaned"

echo
echo "  NOTE: taint is hereditary via fork — this script cannot untag"
echo "  your shell. For a clean run, use a terminal that has never"
echo "  opened the protected file."
echo "== reset done =="
