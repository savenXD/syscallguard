#!/usr/bin/env python3
"""test_policy.py — unprivileged unit tests for guard/policy.py.

Run:  python3 tests/test_policy.py   (no root, no kernel, no network)
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "guard"))

import policy  # noqa: E402


class TestPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.secret = os.path.join(self.tmp.name, ".env")
        with open(self.secret, "w") as f:
            f.write("fake\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, text):
        p = os.path.join(self.tmp.name, "policy.toml")
        with open(p, "w") as f:
            f.write(text)
        return p

    def _load(self, text):
        return policy.load(self._write(text))

    def test_valid_enforce(self):
        pol = self._load(f'mode = "enforce"\nprotect = ["{self.secret}"]\n'
                         f'allow = ["127.0.0.0/8", "::1/128"]\n')
        self.assertEqual(pol.mode, "enforce")
        self.assertEqual(pol.protect, [self.secret])
        self.assertEqual(len(pol.allow), 2)

    def test_mode_defaults_to_audit(self):
        pol = self._load(f'protect = ["{self.secret}"]\n')
        self.assertEqual(pol.mode, "audit")

    def test_bad_mode_rejected(self):
        with self.assertRaises(policy.PolicyError):
            self._load(f'mode = "destroy"\nprotect = ["{self.secret}"]\n')

    def test_missing_file(self):
        with self.assertRaises(policy.PolicyError):
            policy.load(os.path.join(self.tmp.name, "nope.toml"))

    def test_invalid_toml(self):
        with self.assertRaises(policy.PolicyError):
            self._load("mode = [unclosed\n")

    def test_unknown_key_rejected(self):
        with self.assertRaises(policy.PolicyError):
            self._load(f'mode = "audit"\nprotect = ["{self.secret}"]\n'
                       f'bogus = 1\n')

    def test_relative_protect_path_rejected(self):
        with self.assertRaises(policy.PolicyError):
            self._load('protect = ["relative/.env"]\n')

    def test_missing_protect_path_rejected(self):
        with self.assertRaises(policy.PolicyError):
            self._load('protect = ["/does/not/exist.env"]\n')

    def test_empty_protect_rejected(self):
        with self.assertRaises(policy.PolicyError):
            self._load('protect = []\n')

    def test_bad_cidr_rejected(self):
        with self.assertRaises(policy.PolicyError):
            self._load(f'protect = ["{self.secret}"]\nallow = ["999.1.1.1/24"]\n')

    def test_empty_allow_ok(self):
        pol = self._load(f'protect = ["{self.secret}"]\nallow = []\n')
        self.assertEqual(pol.allow, [])

    def test_host_address_means_single_host(self):
        pol = self._load(f'protect = ["{self.secret}"]\nallow = ["10.0.0.5"]\n')
        self.assertEqual(str(pol.allow[0]), "10.0.0.5/32")


if __name__ == "__main__":
    unittest.main(verbosity=2)
