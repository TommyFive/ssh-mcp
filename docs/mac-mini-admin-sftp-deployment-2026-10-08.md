# Mac mini 2026-10-08 Admin SFTP deployment and rollback

> **Deployed and verified on 2026-10-08:** The operator ran `prepare`, which passed 23-profile validation and left the live service unchanged, then `activate` successfully from an **independent Tailscale SSH terminal**. LaunchAgent restarted with new tunnel/client processes. ChatGPT SSH-MCP verified the active compiled scope rule and `O_NOFOLLOW` implementation; `list-connections` reported 23 profiles (13 Viewer/10 Admin). A 167-byte `mac-mini-admin` SFTP canary was read back via Viewer. A Viewer upload failed with `POLICY_DENIED` and created no file. Audit: `admin-sftp-workspace-scope` allow, `role-binding` deny. The preexisting OpenClaw `documentation/ssh-mcp-tunnel/README.md` was successfully updated via the scoped Admin SFTP flow (9,610 bytes, `0600`). Protected snapshot: `~/.local/share/ssh-mcp-backups/admin-sftp-62089183`; immediate prior binary: `/opt/homebrew/lib/node_modules/.ssh-mcp-sftp-prev-62089183`. **Retain these backups; no rollback required.** The remainder below documents the executable procedure for future recovery/history.


This operator script is **intentionally out-of-band**. It must run from an independent Tailscale-SSH terminal on the Mac mini, never through SSH-MCP while replacing its own tunnel process.

Source: [deploy-mac-mini-admin-sftp-20261008.sh](../scripts/deploy-mac-mini-admin-sftp-20261008.sh).

The script is pinned to **SSH-MCP commit `62089183cc07f667a731ca52125674f4959a8a8f`** (the reviewed PR #3); this includes the previous `O_NOFOLLOW` security fix. Its code is deliberately not controlled by a floating branch.

## Operator run sequence

1. Open an independent, persistent SSH session to the Mac mini as `rentamac`. Confirm you can reach the machine outside ChatGPT and keep the terminal open until complete.
2. Download this helper from its **own reviewed/merged immutable Git commit**, preferably with the already-authenticated GitHub CLI. Do not execute a different repository or floating `main` URL.
3. Run `bash -n /path/to/helper.sh`, then `bash /path/to/helper.sh prepare`. This fetches the exact SSH-MCP source SHA via GitHub, builds to a separate path, stages it, and checks all 23 profiles and only the intended new `mac-mini-admin` scoped option. **It does not restart the live service.**
4. Inspect the `READY` message. If it has not appeared, **stop**. Ask ChatGPT to inspect staged release results through read-only SSH-MCP; do not force activation.
5. Run `bash /path/to/helper.sh activate` only once from the independent shell. It backs up old binary/config/plist, atomically swaps package/config, restarts **only** `com.openai.tunnel-client.ssh-mcp`, verifies the launchd state and process, and leaves the old package for rollback. An activation error triggers an immediate attempt to restore both package and config.
6. ChatGPT independently checks active version, 23 profiles, an approved SFTP canary in the scoped documentation tree, remote readback, Viewer upload refusal, and audit trail. Keep old package/backup until this is confirmed.
7. On any functional regression use `bash /path/to/helper.sh rollback` from that **independent SSH** session and confirm the old SSH-MCP endpoint reconnects.

The prepare mode modifies only a new side-by-side package directory and a new `0600` temporary candidate TOML inside the private config directory. It does not mutate any of the 23 existing profile settings in the live file. The activate mode checks the full original TOML SHA against the prepared SHA and refuses activation if anything changed in between.

### Scope enabled on activation

Only `mac-mini-admin` gains optional `sftpWorkspaceWrite` with:

```toml
[profiles.sftpWorkspaceWrite]
roots = [
  "/Users/rentamac/.openclaw/workspace/documentation",
  "/Users/rentamac/.openclaw/workspace/projects",
]
maxBytes = 65536
```

This does not grant shell execution privileges, broaden any of the other 22 profiles, remove the never-allow denylist, or attest a ChatGPT click. ChatGPT's own “Allow once” flow remains.

### Safety limits

- No destructive operation is executed from SSH-MCP. Interactive independent terminal is mandatory for activation.
- Full package/config/plist backups are made under `~/.local/share/ssh-mcp-backups/admin-sftp-62089183` and never committed.
- Preserve the existing initial Viewer2 backup as well.
- Stop on missing GitHub credentials, invalid SHA/source, untrusted config mode, missing workspace paths, profile count mismatch, TOML loader errors, binary security drift, and any pre-existing staging/rollback conflict.
- After successful activation the old binary remains in `/opt/homebrew/lib/node_modules/.ssh-mcp-sftp-prev-62089183` and can be restored.
- No guarantee is made for a disk crash, power outage, SIGKILL, or a lost out-of-band SSH session. The rollback subcommand requires the independent connection and surviving backup.

Initial rollout evidence and known Photonicat reachability exception: [Viewer2 production handover](viewer2-production-2026-10-08.md).
