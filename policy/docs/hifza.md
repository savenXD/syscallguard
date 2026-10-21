# Hifza: policy schema and validation (`policy/`)

You own the **schema and validation** of the policy. Suyash owns keeping `policy/policy.example.toml` correct for the VM. Your main guide is [guard/docs/hifza.md](../../guard/docs/hifza.md).

## 1. Your part, in plain words

The policy is the guard's briefing: which files are confidential, which rooms a stamped person may still enter, and whether the guard only writes things down (audit) or actually stops people (enforce). Your job is to make sure a bad briefing is rejected loudly before the guard starts, instead of starting a guard with the wrong instructions.

## 2. Where it sits

```
 policy/policy.toml ──▶ guard/policy.py (validate, exit 2 on error) ──▶ guard.py ──▶ kernel maps
                              ▲
              --mode audit|enforce (CLI override)
```

## 3. Files you own

- The schema (keys, types, rules), as implemented in `guard/policy.py`
- `tests/test_policy.py`: the validation tests
- `policy/docs/hifza.md`: this file (sections 6, 9, 10 only, during development)

Do not edit: `policy/policy.example.toml` content for VM paths (Suyash). Schema changes to it are a `contract:` commit.

## 4. What to build

Keys:

| Key | Type | Rule |
|---|---|---|
| `mode` | string | `"audit"` or `"enforce"`; missing → `audit`. CLI `--mode` overrides the file. |
| `protect` | list of strings | must be non-empty; each path absolute and existing; `os.stat` (follows symlinks, so the real file is protected) |
| `allow` | list of strings | may be empty (a tagged process then reaches nothing, useful for testing); each entry parses with `ipaddress.ip_network(entry, strict=False)`; IPv4 and IPv6 |

Mode semantics: `audit` logs `WOULD_BLOCK` and blocks nothing. `enforce` blocks with `EPERM`. Default is `audit`.

Unknown keys are rejected. Map-size limits (256 protected inodes, 1024 entries per allow trie) are not checked.

On any error: clear message to stderr naming the key and value, exit **2**.

Cases `tests/test_policy.py` must cover:

- the example policy (with `protect` pointed at a temp file) parses
- `mode` missing → `audit`
- `mode` not in {audit, enforce} → exit 2
- empty `protect` → exit 2
- empty `allow` → accepted
- unknown key → exit 2
- relative `protect` path → exit 2
- non-existent `protect` path → exit 2
- symlinked `protect` path → resolves to the target's inode
- bad CIDR in `allow` → exit 2
- host bits set (`10.0.0.1/8`) is accepted (`strict=False`)
- IPv4 and IPv6 entries split correctly
- `--mode` override wins over the file

## 5. Contract excerpts

Contract excerpt (source of truth: ARCHITECTURE.md, section "Contract 2: Policy file"):

```toml
# SyscallGuard policy
# mode: "audit" logs WOULD_BLOCK without blocking. "enforce" blocks. Default to audit.
mode = "audit"

# Files whose readers get tagged. Absolute paths. Must exist at startup.
protect = [
  "/home/demo/syscallguard/demo/project/.env",
]

# Destinations a tagged process may still reach. CIDR. IPv4 and IPv6.
# Loopback must stay allowed: the internal API mock and the DNS stub (127.0.0.53) live there.
allow = [
  "127.0.0.0/8",
  "::1/128",
]
```

> Parsing (`guard/policy.py`): use `tomllib`. Validate that `mode` ∈ {audit, enforce}; that every `protect` path is absolute and exists (`os.stat`, which follows symlinks, so we protect the real file); and that every `allow` entry parses with `ipaddress.ip_network(strict=False)`. On any error, print a clear message to stderr and exit 2. A CLI `--mode` flag overrides the file. A missing `mode` means `audit`. `protect` must be non-empty; `allow` may be empty (a tagged process then reaches nothing, useful for testing). Unknown keys are rejected. Map-size limits are not checked.

## 6. Your milestones

- [ ] **M1 Tagging** (K + G, 18–19 Oct): Guard starts in audit mode and prints `READY`; `cat demo/project/.env` → `TAG` event for `cat`; `sudo bpftool map dump name tagged` shows the entry

