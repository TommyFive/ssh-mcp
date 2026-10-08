# ChatGPT-confirmed Admin SFTP: scoped workspace policy

**Status: running and verified on the Mac mini (2026-10-08).** Code reviewed in [PR #3](https://github.com/TommyFive/ssh-mcp/pull/3), built from immutable `62089183cc07f667a731ca52125674f4959a8a8f`, activated with the independent-shell [deployment runbook](mac-mini-admin-sftp-deployment-2026-10-08.md). Only `mac-mini-admin` is opted in to 64 KiB uploads under `~/.openclaw/workspace/documentation/` and `~/.openclaw/workspace/projects/`. A real 167-byte write/readback and an updated 9,610-byte `ssh-mcp-tunnel/README.md` succeeded; Viewer writing was refused; the audit recorded `ruleId=admin-sftp-workspace-scope` and Viewer denial with `ruleId=role-binding`. This document never implies that SSH-MCP receives proof of a ChatGPT “Allow once” click.

## Why two prompts appeared

ChatGPT already asks before `sftp-upload` when its app permission is “Allow read actions / ask before changes.” The user tested and confirmed this. SSH-MCP's `PolicyEngine` also required an MCP `elicitation/create` form because `sftp-upload` is a destructive operation. This MCP client does not support form elicitation, so the second request failed closed as `APPROVAL_UNAVAILABLE`.

MCP `tools/call` passes tool arguments but **does not carry an authenticated ChatGPT approval token**. The server must still enforce the Viewer/Admin role, denylist, SSH credentials, profile policy and specific write scope. This change is not an authorization bypass for arbitrary Admin commands.

## What changes

- **All 15 registered tools** now have explicit `readOnlyHint`, `destructiveHint`, `openWorldHint` annotations. Remote reads are marked read-only; modifying tools, including `sftp-upload`, are flagged as potentially destructive. No tool is mislabeled safe to suppress a ChatGPT dialog.
- The optional per-profile `sftpWorkspaceWrite` adds a **persistent, narrowly scoped policy** for **inline** `sftp-upload` on Admin profiles. There is no default and no automatic enablement in existing profiles.
- Eligible uploads remain classified as `destructive`. A matching Admin workspace rule yields `decision=allow`, `ruleId=admin-sftp-workspace-scope` *after* the global denylist, role bindings and OPA checks. This skips **only** the server's second form elicitation, not ChatGPT's own confirmation.
- Uploads matching this rule use **staged SFTP upload and rename**, not the legacy direct truncate behavior. SFTP `lstat` of every path component rejects symlinks, non-regular file destinations and group/other-writable ancestor directories, both before writing and before publish. This deliberately requires a trusted, owner-controlled workspace. The existing, explicitly approved SFTP upload behavior elsewhere is unchanged.
- Nested dotfiles/dot-directories (`.git`, `.ssh`, `.env`, etc.), common credential names and SSH key names are excluded from automatic scope, even inside permitted roots.
- Payloads are capped at **1 MiB**, with a **65,536-byte default** for this feature. Content length is counted as UTF-8 bytes and the command is bound to its destination and content hash.
- `sftp-upload-file`, `sftp-download-file`, arbitrary `run-command`, `privileged-command`, session lifecycle and network probes remain subject to their previous policies. Viewer uploads remain forbidden.
- The operator-owned **30-minute exact-file SFTP grant** remains available for exceptional files. No WebAuthn/2FA or ChatGPT-approval verification is falsely claimed.

## Opt-in example (Mac mini, after successful binary rollout only)

In the existing **private** `~/.config/ssh-mcp/config.toml`, locate the `[[profiles]]` block named `mac-mini-admin` and add a TOML table that belongs to that profile:

```toml
[profiles.sftpWorkspaceWrite]
roots = [
  "/Users/rentamac/.openclaw/workspace/documentation",
  "/Users/rentamac/.openclaw/workspace/projects",
]
maxBytes = 65536
```

Be careful with TOML table scope: this belongs to the `mac-mini-admin` profile and **must not** be appended to an unrelated profile. Other 22 profiles remain unchanged.

**Prerequisites:** The server's SSH account must own/control the directory tree, and every directory from the filesystem root to the destination parent must be a real directory without group/other write permission. The upload must be able to create a staged sibling file and atomically rename it over the final destination. This can change the file inode and drop existing ACL metadata, even when POSIX permission bits are retained. Validate these semantics on a sacrificial file before updating important documentation.

The configuration must be changed **locally using the unredacted TOML** through an independent Tailscale SSH terminal, after a mode-0600 backup and config-loader validation. **Never round-trip an MCP-downloaded TOML:** redaction hides pinned SSH host-key fingerprints.

## Acceptance criteria

1. New build is produced from the exact reviewed Git commit, includes the previously merged `O_NOFOLLOW`/descriptor security fix in `sftp-preapproval.ts`, and passes CI on Linux, macOS, Windows, Docker, security scan and CodeQL.
2. Staged binary validates all 23 existing TOML profiles before any live switch; independent Tailscale SSH recovery and verified rollback are available. Never use SSH-MCP to restart its own tunnel.
3. **Negative tests:** Viewer uploads refused; Admin uploads outside roots and to `.git`/`.ssh` refused or continue to ask the original MCP approval; symlink targets/ancestors and group/other-writable directory paths fail closed; 65,537-byte payload denied; shell commands do not inherit SFTP privilege.
4. **Positive test:** After selecting “Allow once” in ChatGPT, a harmless `mac-mini-admin` SFTP upload under `documentation/` succeeds without a second form elicitation. Read back, compare contents and inspect audit `ruleId=admin-sftp-workspace-scope`. Do not log or claim the ChatGPT click as server-verified.
5. Verify legacy out-of-band grant behavior remains available for a different exact file. Keep the old release and config backups until soak completion.

## Trust boundary and caveats

The remote symlink check assumes the SSH identity owns the scoped workspace and **no second actor sharing that identity** is concurrently swapping directory entries. This is not a general arbitrary-server sandbox and does not give a verifiable sign-off from ChatGPT. These restrictions are a compensating *server-side* policy for one trusted Admin profile. Sensitive paths should remain subject to a separate, deliberate operator procedure.

For the initial Viewer2 production history, see [Viewer2 production handover](viewer2-production-2026-10-08.md) and [historical rollout runbook](viewer2-rollout-runbook.md).
