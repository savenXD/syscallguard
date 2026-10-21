#!/usr/bin/env python3
"""mock_bridge.py: Local testing WebSocket feeder implementing Contract 4.

Defaults to the shared desktop demo: 14 allowed requests per blocked request.
Explicit stage/stretch/all scenarios retain their attack rehearsal stories.
"""
import argparse
import asyncio
import json
import time
from pathlib import Path
import websockets

CLIENTS = set()
QUIET = False

# State
STATE = {
    "v": 1,
    "type": "SNAPSHOT",
    "source": "mock",
    "mode": "enforce",
    "guard_connected": True,
    "protect": ["/home/demo/syscallguard/demo/project/.env"],
    "allow": ["127.0.0.0/8", "::1/128"],
    "tagged": [],
    "recent": [],
}


async def broadcast(event: dict):
    # Update snapshot state
    if event["type"] == "TAG":
        original = next((p for p in STATE["tagged"] if p["tgid"] == event["tgid"]), None)
        STATE["tagged"] = [p for p in STATE["tagged"] if p["tgid"] != event["tgid"]]
        STATE["tagged"].append({
            "tgid": event["tgid"],
            "comm": event["comm"],
            "file": event["file"],
            "since": original["since"] if original else event["ts"],
            "parent_tgid": None,
            **({"lineage": event["lineage"]} if event.get("lineage") else {}),
        })
    elif event["type"] == "TAG_INHERIT":
        original = next((p for p in STATE["tagged"] if p["tgid"] == event["tgid"]), None)
        STATE["tagged"] = [p for p in STATE["tagged"] if p["tgid"] != event["tgid"]]
        STATE["tagged"].append({
            "tgid": event["tgid"],
            "comm": event["comm"],
            "file": event["file"],
            "since": original["since"] if original else event["ts"],
            "parent_tgid": event["parent_tgid"],
        })
    elif event["type"] == "UNTAG":
        STATE["tagged"] = [p for p in STATE["tagged"] if p["tgid"] != event["tgid"]]

    if event["type"] == "GUARD_STATE":
        STATE["guard_connected"] = event["connected"]
    else:
        STATE["recent"].insert(0, event)
    if len(STATE["recent"]) > 50:
        STATE["recent"].pop()

    raw = json.dumps(event)
    if not QUIET: print(f"[feeder -> broadcast] {event['type']}: {raw[:90]}...")
    if CLIENTS:
        await asyncio.gather(*[client.send(raw) for client in CLIENTS], return_exceptions=True)


async def story_loop():
    """Use the same mostly-allowed feed as the embedded desktop demo."""
    await rehearsal_loop("basic")


def demo_event(kind, **fields):
    event = {"v": 1, "ts": time.time(), "type": kind, "hook": None, "tgid": None,
             "parent_tgid": None, "comm": None, "file": None, "family": None,
             "daddr": None, "dport": None, "mode": "enforce"}
    event.update(fields)
    return event


