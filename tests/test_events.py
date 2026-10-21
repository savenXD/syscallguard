"""Unprivileged tests for the Contract 3 ring-buffer event decoder."""

import struct
import unittest

from guard.events import EventContext, decode_event


EVENT = struct.Struct("<QQIIIIHH16s16s")
CONTEXT = EventContext({1234: "/project/.env"}, 1_760_600_000.0, "enforce")


def pack_event(
    *, ts_ns=5_000_000_000, ino=1234, event_type=4, hook=2,
    tgid=4421, parent_tgid=0, family=2, dport=9999,
    daddr=bytes((192, 168, 122, 1)) + bytes(12), comm=b"curl",
):
    return EVENT.pack(
        ts_ns, ino, event_type, hook, tgid, parent_tgid, family,
        dport, daddr, comm.ljust(16, b"\0")[:16],
    )


class DecodeEventTests(unittest.TestCase):
    def test_decodes_ipv4_block_and_accepts_struct_tail_padding(self):
        event = decode_event(pack_event() + bytes(4), CONTEXT)

        self.assertEqual(event, {
            "v": 1,
            "ts": 1_760_600_005.0,
            "type": "BLOCK",
            "hook": "connect",
            "tgid": 4421,
            "parent_tgid": None,
            "comm": "curl",
            "file": "/project/.env",
            "family": "ipv4",
            "daddr": "192.168.122.1",
            "dport": 9999,
            "mode": "enforce",
        })

    def test_decodes_ipv6_and_inherited_parent(self):
        event = decode_event(pack_event(
            event_type=2,
            hook=4,
            tgid=4422,
            parent_tgid=4421,
            family=10,
            daddr=bytes.fromhex("20010db8000000000000000000000001"),
            dport=8080,
        ), CONTEXT)

        self.assertEqual(event["type"], "TAG_INHERIT")
        self.assertEqual(event["hook"], "fork")
        self.assertEqual(event["parent_tgid"], 4421)
        self.assertEqual(event["family"], "ipv6")
        self.assertEqual(event["daddr"], "2001:db8::1")

    def test_unknown_inode_and_no_address_are_kept_as_null(self):
        event = decode_event(pack_event(ino=0, family=0, dport=9999), CONTEXT)

        self.assertIsNotNone(event)
        self.assertIsNone(event["file"])
        self.assertIsNone(event["family"])
        self.assertIsNone(event["daddr"])
        self.assertIsNone(event["dport"])

    def test_comm_stops_at_nul_and_replaces_invalid_utf8(self):
        event = decode_event(pack_event(comm=b"agent\0\xffignored"), CONTEXT)
        invalid_utf8_event = decode_event(pack_event(comm=b"ag\xffent"), CONTEXT)

        self.assertEqual(event["comm"], "agent")
        self.assertEqual(invalid_utf8_event["comm"], "ag\ufffdent")

    def test_non_inherited_events_have_no_parent(self):
        event = decode_event(pack_event(parent_tgid=15), CONTEXT)
        self.assertIsNone(event["parent_tgid"])

    def test_short_or_invalid_records_are_dropped(self):
        self.assertIsNone(decode_event(b"short", CONTEXT))
        self.assertIsNone(decode_event(None, CONTEXT))
        self.assertIsNone(decode_event(pack_event(event_type=99), CONTEXT))
        self.assertIsNone(decode_event(pack_event(hook=99), CONTEXT))
        self.assertIsNone(decode_event(pack_event(family=99), CONTEXT))


if __name__ == "__main__":
    unittest.main()
