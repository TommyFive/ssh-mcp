# SSH-MCP Viewer 2.0 — production handover (2026-10-08)

> **Status:** Viewer2 functionality and all 23 Mac mini SSH-MCP profiles are running in production. The actual installed binary is **2.11.0-readonly-extension.3**, cut over from the compiled **f1314bf** candidate. **A later security fix merged into `main` has not yet been deployed** (see [remaining actions](#remaining-actions)). This document describes the observed state rather than treating the merged HEAD as the installed release.
>
> This record complements the chronological [Viewer2 rollout and rollback runbook](viewer2-rollout-runbook.md). Implementation source is [PR #1](https://github.com/TommyFive/ssh-mcp/pull/1), squash-merged as `9e942a9aa9af01e0662b3a1e3c32ff77599971f4`. Keep the distinction between the running package, the Git commit, and the SSH-MCP *profile configuration*.

## Architecture and authoritative locations

- **Host:** headless Mac mini (macOS, Apple Silicon); independent operator SSH/Tailscale SSH access is the recovery channel.
- **Transport:** outgoing `tunnel-client`, LaunchAgent `com.openai.tunnel-client.ssh-mcp`; do not confuse it with OpenClaw, browser-MCP, cloudflared, or other services.
- **Installed package:** `/opt/homebrew/lib/node_modules/ssh-mcp`, executable `/opt/homebrew/bin/ssh-mcp`.
- **Live TOML:** `~/.config/ssh-mcp/config.toml` (owner-only mode `0600`). **Do not export or commit this file**: it contains real SSH host-key fingerprints and other operational details. MCP output sanitization redacts 23 fingerprint values; never upload such a redacted copy back over the original.
- **Tunnel launchd job:** `~/Library/LaunchAgents/com.openai.tunnel-client.ssh-mcp.plist`; MCP audit: `~/Library/Logs/ssh-mcp/audit.log`.
- **Operator-only grant issuer:** `~/.local/share/ssh-mcp-releases/grant-admin-sftp.mjs` (corresponds to `scripts/grant-admin-sftp.mjs` in this repository).
- **Package rollback:** protected original archive, TOML and plist in `~/.local/share/ssh-mcp-backups/viewer2-20261008T050638Z`; previous package preserved as `/opt/homebrew/lib/node_modules/.ssh-mcp-prev-20261008T083103Z`. The original migration cutover helper `~/.local/share/ssh-mcp-releases/viewer2-cutover-f1314bf.sh` is **specific to the 2.2.5→2.11.0 initial cutover** and is not a generic 2.11→2.11 updater.
- **Latest profile backup:** `~/.config/ssh-mcp/config.toml.before-viewer2-final-1791450913212` (mode `0600`); an additional pre-Viewer2 backup exists. Local workspace operational notes: `~/.openclaw/workspace/documentation/ssh-mcp-tunnel/README.md`.

## Final 23-profile opt-in

On 2026-10-08, the operator changed the TOML **locally on the Mac mini** after a separate file backup. The local script loaded and validated both the before/after configuration with `loadConfig()`, checked 23/23 normalized profiles and asserted that removing the new `viewer2Packs` property yielded the exact original settings. A successful `launchctl kickstart -k` reloaded the service.

| Target system group | Profiles | Exact `viewer2Packs` |
|---|---:|---|
| Linux/Debian VPS and VMs | 13 | `["linux","network","vpn"]` |
| OpenWrt/ImmortalWrt routers | 6 | `["openwrt","network","vpn"]` |
| ASUSWRT-Merlin router | 2 | `["network","vpn"]` |
| macOS Mac mini | 2 | `["macos","network","vpn"]` |
| **Total** | **23** | 13 Viewer / 10 Admin |

These entries are the combined passive Viewer2 allowlist **only**. The original `readOnlyExtensions`, host/user/host-key pins, `group="prod"`, timeouts, denylist, 13 `role="viewer"` + `readOnly=true`, 10 `role="admin"` + `readOnly=false`, and Admin `approvalPolicy="ask-destructive"` were preserved. No `icmp` pack or `viewer2ProbeTargets` was configured. **Active probes and writes from Viewer profiles remain disallowed.**

Do not infer that every remote machine is online simply because its profile loads. Two profiles may represent different roles on the same host.

## Production acceptance evidence

Verified with the real ChatGPT SSH-MCP connector, both after the initial binary cutover and after the profile reload:

1. Package metadata reported `2.11.0-readonly-extension.3`; a new `tunnel-client` process ran `node /opt/homebrew/bin/ssh-mcp --config=...`.
2. MCP listed **23/23** profiles: **13 Viewer** and **10 Admin**. The live TOML contained precisely 23 `viewer2Packs` entries distributed as in the table.
3. Passive commands succeeded: macOS `sw_vers`; Linux `systemctl list-timers --all --no-pager`, `ip -o link show`, `tailscale status --json`; OpenWrt `sysctl net.ipv4.ip_forward`; ASUS Merlin `ifconfig -a`. The audit recorded new Viewer2 commands as `class=read-only, decision=allow`.
4. Viewer `touch` and unapproved `ping -c 1 1.1.1.1` were refused with `POLICY_DENIED`; the audit recorded role-binding denial. Admin `sw_vers` continued to work.
5. A real `mac-mini-admin` `sftp-upload` of **89 bytes** to one exact operator-approved scratch file succeeded; SFTP readback matched. The audit recorded `commandClass=destructive`, `ruleId=out-of-band-sftp-preapproval`, `decision=allow`, `exitCode=0` and `approver=operator-owned-30min-sftp-grant`. A different destination file was refused, not created and audited as requiring approval; Viewer SFTP upload was denied.
6. The live TOML and its post-change backup remained mode `0600`. The rollback marker, protected archive and prior binary remained available.

**Known observations unrelated to the configuration update:** one OpenWrt-target SSH diagnostic to the Photonicat device timed out; the profile itself was loaded. A BusyBox-based OpenWrt device did not have a standalone `hostname` command, but `sysctl` worked. Neither observation proves a Viewer2 policy failure. Photonicat reachability needs separate diagnosis.

## SFTP approval design (not general Admin elevation)

The MCP client in use **does not support MCP form elicitation**. During the first 2.11 canary, SFTP uploads classified as `destructive` therefore failed closed with `APPROVAL_UNAVAILABLE`; 2.2.5 had previously treated inline SFTP uploads as `safe`. The fix does **not** revert to that unrestricted classification.

Instead, an operator grants an exact destination for a named Admin profile from a separate, *interactive independent* Mac mini terminal. Example (substitute a scratch file; this is not permission to write other paths):

```sh
/opt/homebrew/bin/node \
  ~/.local/share/ssh-mcp-releases/grant-admin-sftp.mjs \
  mac-mini-admin \
  /Users/rentamac/.cache/ssh-mcp-restore-check/documentation-scratch.txt \
  32768
# Confirm interactively: APPROVE-30M-SFTP
```

The owner-only `~/.config/ssh-mcp/admin-sftp-grant.json` is refreshed for **30 minutes maximum**, scoped to the exact path, one Admin profile and maximum **1 MiB** per upload. The server evaluates the grant on each call. No live reload is necessary for grant issuance. Wrong path, wrong role, expiry, symlinked/insecure file, or missing authorization must fail closed. A short-lived file grant is **not** WebAuthn/2FA and not a general-purpose Admin write token. This does not implement the separate OpenClaw JIT/approval-broker architecture.

> The local grant can authorize overwriting the critical SSH-MCP TOML if the operator deliberately names it. This is a privileged action; keep the independent recovery shell open, back up the original, and validate with the actual config loader before restarting the tunnel. Never copy MCP-redacted fingerprints back into that TOML.

## Rollout incidents and recovery lessons

- **First canary:** new binary started; inline Admin SFTP failed because client elicitation was unavailable. Operator rolled back using independent SSH. Version 2.2.5, the tunnel, Viewer read-only policy and historic Admin SFTP behavior were all verified.
- **Second canary:** operator issued scoped SFTP grant and passed the 15/15 preflight, but activation failed when the cutover script tried to write `viewer2-active-rollback-path` under a *literal redaction placeholder* accidentally embedded in its backup path. Its EXIT rescue restored 2.2.5. The script was repaired; syntax, source-integrity tests, isolated activate/rollback and injected failure all passed.
- **Third canary:** guarded activation succeeded. 2.11 binary, 23 profile visibility, exact-file SFTP positive/negative tests, audit and preserved rollback were verified live.
- **Final opt-in:** independent-terminal script installed the 23 profile opt-ins into the unredacted local TOML. Pre/post normalized profiles were equal apart from `viewer2Packs`, the service relaunched, and real passive Viewer2 diagnostics and write denials passed.

## Remaining actions

1. **Deploy last merged security fix to Mac mini.** At the time of this audit, the running compiled `build/policy/sftp-preapproval.js` still used `lstatSync(path)` followed by `readFileSync(path)`. The merged `src/policy/sftp-preapproval.ts` on `main` uses `openSync(O_NOFOLLOW)`, `fstatSync(fd)` and a bounded `readSync(fd)` to close the file-substitution race raised by CodeQL. **Code merge ≠ live binary update.** Do not mark security closure until rebuilding the exact merged commit, staging/validating the new package, and activating it from an independent recovery terminal with a fresh rollback snapshot.
2. **Photonicat target reachability:** diagnose separately; the profile is configured, but the observed SSH test timed out.
3. **JIT/WebAuthn/2FA broker:** a separate future security-control project; the existing 30-minute exact-file grant is narrower and does not claim 2FA.
4. **Hygiene after sign-off:** preserve recovery backups until a new release is verified; only then review old staged artifacts for cleanup. Do not blanket-delete or downgrade protection.

## Routine checks

```sh
# Run in an independent Mac mini SSH shell. These checks do not change state.
cat /opt/homebrew/lib/node_modules/ssh-mcp/package.json
grep -n '^viewer2Packs = ' ~/.config/ssh-mcp/config.toml
ls -l ~/.config/ssh-mcp/config.toml
launchctl print "gui/$(id -u)/com.openai.tunnel-client.ssh-mcp"
```

Check MCP `list-connections` = 23, verify a simple Viewer `sw_vers` or host-appropriate passive command, verify a Viewer write denial, and inspect the private audit log. For any restart/package change, **keep a tested, independent SSH/Tailscale session open**; never restart the SSH-MCP tunnel using SSH-MCP itself. Keep the recovery snapshot until all checks pass.

**References:** [merged PR #1](https://github.com/TommyFive/ssh-mcp/pull/1), [full cutover history](viewer2-rollout-runbook.md), [grant issuer](../scripts/grant-admin-sftp.mjs), [Viewer2 matcher](../src/policy/viewer2.ts), [CI workflow](../.github/workflows/ci.yml).
