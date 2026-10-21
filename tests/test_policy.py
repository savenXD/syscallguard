# test_policy.py: unprivileged unit tests for guard/policy.py. Run anywhere:
#   python3 -m unittest tests/test_policy.py
# Track: G1 (Guard runtime & bridge)
# Contract: ARCHITECTURE.md Contract 2 (policy file).
#
# These tests need no root, no VM and no bcc: guard/policy.py is stdlib only.
# The case list follows policy/docs/hifza.md section 4 plus the 2026-10-20
# clarification in docs/shared.md (missing allow, missing protect, non-string
# allow entries).

import importlib.util
import ipaddress
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = REPO_ROOT / "guard" / "policy.py"
EXAMPLE_PATH = REPO_ROOT / "policy" / "policy.example.toml"


def _load_policy_module():
    """Import guard/policy.py by path, so the tests do not depend on the cwd."""
    spec = importlib.util.spec_from_file_location("guard_policy_under_test", POLICY_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module 
    spec.loader.exec_module(module)
    return module


policy = _load_policy_module()
PolicyError = policy.PolicyError
load_policy = policy.load_policy


class PolicyTestCase(unittest.TestCase):
    """Helpers: a temp dir, a protected file, and a policy writer."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.protected = self.tmp / "secret.env"
        self.protected.write_text("SECRET=hunter2\n", encoding="utf-8")

    def write_raw(self, text, name="policy.toml"):
        path = self.tmp / name
        path.write_text(text, encoding="utf-8")
        return path

    def write_policy(self, mode="audit", protect=None, allow=("127.0.0.0/8",), extra=""):
        """Write a policy file. `None` omits the key entirely."""
        lines = []
        if mode is not None:
            lines.append(f"mode = {json.dumps(mode)}")
        if protect is None:
            protect = [str(self.protected)]
        lines.append("protect = [" + ", ".join(json.dumps(p) for p in protect) + "]")
        if allow is not None:
            lines.append("allow = [" + ", ".join(json.dumps(a) for a in allow) + "]")
        if extra:
            lines.append(extra)
        return self.write_raw("\n".join(lines) + "\n")


class TestValidPolicies(PolicyTestCase):
    """Cases the contract accepts."""

    def test_example_policy_parses_with_temp_protect_file(self):
        """The shipped example parses once `protect` points at a real file."""
        text = EXAMPLE_PATH.read_text(encoding="utf-8")
        text = text.replace(
            '"/home/demo/syscallguard/demo/project/.env"', json.dumps(str(self.protected))
        )
        path = self.write_raw(text, name="example.toml")

        loaded = load_policy(path)

        self.assertEqual(loaded.mode, "audit")
        self.assertEqual(loaded.protect, [str(self.protected)])
        self.assertEqual(loaded.allow, ["127.0.0.0/8", "::1/128"])
        self.assertEqual(loaded.inodes, [self.protected.stat().st_ino])
        self.assertEqual(loaded.inode_paths[self.protected.stat().st_ino], str(self.protected))

    def test_mode_missing_defaults_to_audit(self):
        loaded = load_policy(self.write_policy(mode=None))
        self.assertEqual(loaded.mode, "audit")

    def test_empty_allow_is_accepted(self):
        loaded = load_policy(self.write_policy(allow=[]))
        self.assertEqual(loaded.allow, [])
        self.assertEqual(loaded.allow_v4, [])
        self.assertEqual(loaded.allow_v6, [])

    def test_missing_allow_key_is_treated_as_empty(self):
        """Clarified 2026-10-20: a missing `allow` key is empty, not an error."""
        loaded = load_policy(self.write_policy(allow=None))
        self.assertEqual(loaded.allow, [])
        self.assertEqual(loaded.allow_v4, [])
        self.assertEqual(loaded.allow_v6, [])

    def test_host_bits_set_is_accepted(self):
        """`10.0.0.1/8` is valid because the contract parses with strict=False."""
        loaded = load_policy(self.write_policy(allow=("10.0.0.1/8",)))
        self.assertEqual(loaded.allow_v4, [ipaddress.ip_network("10.0.0.0/8")])
        self.assertEqual(loaded.allow_v6, [])

    def test_ipv4_and_ipv6_entries_split_correctly(self):
        loaded = load_policy(
            self.write_policy(allow=("127.0.0.0/8", "10.0.0.0/8", "::1/128", "2001:db8::/32"))
        )
        self.assertEqual(
            loaded.allow_v4,
            [ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("10.0.0.0/8")],
        )
        self.assertEqual(
            loaded.allow_v6,
            [ipaddress.ip_network("::1/128"), ipaddress.ip_network("2001:db8::/32")],
        )
        self.assertEqual(len(loaded.allow), 4)
        self.assertEqual(loaded.allow[0], "127.0.0.0/8")

    def test_mode_override_wins_over_the_file(self):
        path = self.write_policy(mode="audit")
        self.assertEqual(load_policy(path, mode_override="enforce").mode, "enforce")
        self.assertEqual(load_policy(path).mode, "audit")

    def test_mode_override_enforce_over_enforce_file(self):
        path = self.write_policy(mode="enforce")
        self.assertEqual(load_policy(path, mode_override="audit").mode, "audit")
    
    def test_bare_host_address_means_single_host(self):
        loaded = load_policy(self.write_policy(allow=("10.0.0.5",)))
        self.assertEqual(loaded.allow_v4, [ipaddress.ip_network("10.0.0.5/32")])

    def test_enforce_mode_in_file_is_kept(self):
        loaded = load_policy(self.write_policy(mode="enforce"))
        self.assertEqual(loaded.mode, "enforce")


class TestInvalidPolicies(PolicyTestCase):
    """Cases the contract rejects with exit 2 (PolicyError here)."""

    def assertRejected(self, path, *expected_fragments):
        with self.assertRaises(PolicyError) as ctx:
            load_policy(path)
        message = str(ctx.exception)
        for fragment in expected_fragments:
            self.assertIn(fragment, message)
        return message

    def test_invalid_mode_is_rejected(self):
        path = self.write_policy(mode="block")
        self.assertRejected(path, "mode", "block")

    def test_non_string_mode_is_rejected(self):
        path = self.write_raw(f"mode = 1\nprotect = [{json.dumps(str(self.protected))}]\n")
        self.assertRejected(path, "mode")

    def test_empty_protect_is_rejected(self):
        path = self.write_policy(protect=[])
        self.assertRejected(path, "protect", "empty")

    def test_missing_protect_key_is_rejected(self):
        """Clarified 2026-10-20: a missing `protect` is rejected like an empty one."""
        path = self.write_raw('mode = "audit"\nallow = ["127.0.0.0/8"]\n')
        self.assertRejected(path, "protect")

    def test_unknown_key_is_rejected(self):
        path = self.write_policy(extra='deny = ["1.2.3.4"]')
        self.assertRejected(path, "deny", "unknown key")

    def test_relative_protect_path_is_rejected(self):
        path = self.write_policy(protect=["relative/secret.env"])
        self.assertRejected(path, "protect", "absolute")

    def test_nonexistent_protect_path_is_rejected(self):
        missing = str(self.tmp / "does-not-exist.env")
        path = self.write_policy(protect=[missing])
        self.assertRejected(path, "protect", "does not exist")

    def test_bad_cidr_in_allow_is_rejected(self):
        path = self.write_policy(allow=("not-a-cidr",))
        self.assertRejected(path, "allow", "not-a-cidr")

    def test_cidr_with_bad_prefix_length_is_rejected(self):
        path = self.write_policy(allow=("10.0.0.0/33",))
        self.assertRejected(path, "allow")

    def test_non_string_allow_entry_is_rejected(self):
        """Clarified 2026-10-20: 5 would otherwise become 0.0.0.5/32."""
        path = self.write_raw(
            f"protect = [{json.dumps(str(self.protected))}]\nallow = [5]\n"
        )
        message = self.assertRejected(path, "allow", "string")
        self.assertIn("5", message)

    def test_non_string_protect_entry_is_rejected(self):
        path = self.write_raw("protect = [5]\n")
        self.assertRejected(path, "protect", "string")

    def test_protect_not_a_list_is_rejected(self):
        path = self.write_raw(f"protect = {json.dumps(str(self.protected))}\n")
        self.assertRejected(path, "protect", "list")

    def test_allow_not_a_list_is_rejected(self):
        path = self.write_raw(
            f"protect = [{json.dumps(str(self.protected))}]\nallow = \"127.0.0.0/8\"\n"
        )
        self.assertRejected(path, "allow", "list")

    def test_missing_policy_file_is_rejected(self):
        self.assertRejected(self.tmp / "no-such-policy.toml", "not found")

    def test_invalid_toml_is_rejected(self):
        path = self.write_raw("mode = \nprotect = [\n")
        self.assertRejected(path, "TOML")

    def test_invalid_mode_override_is_rejected(self):
        path = self.write_policy()
        with self.assertRaises(PolicyError) as ctx:
            load_policy(path, mode_override="block")
        self.assertIn("mode", str(ctx.exception))


class TestSymlinkedProtect(PolicyTestCase):
    """A symlinked protect path resolves to the target's inode."""

    def test_symlink_resolves_to_target_inode(self):
        link = self.tmp / "link.env"
        try:
            os.symlink(self.protected, link)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"symlinks unavailable here: {exc}")

        path = self.write_policy(protect=[str(link)])
        loaded = load_policy(path)

        target_ino = self.protected.stat().st_ino
        self.assertEqual(loaded.inodes, [target_ino])
        self.assertNotEqual(loaded.inodes, [link.lstat().st_ino])
        self.assertEqual(loaded.inode_paths[target_ino], str(link))

    def test_protect_uses_os_stat_not_os_lstat(self):
        """Same rule, checked everywhere: os.stat follows symlinks, os.lstat does not."""
        real_stat, real_lstat = os.stat, os.lstat
        stat_calls, lstat_calls = [], []

        def spy_stat(target, *args, **kwargs):
            stat_calls.append(target)
            return real_stat(target, *args, **kwargs)

        def spy_lstat(target, *args, **kwargs):
            lstat_calls.append(target)
            return real_lstat(target, *args, **kwargs)

        path = self.write_policy()
        with mock.patch.object(policy.os, "stat", spy_stat), mock.patch.object(
            policy.os, "lstat", spy_lstat
        ):
            loaded = load_policy(path)

        self.assertIn(str(self.protected), stat_calls)
        self.assertEqual(lstat_calls, [])
        self.assertEqual(loaded.inodes, [self.protected.stat().st_ino])


