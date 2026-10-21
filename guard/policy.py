# policy.py: parse and validate the SyscallGuard policy file.
# Track: G1 (Guard runtime & bridge)
# Contract: ARCHITECTURE.md Contract 2 (policy file).
#
# Stdlib only: this module must stay importable without bcc or root, so that
# tests/test_policy.py runs anywhere (see policy/docs/hifza.md section 7).
#
# Validation rules (Contract 2, plus the 2026-10-20 clarification in
# docs/shared.md):
#   - `mode` is "audit" or "enforce"; a missing `mode` means "audit".
#     A CLI --mode overrides the file.
#   - `protect` must be present and non-empty; every path is absolute and
#     exists. os.stat follows symlinks, so the real file is protected and the
#     inode is the target's.
#   - `allow` may be missing (treated as empty) or empty; every entry is a
#     string that parses with ipaddress.ip_network(strict=False).
#   - Unknown keys are rejected.
# On any error: one clear message to stderr naming the key and the value,
# then exit 2.

"""Parse and validate a SyscallGuard policy file."""

from __future__ import annotations

import argparse
import ipaddress
import os
import sys
import tomllib
from dataclasses import dataclass, field

__all__ = [
    "MODES",
    "DEFAULT_MODE",
    "KNOWN_KEYS",
    "Policy",
    "PolicyError",
    "load_policy",
    "main",
]

MODES = ("audit", "enforce")
DEFAULT_MODE = "audit"
KNOWN_KEYS = frozenset({"mode", "protect", "allow"})


class PolicyError(Exception):
    """The policy file is invalid. The message names the offending key/value."""


@dataclass(frozen=True)
class Policy:
    """A validated policy.

    `protect` is ordered: index i in the list is the value the BPF
    `protected_inodes` map stores for that inode (Contract 1). `inode_paths`
    maps an inode back to its path, for the `file` field of an event.
    """

    mode: str
    protect: list[str] = field(default_factory=list)
    inodes: list[int] = field(default_factory=list)
    inode_paths: dict[int, str] = field(default_factory=dict)
    allow: list[str] = field(default_factory=list)
    allow_v4: list[ipaddress.IPv4Network] = field(default_factory=list)
    allow_v6: list[ipaddress.IPv6Network] = field(default_factory=list)

    def summary(self) -> str:
        """One line for stderr. Never printed to stdout by guard.py."""
        return (
            f"mode={self.mode} protect={len(self.protect)} "
            f"allow={len(self.allow)} (v4={len(self.allow_v4)} v6={len(self.allow_v6)})"
        )


def load_policy(path: str | os.PathLike[str], mode_override: str | None = None) -> Policy:
    """Read, validate and return the policy at `path`.

    `mode_override` is the CLI --mode value; it wins over the file.
    Raises PolicyError on any problem. Never exits: the caller decides.
    """
    data = _read_toml(path)
    if mode_override is not None and mode_override not in MODES:
        raise PolicyError(
            f"invalid mode override {mode_override!r}: expected one of {', '.join(MODES)}"
        )
    return _build(data, mode_override=mode_override, source=os.fspath(path))


def _read_toml(path: str | os.PathLike[str]) -> dict:
    try:
        with open(path, "rb") as fh:
            return tomllib.load(fh)
    except FileNotFoundError:
        raise PolicyError(f"policy file not found: {path}") from None
    except IsADirectoryError:
        raise PolicyError(f"policy path is a directory, not a file: {path}") from None
    except tomllib.TOMLDecodeError as exc:
        raise PolicyError(f"policy file {path} is not valid TOML: {exc}") from None
    except OSError as exc:
        raise PolicyError(f"cannot read policy file {path}: {exc}") from None


def _build(data: dict, mode_override: str | None, source: str) -> Policy:
    if not isinstance(data, dict):  # pragma: no cover - tomllib always gives a dict
        raise PolicyError(f"policy file {source} must be a table")

    unknown = sorted(set(data) - KNOWN_KEYS)
    if unknown:
        raise PolicyError(
            f"unknown key{'s' if len(unknown) > 1 else ''} in policy: "
            f"{', '.join(repr(k) for k in unknown)} "
            f"(known keys: {', '.join(sorted(KNOWN_KEYS))})"
        )

    mode = _mode(data, mode_override)
    protect, inodes, inode_paths = _protect(data)
    allow, allow_v4, allow_v6 = _allow(data)
    return Policy(
        mode=mode,
        protect=protect,
        inodes=inodes,
        inode_paths=inode_paths,
        allow=allow,
        allow_v4=allow_v4,
        allow_v6=allow_v6,
    )