Policy validation is **done** and tested (31 tests, all passing, 1 skipped on Windows for the symlink case; see section 10). It was a prerequisite for M1, not M1 itself: M1 still needs the guard to start in audit mode, print `READY` and tag `cat demo/project/.env` in the VM, so the box above stays unticked. The schema itself is settled -- no new keys, no renames, no new rules -- so no `contract:` commit is needed for the policy format.

## 7. How to run and test your part

```bash
python3 -m unittest tests/test_policy.py      # any machine, no root
```

| If this happens | Check |
|---|---|
| Test passes on a missing file | You validated the path string, not `os.stat`. |
| `tomllib` ImportError | Python older than 3.11. |
| Symlinked file not protected | Inode taken with `os.lstat` instead of `os.stat`. |

## 8. Working with AI agents

- Default mode is `audit`; never change that default.
- Schema changes (new key, renamed key, new rule) are a `contract:` commit updating ARCHITECTURE.md and `docs/shared.md`; tell Suyash.
- `policy.py` must not import `bcc`.

Start-here prompt:

> I'm Hifza. Read AGENTS.md, docs/shared.md, policy/docs/hifza.md and ARCHITECTURE.md Contract 2. Implement validation in guard/policy.py exactly per section 4 and the test cases listed there. Stdlib only. At the end, update only sections 6, 9 and 10 of this file.

## 9. Open questions

None open. Resolved 18 Oct (see docs/shared.md): empty `protect` invalid, empty `allow` valid, missing `mode` → audit, unknown keys rejected, no map-size checks, you own `tests/test_policy.py`.

**Applied 20 Oct (Azaan, Contract 2 clarifications).** All three are implemented in `guard/policy.py` as part of the schema, each with a test in `tests/test_policy.py`:
- a missing `allow` key is treated as empty, not an error;
- a missing `protect` key is rejected, same as an empty one;
- `allow` entries must be strings; a non-string entry is rejected (an integer like `5` would otherwise silently become `0.0.0.5/32`).

**Open:**
- Should a valid CLI `--mode` override accept a policy file whose `mode` value is invalid? The schema says `mode` must be `audit` or `enforce` and that the CLI overrides the file, but not which wins when the file's value is invalid. Current behaviour: the file is validated first, so an invalid file `mode` is rejected even when `--mode` supplies a valid value. **Behaviour deliberately left unchanged**; a different answer is a behaviour change and needs a `contract:` entry in `docs/shared.md`.

## 10. Work log

- 2026-10-18: file created.
- 2026-10-18: docs updated with team decisions (TAG_INHERIT name not asserted, hook C emits no ALLOW, native IPv6 dropped, open questions resolved). See docs/shared.md.
- 2026-10-21: schema and validation implemented in `guard/policy.py` (stdlib only, imports no `bcc`) per section 4: `mode` in {audit, enforce}, missing -> `audit`; `protect` must be present, non-empty, absolute and existing, resolved with `os.stat` (follows symlinks, so the real file is protected) and `st_ino` kept; `allow` may be empty or missing, each entry must be a string parsing with `ipaddress.ip_network(entry, strict=False)`, split into IPv4 and IPv6; unknown keys rejected; map-size limits not checked. On any error a clear message naming the key and value goes to stderr and the CLI exits 2.
- 2026-10-21: `tests/test_policy.py` = **31 tests, all passing, 1 skipped**. The skip is `test_symlink_resolves_to_target_inode`: creating a symlink on Windows needs the `SeCreateSymbolicLink` privilege (or Developer Mode), so it is skipped here and must be re-run on Linux in the VM. The companion test proving `os.stat` is used instead of `os.lstat` does pass on Windows.
- 2026-10-21: all three 20 Oct Contract 2 clarifications implemented and tested (missing `allow` -> empty, missing `protect` -> rejected, non-string `allow` entry rejected). One open question recorded in section 9: whether a valid `--mode` override should accept a file with an invalid `mode`. No behaviour changed.
