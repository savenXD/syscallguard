#!/usr/bin/env python3
"""internal_api.py — the INNOCENT service (demo prop).

Run on the PROTECTED box:
    python3 demo/internal_api.py [--host 127.0.0.1] [--port 8080]

A tiny HTTP API the agent is *supposed* to talk to. It lives on loopback,
which the policy allowlists (127.0.0.0/8), so the guard lets even tagged
processes through — the dashboard shows green ALLOWs for these.

This is the "allowlist instead of deny-all" argument made visible: the
agent keeps doing its real job while exfiltration to the outside dies.

No root needed. Standard library only.
"""

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


def ts():
    return time.strftime("%H:%M:%S")


class Handler(BaseHTTPRequestHandler):
    # Replace the noisy default logging with one clean line per request.
    # The line says explicitly that this is the LEGITIMATE job: the agent
    # never sends the secret here, so don't expect the attacker to react
    # to this request — the exfil goes agent -> attacker:9999 directly.
    def log_message(self, fmt, *args):
        print(f"[{ts()}] {self.client_address[0]}:{self.client_address[1]} "
              f"{self.command} {self.path} "
              f"(legit job — the agent never sends the secret here)",
              flush=True)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "service": "internal-api"})
        elif self.path == "/":
            self._json({"service": "internal-api",
                        "endpoints": ["GET /health", "POST /query"]})
        else:
            self._json({"error": "not found"}, code=404)

    def do_POST(self):
        if self.path == "/query":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b""
            try:
                q = json.loads(body) if body else {}
            except json.JSONDecodeError:
                q = {"raw": body.decode("utf-8", "replace")[:200]}
            # The legitimate job: answer questions WITHOUT touching the secret.
            self._json({"answer": f"processed query: {str(q.get('q', ''))[:80]}",
                        "secret_used": False})
        else:
            self._json({"error": "not found"}, code=404)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Demo internal API (the innocent service)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args(argv)

    srv = HTTPServer((args.host, args.port), Handler)
    print(f"[{ts()}] internal-api on http://{args.host}:{args.port} "
          f"(allowlisted: the guard lets tagged processes through)",
          flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    print(f"[{ts()}] internal-api shutting down", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
