#!/usr/bin/env bash
# reset.sh — clean the demo stage between judges (run in the VM).
#
#     bash demo/reset.sh
#
# Leaves the guard | bridge pipeline, the attacker and the dashboard running:
# killing the bridge would take the guard's stdout away mid-demo. Kills only
# leftover agent.py and curl processes, then restarts internal_api.py.
# It cannot untag your shell: if this shell ever opened the protected .env,
# its children are born tagged. Use a fresh terminal for a clean run.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "== SyscallGuard demo reset =="

# 1. Leftover agent runs (a hung curl child would carry a stale tag).
pkill -f "demo/agent.py" 2>/dev/null && echo "  killed: demo/agent.py"
pkill -x curl 2>/dev/null && echo "  killed: curl"

# 2. Restart the internal API so the agent's allowed POST works on the next run.
pkill -f "demo/internal_api.py" 2>/dev/null && sleep 0.5
nohup python3 demo/internal_api.py >/tmp/internal_api.log 2>&1 &
echo "  internal_api.py restarted (pid $!, log /tmp/internal_api.log)"

# 3. The guard's hooks should still be attached. sudo -n never prompts for a password.
if ! sudo -n true 2>/dev/null; then
    echo "  hook check skipped (sudo would prompt)"
elif sudo -n bpftool prog list 2>/dev/null | grep -q lsm__file_open; then
    echo "  guard hooks attached (lsm__file_open loaded)"
else
    echo "  WARNING: lsm__file_open is not loaded: the guard is NOT running."
    echo "           Restart the whole guard | bridge pipeline before the next judge."
fi

echo "== reset done =="
