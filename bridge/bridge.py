"""Relay guard JSON lines to WebSocket clients and provide state snapshots."""

import argparse
import asyncio
from collections import deque
import json
import sys
import time

from websockets.exceptions import ConnectionClosed
from websockets.asyncio.server import ServerConnection, serve


PROTECTED_FILE = "/home/demo/syscallguard/demo/project/.env"
ALLOWLIST = ["127.0.0.0/8", "::1/128"]


class Bridge:
    def __init__(self):
        self.mode = None
        self.protect = []
        self.allow = []
        self.tagged = {}
        self.recent = deque(maxlen=50)
        self.guard_connected = True
        self.clients = set()
        self.lock = asyncio.Lock()

    def snapshot(self):
        return {
            "v": 1,
            "type": "SNAPSHOT",
            "mode": self.mode,
            "guard_connected": self.guard_connected,
            "protect": self.protect,
            "allow": self.allow,
            "tagged": list(self.tagged.values()),
            "recent": list(self.recent),
        }

    def update(self, event):
        event_type = event.get("type")
        if "mode" in event and (event_type == "READY" or self.mode is not None):
            self.mode = event["mode"]
        if event_type == "READY":
            self.protect = event.get("protect", [])
            self.allow = event.get("allow", [])
        elif event_type in ("TAG", "TAG_INHERIT"):
            tgid = event.get("tgid")
            if isinstance(tgid, int) and not isinstance(tgid, bool):
                previous = self.tagged.get(tgid)
                self.tagged[tgid] = {
                    "tgid": tgid,
                    "comm": event.get("comm"),
                    "file": event.get("file"),
                    "since": previous["since"] if previous else event.get("ts"),
                    "parent_tgid": event.get("parent_tgid"),
                }
        elif event_type == "UNTAG":
            tgid = event.get("tgid")
            if isinstance(tgid, int) and not isinstance(tgid, bool):
                self.tagged.pop(tgid, None)
        if event_type != "GUARD_STATE":
            self.recent.append(event)

    async def _send(self, client, message):
        await asyncio.wait_for(client.send(message), timeout=1.0)

    async def _broadcast_locked(self, message):
        clients = tuple(self.clients)
        if not clients:
            return
        results = await asyncio.gather(
            *(self._send(client, message) for client in clients),
            return_exceptions=True,
        )
        for client, result in zip(clients, results):
            if isinstance(result, BaseException):
                self.clients.discard(client)
                asyncio.create_task(client.close(code=1011, reason="WebSocket send failed"))

    async def publish(self, raw_line):
        try:
            event = json.loads(raw_line)
            if not isinstance(event, dict):
                raise ValueError("event must be a JSON object")
        except (json.JSONDecodeError, ValueError) as exc:
            print(f"Skipping malformed guard input: {exc}", file=sys.stderr, flush=True)
            return

        async with self.lock:
            self.update(event)
            await self._broadcast_locked(raw_line)

    async def publish_guard_exit(self):
        async with self.lock:
            self.guard_connected = False
            await self._broadcast_locked(
                json.dumps({"v": 1, "type": "GUARD_STATE", "connected": False}, separators=(",", ":"))
            )

    async def handle_client(self, client: ServerConnection):
        async with self.lock:
            self.clients.add(client)
            try:
                await self._send(
                    client,
                    json.dumps(self.snapshot(), separators=(",", ":")),
                )
            except (TimeoutError, OSError, ConnectionClosed):
                self.clients.discard(client)
                return

        try:
            async for _message in client:
                pass
        finally:
            async with self.lock:
                self.clients.discard(client)

    async def read_stdin(self):
        while True:
            raw_bytes = await asyncio.to_thread(sys.stdin.buffer.readline)
            if not raw_bytes:
                break
            raw_bytes = raw_bytes.rstrip(b"\r\n")
            try:
                raw_line = raw_bytes.decode("utf-8")
            except UnicodeDecodeError as exc:
                print(f"Skipping malformed guard input: {exc}", file=sys.stderr, flush=True)
                continue
            if raw_line:
                await self.publish(raw_line)

        print("Guard event input reached EOF; keeping the last state.", file=sys.stderr, flush=True)
        await self.publish_guard_exit()

    async def run_fake(self):
        while True:
            started = asyncio.get_running_loop().time()
            story = [
                {
                    "v": 1, "type": "READY", "hook": None, "tgid": None,
                    "parent_tgid": None, "comm": None, "file": None,
                    "family": None, "daddr": None, "dport": None,
                    "mode": "enforce", "protect": [PROTECTED_FILE], "allow": ALLOWLIST,
                },
                {
                    "v": 1, "type": "TAG", "hook": "file_open", "tgid": 4421,
                    "parent_tgid": None, "comm": "python3", "file": PROTECTED_FILE,
                    "family": None, "daddr": None, "dport": None, "mode": "enforce",
                },
                {
                    "v": 1, "type": "ALLOW", "hook": "connect", "tgid": 4421,
                    "parent_tgid": None, "comm": "python3", "file": PROTECTED_FILE,
                    "family": "ipv4", "daddr": "127.0.0.1", "dport": 8080,
                    "mode": "enforce",
                },
                {
                    "v": 1, "type": "TAG_INHERIT", "hook": "fork", "tgid": 4422,
                    "parent_tgid": 4421, "comm": "python3", "file": PROTECTED_FILE,
                    "family": None, "daddr": None, "dport": None, "mode": "enforce",
                },
                {
                    "v": 1, "type": "BLOCK", "hook": "connect", "tgid": 4422,
                    "parent_tgid": None, "comm": "curl", "file": PROTECTED_FILE,
                    "family": "ipv4", "daddr": "192.168.122.1", "dport": 9999,
                    "mode": "enforce",
                },
                {
                    "v": 1, "type": "UNTAG", "hook": "exit", "tgid": 4422,
                    "parent_tgid": None, "comm": "curl", "file": PROTECTED_FILE,
                    "family": None, "daddr": None, "dport": None, "mode": "enforce",
                },
                {
                    "v": 1, "type": "UNTAG", "hook": "exit", "tgid": 4421,
                    "parent_tgid": None, "comm": "python3", "file": PROTECTED_FILE,
                    "family": None, "daddr": None, "dport": None, "mode": "enforce",
                },
            ]
            for event in story:
                event["ts"] = time.time()
                await self.publish(json.dumps(event, separators=(",", ":")))
                await asyncio.sleep(1)
            await asyncio.sleep(max(0, 10 - (asyncio.get_running_loop().time() - started)))


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="WebSocket bind address")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default: 8765)")
    parser.add_argument("--fake", action="store_true", help="generate demo events without a guard")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    return args


async def main():
    args = parse_args()
    bridge = Bridge()
    async with serve(bridge.handle_client, args.host, args.port):
        print(f"WebSocket bridge listening on {args.host}:{args.port}", file=sys.stderr, flush=True)
        if args.fake:
            await bridge.run_fake()
        else:
            await bridge.read_stdin()
            await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
