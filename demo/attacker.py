#!/usr/bin/env python3
"""attacker.py — the "evil" exfiltration receiver (demo prop).

Run on the HOST (not the protected box — loopback is allowlisted, so the
attacker must live at a non-loopback address like the libvirt gateway):

    python3 demo/attacker.py [--host 0.0.0.0] [--port 9999]

Listens on TCP and UDP and prints everything it receives, with timestamps.
In a successful demo it receives NOTHING — every exfil attempt dies in the
guard (the dashboard shows the BLOCKs). If this ever prints secret-shaped
data, the guard has failed.

No root needed. Standard library only.
"""

import argparse
import socket
import threading
import time


def ts():
    return time.strftime("%H:%M:%S")


def preview(data, limit=2048):
    """Show the whole payload when it's small (that's the moment the demo
    is about: you should be able to SEE the leaked secret), truncate only
    when it's huge."""
    if len(data) <= limit:
        return repr(data)
    return repr(data[:512]) + f" ... <{len(data) - 512} more bytes>"


def handle_tcp(conn, addr, stats):
    try:
        while True:
            data = conn.recv(65536)
            if not data:
                break
            stats["bytes"] += len(data)
            print(f"[{ts()}] TCP got {len(data)} bytes from "
                  f"{addr[0]}:{addr[1]}: {preview(data)}", flush=True)
    except OSError as e:
        print(f"[{ts()}] TCP error from {addr[0]}: {e}", flush=True)
    finally:
        conn.close()
        print(f"[{ts()}] TCP connection from {addr[0]}:{addr[1]} closed",
              flush=True)


def tcp_serve(srv, stats):
    while True:
        conn, addr = srv.accept()
        stats["tcp_conns"] += 1
        print(f"[{ts()}] TCP connection from {addr[0]}:{addr[1]}", flush=True)
        threading.Thread(target=handle_tcp, args=(conn, addr, stats),
                         daemon=True).start()


def udp_serve(s, stats):
    while True:
        data, addr = s.recvfrom(65536)
        stats["udp_pkts"] += 1
        stats["bytes"] += len(data)
        print(f"[{ts()}] UDP got {len(data)} bytes from "
              f"{addr[0]}:{addr[1]}: {preview(data)}", flush=True)


def bind_or_die(family, kind, host, port):
    """Bind here, in main, so a clash fails LOUDLY instead of dying
    silently inside a thread while you stare at the wrong terminal."""
    s = socket.socket(family, kind)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((host, port))
    except OSError as e:
        print(f"[{ts()}] FATAL: cannot bind {host}:{port}: {e}", flush=True)
        print(f"[{ts()}] is another attacker.py already running? "
              f"stop it first: sudo scb demo-down "
              f"(or: pkill -f demo/attacker.py)", flush=True)
        raise SystemExit(2)
    return s


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Demo exfiltration receiver (the villain)")
    ap.add_argument("--host", default="0.0.0.0", help="bind address")
    ap.add_argument("--port", type=int, default=9999, help="bind port")
    args = ap.parse_args(argv)

    tcp_srv = bind_or_die(socket.AF_INET, socket.SOCK_STREAM,
                          args.host, args.port)
    tcp_srv.listen(16)
    print(f"[{ts()}] TCP listening on {args.host}:{args.port}", flush=True)
    udp_srv = bind_or_die(socket.AF_INET, socket.SOCK_DGRAM,
                          args.host, args.port)
    print(f"[{ts()}] UDP listening on {args.host}:{args.port}", flush=True)

    stats = {"tcp_conns": 0, "udp_pkts": 0, "bytes": 0}
    print(f"[{ts()}] attacker waiting on port {args.port} "
          f"(TCP+UDP) for exfiltrated secrets...", flush=True)
    print(f"[{ts()}] in a good demo, nothing secret appears below this line",
          flush=True)
    threading.Thread(target=udp_serve, args=(udp_srv, stats),
                     daemon=True).start()
    try:
        tcp_serve(tcp_srv, stats)
    except KeyboardInterrupt:
        pass
    print(f"[{ts()}] shutting down: {stats['tcp_conns']} TCP connections, "
          f"{stats['udp_pkts']} UDP packets, {stats['bytes']} bytes total",
          flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