def _mode(data: dict, mode_override: str | None) -> str:
    # The file value is validated even when the CLI overrides it: a file with a
    # bad mode is malformed, and rejecting it keeps the error message honest.
    if "mode" in data:
        value = data["mode"]
        if not isinstance(value, str) or value not in MODES:
            raise PolicyError(
                f"invalid mode {value!r}: expected one of {', '.join(MODES)}"
            )
    else:
        value = DEFAULT_MODE
    return mode_override if mode_override is not None else value


def _protect(data: dict) -> tuple[list[str], list[int], dict[int, str]]:
    if "protect" not in data:
        raise PolicyError(
            "policy is missing the required 'protect' key: it must list at least one file"
        )

    raw = data["protect"]
    if not isinstance(raw, list):
        raise PolicyError(f"'protect' must be a list of paths, got {type(raw).__name__}")
    if not raw:
        raise PolicyError("'protect' must not be empty: no file would be protected")

    protect: list[str] = []
    inodes: list[int] = []
    inode_paths: dict[int, str] = {}
    for entry in raw:
        if not isinstance(entry, str):
            raise PolicyError(
                f"'protect' entry must be a string, got {type(entry).__name__}: {entry!r}"
            )
        if not os.path.isabs(entry):
            raise PolicyError(f"'protect' path must be absolute: {entry!r}")
        try:
            # os.stat follows symlinks: the inode is the real file's, so an
            # editor that replaces the file does not silently unprotect it.
            st = os.stat(entry)
        except OSError as exc:
            raise PolicyError(
                f"'protect' path does not exist or cannot be read: {entry!r} "
                f"({exc.strerror or exc})"
            ) from None
        protect.append(entry)
        inodes.append(st.st_ino)
        inode_paths[st.st_ino] = entry
    return protect, inodes, inode_paths


def _allow(data: dict) -> tuple[list[str], list[ipaddress.IPv4Network], list[ipaddress.IPv6Network]]:
    raw = data.get("allow", [])
    if not isinstance(raw, list):
        raise PolicyError(f"'allow' must be a list of CIDRs, got {type(raw).__name__}")

    allow: list[str] = []
    allow_v4: list[ipaddress.IPv4Network] = []
    allow_v6: list[ipaddress.IPv6Network] = []
    for entry in raw:
        # ipaddress.ip_network() accepts ints and bytes, so an int entry such
        # as 5 would silently become 0.0.0.5/32. Check the type first.
        if not isinstance(entry, str):
            raise PolicyError(
                f"'allow' entry must be a string, got {type(entry).__name__}: {entry!r}"
            )
        try:
            net = ipaddress.ip_network(entry, strict=False)
        except ValueError as exc:
            raise PolicyError(f"'allow' entry is not a valid CIDR: {entry!r} ({exc})") from None
        allow.append(entry)
        if net.version == 4:
            allow_v4.append(net)
        else:
            allow_v6.append(net)
    return allow, allow_v4, allow_v6


def main(argv: list[str] | None = None) -> int:
    """Validate a policy file and report the result on stderr.

    Exit 0 when the policy is valid, 2 when it is not. Kept separate from
    guard.py so the same validation path is exercised by tests/test_policy.py.
    """
    parser = argparse.ArgumentParser(
        prog="policy.py", description="Validate a SyscallGuard policy file."
    )
    parser.add_argument("-p", "--policy", required=True, help="path to the policy TOML file")
    parser.add_argument(
        "--mode",
        choices=MODES,
        default=None,
        help="override the mode from the file",
    )
    args = parser.parse_args(argv)

    try:
        policy = load_policy(args.policy, mode_override=args.mode)
    except PolicyError as exc:
        print(f"policy error: {exc}", file=sys.stderr)
        return 2
    print(f"policy ok: {policy.summary()}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
