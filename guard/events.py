"""Decode ring-buffer records into the Contract 3 JSON event schema."""

from dataclasses import dataclass
import ipaddress
import struct


_EVENT = struct.Struct("<QQIIIIHH16s16s")
SG_EV_TAG = 1
SG_EV_TAG_INHERIT = 2
SG_EV_ALLOW = 3
SG_EV_BLOCK = 4
SG_EV_WOULD_BLOCK = 5
SG_EV_UNTAG = 6
SG_HOOK_NONE = 0
SG_HOOK_FILE_OPEN = 1
SG_HOOK_CONNECT = 2
SG_HOOK_SENDMSG = 3
SG_HOOK_FORK = 4
SG_HOOK_EXIT = 5
_EVENT_TYPES = {
    SG_EV_TAG: "TAG",
    SG_EV_TAG_INHERIT: "TAG_INHERIT",
    SG_EV_ALLOW: "ALLOW",
    SG_EV_BLOCK: "BLOCK",
    SG_EV_WOULD_BLOCK: "WOULD_BLOCK",
    SG_EV_UNTAG: "UNTAG",
}
_HOOKS = {
    SG_HOOK_NONE: None,
    SG_HOOK_FILE_OPEN: "file_open",
    SG_HOOK_CONNECT: "connect",
    SG_HOOK_SENDMSG: "sendmsg",
    SG_HOOK_FORK: "fork",
    SG_HOOK_EXIT: "exit",
}
_FAMILIES = {0, 2, 10}


@dataclass
class EventContext:
    """Context needed to turn a kernel record into a user-facing event."""

    inode_paths: dict[int, str]
    boot_time_epoch: float
    mode: str


def decode_event(data: bytes, ctx: EventContext) -> dict | None:
    """Decode one ``sg_event`` record, or return ``None`` for malformed bytes."""
    try:
        ts_ns, ino, event_type, hook, tgid, parent_tgid, family, dport, daddr, comm = (
            _EVENT.unpack_from(data)
        )
    except (struct.error, TypeError, BufferError):
        return None

    event_name = _EVENT_TYPES.get(event_type)
    if event_name is None or hook not in _HOOKS or family not in _FAMILIES:
        return None

    if family == 2:
        address = str(ipaddress.IPv4Address(daddr[:4]))
        family_name = "ipv4"
    elif family == 10:
        address = str(ipaddress.IPv6Address(daddr))
        family_name = "ipv6"
    else:
        address = None
        family_name = None

    return {
        "v": 1,
        "ts": ctx.boot_time_epoch + ts_ns / 1_000_000_000,
        "type": event_name,
        "hook": _HOOKS[hook],
        "tgid": tgid,
        "parent_tgid": parent_tgid if event_type == SG_EV_TAG_INHERIT else None,
        "comm": comm.split(b"\0", 1)[0].decode("utf-8", errors="replace"),
        "file": ctx.inode_paths.get(ino) if ino else None,
        "family": family_name,
        "daddr": address,
        "dport": dport if family else None,
        "mode": ctx.mode,
    }