class TestExitCodeTwo(PolicyTestCase):
    """The documented exit code: 2 for a bad policy, message on stderr."""

    def run_policy(self, *args):
        return subprocess.run(
            [sys.executable, str(POLICY_PATH), *args],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
        )

    def test_bad_policy_exits_2(self):
        path = self.write_policy(mode="block")
        result = self.run_policy("-p", str(path))
        self.assertEqual(result.returncode, 2)
        self.assertIn("mode", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_non_string_allow_entry_exits_2(self):
        path = self.write_raw(
            f"protect = [{json.dumps(str(self.protected))}]\nallow = [5]\n"
        )
        result = self.run_policy("-p", str(path))
        self.assertEqual(result.returncode, 2)
        self.assertIn("allow", result.stderr)

    def test_missing_protect_key_exits_2(self):
        path = self.write_raw('mode = "audit"\nallow = ["127.0.0.0/8"]\n')
        result = self.run_policy("-p", str(path))
        self.assertEqual(result.returncode, 2)
        self.assertIn("protect", result.stderr)

    def test_valid_policy_exits_0(self):
        path = self.write_policy()
        result = self.run_policy("-p", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_mode_override_flag_is_accepted(self):
        path = self.write_policy(mode="audit")
        result = self.run_policy("-p", str(path), "--mode", "enforce")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("mode=enforce", result.stderr)


if __name__ == "__main__":
    unittest.main()