def rehearsal_timeline(scenario):
    """60-second, mock-only storyboard. No network attack or kernel enforcement occurs."""
    if scenario == "basic":
        story = json.loads((Path(__file__).resolve().parent / "demo" / "story.json").read_text())
        return [(scene["at"], scene["event"]) for scene in story]
    protected = STATE["protect"][0]
    def process(kind, pid=4421, comm="python3", **extra):
        return demo_event(kind, tgid=pid, comm=comm, file=protected, **extra)
    def network(kind="BLOCK", pid=4421, comm="python3", hook="connect", **extra):
        return process(kind, pid, comm, hook=hook, family="ipv4", daddr="192.168.122.1", dport=9999, **extra)
    timeline = [(0, demo_event("READY", protect=STATE["protect"], allow=STATE["allow"]))]
    if scenario in ("stage", "all"):
        timeline += [
            (1, process("TAG", hook="file_open")),
            (2, process("ALLOW", hook="connect", family="ipv4", daddr="127.0.0.1", dport=8080)),
            (4, network()), (10, process("UNTAG", hook="exit")),
            (12, process("TAG", hook="file_open")),
            (13, process("TAG_INHERIT", 4422, parent_tgid=4421, hook="fork")),
            (16, network(pid=4422, comm="curl")),
            (22, process("UNTAG", 4422, "curl", hook="exit")), (22, process("UNTAG", hook="exit")),
            (24, process("TAG", hook="file_open")),
            (28, network(hook="sendmsg")), (34, process("UNTAG", hook="exit")),
        ]
    if scenario in ("stretch", "all"):
        hop1 = {"writer_tgid": 4601, "writer_comm": "cat", "reader_tgid": 4602, "reader_comm": "tee",
                "inode": "9007199254740993", "kind": "pipe", "path": None}
        hop2 = {"writer_tgid": 4602, "writer_comm": "tee", "reader_tgid": 4603, "reader_comm": "curl",
                "inode": "9007199254740995", "kind": "file", "path": "/tmp/sg-demo-copy"}
        def medium(hop):
            return {key: hop[key] for key in ("inode", "kind", "path")}
        offset = 0 if scenario == "all" else -34
        stretch = [
            (36, process("TAG", hook="file_open")),
            (38, process("BLOCK", hook="socket_create", socket_family="AF_PACKET", socket_type="SOCK_RAW")),
            (44, process("BLOCK", hook="socket_create", socket_family="AF_INET", socket_type="SOCK_RAW")),
            (49, process("UNTAG", hook="exit")),
            (50, process("TAG", 4601, "cat", hook="file_open")),
            (50.3, process("TAINT", 4601, "cat", hook="file_permission", taint=medium(hop1))),
            (50.6, process("TAG", 4602, "tee", hook="file_permission", lineage=[hop1])),
            (50.9, process("TAINT", 4602, "tee", hook="file_permission", taint=medium(hop2))),
            (51.2, process("TAG", 4603, "curl", hook="file_permission", lineage=[hop1, hop2])),
            (52, network(pid=4603, comm="curl", lineage=[hop1, hop2])),
            (58, process("UNTAG", 4603, "curl", hook="exit")),
            (58, process("UNTAG", 4602, "tee", hook="exit")),
            (58, process("UNTAG", 4601, "cat", hook="exit")),
        ]
        timeline += [(at + offset, event) for at, event in stretch]
    return sorted(timeline, key=lambda item: item[0])


async def rehearsal_loop(scenario):
    while True:
        started = time.monotonic()
        for at, event in rehearsal_timeline(scenario):
            await asyncio.sleep(max(0, started + at - time.monotonic()))
            event["ts"] = time.time()
            await broadcast(event)
        await asyncio.sleep(max(0, started + 60 - time.monotonic()))


async def handler(websocket):
    CLIENTS.add(websocket)
    print(f"[feeder] Client connected from {websocket.remote_address}")
    try:
        # Send initial snapshot immediately
        snapshot_raw = json.dumps(STATE)
        await websocket.send(snapshot_raw)
        async for _ in websocket:
            pass
    finally:
        CLIENTS.remove(websocket)
        print(f"[feeder] Client disconnected: {websocket.remote_address}")


async def stress_loop(rate):
    """Bounded synthetic traffic for a real-time host soak; no kernel dependencies."""
    count = 0
    deadline = time.monotonic()
    while True:
        count += 1
        await broadcast({"v": 1, "ts": time.time(), "type": "BLOCK" if count % 100 == 0 else "ALLOW",
                         "hook": "connect", "tgid": 4421, "parent_tgid": None, "comm": "python3",
                         "file": STATE["protect"][0], "family": "ipv4",
                         "daddr": "192.168.122.1" if count % 100 == 0 else "127.0.0.1",
                         "dport": 9999 if count % 100 == 0 else 8080, "mode": "enforce"})
        deadline += 1 / rate
        await asyncio.sleep(max(0, deadline - time.monotonic()))


async def main():
    global QUIET
    parser = argparse.ArgumentParser(description="Mock SyscallGuard bridge feeder")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--rate", type=float, default=0, help="Stress traffic events/sec; 0 plays the demo story")
    parser.add_argument("--duration", type=float, default=0, help="Stop after this many seconds; 0 runs continuously")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-event logs during profiling")
    parser.add_argument("--scenario", choices=["basic", "stage", "stretch", "all"], default="basic",
                        help="basic story, 60s stage rehearsal, proposed stretch events, or all scenes")
    args = parser.parse_args()
    if args.rate < 0 or args.duration < 0:
        parser.error("rate and duration must be nonnegative")
    QUIET = args.quiet

    print(f"[feeder] Starting WebSocket feeder on ws://{args.host}:{args.port}")
    async with websockets.serve(handler, args.host, args.port):
        loop = stress_loop(args.rate) if args.rate else story_loop() if args.scenario == "basic" else rehearsal_loop(args.scenario)
        if args.duration:
            try:
                await asyncio.wait_for(loop, args.duration)
            except asyncio.TimeoutError:
                pass
        else:
            await loop


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[feeder] Stopped.")
