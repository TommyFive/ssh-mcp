# Viewer 2.0 — rollout history and recovery runbook

> **Archive notice (2026-10-08):** The controlled third canary and the 23-profile opt-in have been executed successfully. This document intentionally preserves **historical pre-cutover hard stops, failures and tested recovery steps**; its older “not yet executable”, “do not deploy” and “manual participation needed” wording describes pre-deployment gates, not today's production status. For current verified state, live configuration, evidence and the **still-unshipped security fix**, see [Viewer 2.0 production handover](viewer2-production-2026-10-08.md). Do not reuse the initial `2.2.5→2.11` cutover script as a generic in-place upgrade procedure.

## Hard stop conditions

Do not start deployment while any of the following applies:

1. PR #1 is draft, failed, pending or unreviewed; all required CI checks including `security-scan` must be green.
2. The integrated `src/policy/viewer2.ts` is not tested against the exact current commit, or approved Viewer profiles have not been individually scoped for opt-in.
3. The offline policy replay's intentional regressions (especially active network probes) have not been reviewed and approved. Run the replay again against the exact release candidate.
4. The new binary has not passed a side-by-side MCP protocol/tool test of **installed** SSH-MCP 2.2.5-readonly-extension.3 and the candidate 2.11.0-readonly-extension.3. The candidate now parses all 23 existing profiles, but that alone is insufficient.
5. Independent recovery access via SSH/Tailscale SSH/Remote Desktop has been confirmed by the operator but not yet demonstrated live during a controlled maintenance window.
6. No tested rollback path exists or no person can restore the Mac mini if SSH-MCP or the tunnel stops.

## 2026-10-08 development findings and no-deploy guards

- GitHub CI run #37724249747 passed on the earlier head; **recheck latest head** after adding ICMP target gates.
- The isolated candidate build accepted all **23** deployed profiles only after restoring the two named legacy packs (`linux-system-diagnostics` and `asus-merlin-diagnostics`). Their regex rules were copied from the installed baseline and kept within the shell-control gate.
- Real audit replay showed up to 19 historical allow-to-deny differences while `ping` was in the generic network pack. **That unrestricted active probe form was removed.** Later replay found ~40 regressions, including 21 historic ICMP calls intentionally denied until explicit target allowlisting. Counts may increase as the live audit grows. The security improvement is intentional; do not restore arbitrary destination probing to make a metric look better.
- The `network` pack is **passive only**. The new `icmp` pack needs BOTH `viewer2Packs = ["icmp"]` and `viewer2ProbeTargets = ["198.51.100.1"]` (example reserved IP, not a suggested live endpoint). Targets must be explicitly scoped, literal IPv4/IPv6 addresses, and must not be loopback, link-local, metadata, multicast or unspecified. No target is implicitly enabled. Network requests and DNS rebinding via hostname resolution are therefore excluded for this probe.
- HTTP/TCP/TLS diagnostics are **not yet implemented** and remain a separate gate: they need host-scoped destination allowlists, bounded timeouts, connection limits, explicit no-proxy/no-redirect behavior, hardened DNS handling, and per-call auditing. No `curl`, `wget`, `nc`, or broad `safe`-class approval for Viewer.
- The proposed backup location `/Users/rentamac/.local/share/ssh-mcp-backups` was created **empty** but has mode `0755`. The attempt to set mode `0700` was blocked by SSH-MCP tool safety enforcement, so **no production secrets or configuration files were copied**. This directory is not a valid backup destination until its owner secures it. Do not reroute the blocked operation through a different execution surface to evade that safety decision.

## Backup status after owner secured the backup folder (2026-10-08)

- Owner used independent Mac mini shell to set `~/.local/share/ssh-mcp-backups` mode `0700`; live SSH verification matched.
- Dedicated private directory `~/.local/share/ssh-mcp-backups/viewer2-20261008T050638Z` created at `0700`.
- Copies of **active** `config.toml` and `com.openai.tunnel-client.ssh-mcp.plist` are present in that private directory at `0600`.
- Both copies verified byte-for-byte with `cmp -s`. Backed-up launchd plist passed `plutil -lint`. Separate candidate build successfully loaded the **backed-up** config and resolved policy across 23 profiles.
- **Installed package archive NOT yet created.** Tool safety enforcement blocked the `tar -cf` request, and no alternative execution route was tried. The owner must use the independent Mac mini shell to archive the deployed installation under the same secure directory and verify the archive; no production service restart is needed.
- No package restoration/atomic-release swap or launchd re-registration has been attempted. The production installation and live processes are unchanged.

## Package backup and isolated restore verification (2026-10-08)

- The operator completed a manual package archive using their independent Mac mini terminal in the secure dated backup folder: `ssh-mcp-package.tar`, size **69,625,856 bytes**, mode `0600`.
- Archive SHA-256: `bbe9930836c6176278fa05c52014871538621ade50b65156fb10decf5cdba5a8`. The archive contains the installed `ssh-mcp/package.json` and compiled `ssh-mcp/build/` content. The archive listing contained approximately 11,793 entries as returned by the remote tool.
- Archive was extracted to a **separate** private directory: `/Users/rentamac/.cache/ssh-mcp-restore-check/ssh-mcp`. This action did not overwrite production paths.
- Recursive file comparison using `diff -qr` between extracted and installed package returned **no differences** (the installed package had not been modified).
- Restored `package.json` reports version `2.2.5-readonly-extension.3`. The restored baseline `loadConfig` successfully parsed the **backed-up** `config.toml` and returned 23 profiles: `RESTORED_BASELINE_LOAD_OK profiles=23`.
- The pre-existing config/plist backup copies remain byte-identical to the installed files; copied launchd plist passed `plutil -lint`; candidate `2.11.0-readonly-extension.3` build also parsed backed-up config and resolved policy with 23 profiles.
- **This is an isolated file and config restore, NOT a live rollback rehearsal.** It does not prove launchd restart, post-start MCP handshake, tunneling, or remote reconnect after service replacement. Keep the gate for those operations until maintenance/recovery checks are complete.
- No production service, launchd job, configuration, package or OpenClaw process was changed.

## Side-by-side protocol and frozen release gate (2026-10-08)

**Actual tested service path:** the live `com.openai.tunnel-client.ssh-mcp` LaunchAgent runs `tunnel-client ... --profile ...`. Its child process launches `node /opt/homebrew/bin/ssh-mcp --config=...`. The executable symlink resolves to `/opt/homebrew/lib/node_modules/ssh-mcp/build/index.js`, so the isolated restore and migration candidate match the **actual** production package.

**MCP stdio compatibility:**
- Restored 2.2.5 baseline and candidate 2.11.0 both completed MCP `initialize` and `tools/list` against the 23-profile backed-up config.
- Baseline: 11 tools, 1 resource; candidate: 15 tools, 1 resource. No legacy tool removed. Added `read-commands-batch`, `sftp-list`, `sftp-upload-file`, `sftp-download-file`.
- No existing tool field was removed and no new field became required. Ten tool input schemas differed in their raw JSON: nine have metadata-only changes; `signal-process.pid` retains `minimum: 1` and gains the JavaScript safe-integer maximum (`9007199254740991`).
- Both binaries successfully handled **actual** local `list-connections` and `list-sessions` tool calls and reported 23 profiles. Tests did **not** open SSH connections, run remote commands, or execute service restarts.
- The owner-only **staged release** at `~/.local/share/ssh-mcp-releases/ssh-mcp-2.11.0-568d081` is a private 0700 folder containing the exact compiled build, dependency tree, package.json and lockfile from Git commit `568d0815750f105b5bb34a8c18e5e5941f56b137`. Recursive build and dependency comparisons with that checkout found no differences.
- This frozen candidate passed a fresh MCP stdio startup plus the two local tool calls. Exact SHA-256 of the release `build/index.js`: `b30b57c518e9456313f03d00d628deef35c3115d9ad04eb4af1fcaad6059e3f3`.
- The release path is *not* installed globally. The live `ssh-mcp` executable, tunnel, OpenClaw and configuration have not been touched.

**Current opt-in boundary:** No production profile has `viewer2Packs` enabled. The `network` pack now excludes all generic `ping`; `icmp` requires exact IP allowlisting. Unscoped `getent hosts`/DNS lookup was subsequently removed from the passive `linux` pack. HTTP/TCP/TLS are not enabled.

**Audit behavior gate:** Latest tested snapshot had 1,669 Viewer records, with 1,205 historically allowed and 1,170 still allowed under the proposed opt-in policy. The 35 differences include 21 historical active ping calls now refused by default; the remaining 14 are mostly Tailscale probes/debug, sing-box config checks and sensitive or host-specific file/config reads. These require per-command acceptance or separate scoped opt-in. Do not restore unrestricted Viewer `safe` rights.

**Same-volume inactive staging:** the candidate build and locked dependencies were copied from the frozen private release to `/opt/homebrew/lib/node_modules/.ssh-mcp-next-568d081` (non-active sibling of the installed package). File comparisons found no differences, and this exact sibling completed independent MCP stdio initialization plus `list-connections`: 15 tools, 23 profiles, no SSH connects. The global `/opt/homebrew/lib/node_modules/ssh-mcp` directory and binary symlink were not changed. This minimizes cutover work to two same-filesystem renames plus a controlled tunnel restart, but **do not execute that cutover through the MCP tunnel**: an independent operator SSH/Tailscale session must own the switch and immediate rollback.

**Final cutover still gated:** Before touching `/opt/homebrew/lib/node_modules/ssh-mcp`, verify a live *independent* SSH/Tailscale SSH or desktop recovery session outside the tunnel, establish a reversible atomic package switch with a bounded rollback path, and verify both old and new binaries after switch including actual SSH command policy, audit entries and tunnel reconnection. A successful stdio side-by-side test is not that live rollback proof. Keep PR draft/unmerged until explicit production gate is satisfied.

## Prepared interactive cutover and rollback helper (NOT executed)

- Local script: `~/.local/share/ssh-mcp-releases/viewer2-cutover-568d081.sh`; available on the Mac mini within a 0700 private directory. Identical source tracked in `scripts/viewer2-cutover-mac-mini.sh` in PR #1. **It is not a source of additional authorization to deploy.**
- `/bin/bash ~/.local/share/ssh-mcp-releases/viewer2-cutover-568d081.sh preflight` is read-only and has actually passed **14/14** runtime checks: secure backup/config, expected archive SHA, old and new versions, frozen binary SHA, symlink, 23 profiles, no Viewer2 or active-probe opt-ins, registered tunnel service, correct ownership, same filesystem.
- Bash syntax validation and exact **read-only** production preflight passed. The script's file-move logic was also tested against an isolated mock package tree with `launchctl` replaced by `/usr/bin/true`: activation, rollback, and deliberately injected failure during the second rename all passed; the failure trap restored the old mock package. **This does NOT validate a real launchd restart or live MCP reconnection.**
- `activate` requires a real interactive terminal and typed `INDEPENDENT-ACTIVATE`. It moves the original global package aside to a timestamped sibling, renames the already validated inactive candidate into the original global path, records the rollback path, and requests a restart of **only** `com.openai.tunnel-client.ssh-mcp`. A failed shell operation attempts an immediate filesystem restore through an EXIT trap, but this is not a substitute for independent access.
- `rollback` requires an interactive terminal and typed `RESTORE-ORIGINAL`. It restores the preserved installed package, using the stored rollback path, and restarts the SSH-MCP tunnel. The protected tar/config/plist backup remains available if the direct directory swap fails.
- The cutover script has **no autonomous deadline watchdog**. The operator must keep a working independent SSH/Tailscale SSH session open during and after `activate` and perform `rollback` immediately if ChatGPT's MCP reconnection, viewer denials, admin behavior, or audit trail fails. Never run `activate` or `rollback` through the SSH-MCP connection being replaced.
- Nothing was run that restarts the live tunnel or replaces the global binary; PR #1 remains Draft.

## Fixed SFTP approval regression — rollout candidate f1314bf (2026-10-08)

**Root cause of failed first canary:** the 2.11 policy deliberately classifies `sftp:upload` as `destructive`. The current MCP client has no form-elicitation capability, so `ask-destructive` reliably produced `APPROVAL_UNAVAILABLE`. Version 2.2.5 historically classified upload as `safe` and permitted it without approval; that broad implicit write authority must not be restored. The independent operator terminal successfully rolled back to 2.2.5; the real post-rollback SFTP upload/read-back and its audit record succeeded.

**Fix:** the 2.11 candidate now supports a tightly bounded, **out-of-band local file approval**, not a general downgrade of the SFTP classifier. In an independent Mac mini terminal the operator can run:

```sh
/opt/homebrew/bin/node ~/.local/share/ssh-mcp-releases/grant-admin-sftp.mjs mac-mini-admin /Users/rentamac/.cache/ssh-mcp-restore-check/sftp-canary.txt 1024
```

The issuer requires an interactive terminal and the explicit text `APPROVE-30M-SFTP`. It writes an owner-only 0600 file under the existing owner-only 0700 `~/.config/ssh-mcp` directory. The server dynamically validates the file on each `sftp-upload` call, so neither MCP form elicitation nor a service restart is required. The file binds the approval to **one named Admin profile, one exact absolute POSIX destination, max 1 MiB payload and at most 30 minutes**. An absent/expired/invalid/exposed grant fails closed to the normal approval path. Existing Viewer/Operator role bindings, read-only restrictions, built-in/user denylist, quota and optional OPA remain in effect. The upload stays classified `destructive`; the successful audit records the rule `out-of-band-sftp-preapproval` and approver `operator-owned-30min-sftp-grant`. No uploads to arbitrary paths are implicitly authorized.

**Security limitation:** this is a time-boxed, exact-file **operator delegation**, not cryptographic 2FA or a WebAuthn assertion. It relies on ownership of the protected Mac mini account and the operational discipline of approving only expected files in an independent terminal. A WebAuthn approval broker can be integrated separately. Do not call this a permanent global Admin write grant.

**Validation:** candidate TypeScript build passed. 122 targeted tests (four test files) passed, including admin policy grant, expiry, wrong profile/path/size/role, private file/directory restrictions and denial of unsafe neighbors. A prior isolated candidate completed real MCP stdio/SFTP upload/read-back when granted through a temporary profile configuration; dynamic file grants have been verified by unit/policy tests. A real dynamic-file end-to-end test on the Mac mini was not completed because the tool's safety checks blocked its execution; this remaining integration case is a mandatory **post-cutover canary** before confirming rollout. It must succeed with the actual ChatGPT MCP connector (which lacks form elicitation), or immediately roll back.

**Staging:** new candidate `f1314bfd9ff9a00728065ea4bc01af4abf3eae33` is compiled into private release `~/.local/share/ssh-mcp-releases/ssh-mcp-2.11.0-f1314bf` and inactive same-volume sibling `/opt/homebrew/lib/node_modules/.ssh-mcp-next-f1314bf`. Recursive build/dependency comparisons passed. Grant module SHA-256: `730c058b8150f1da68bd9c4aa5c0d300bd165b8ca8e266641a8cf6881545f5e0`. The new operator-only cutover script is `~/.local/share/ssh-mcp-releases/viewer2-cutover-f1314bf.sh` (also tracked at `scripts/viewer2-cutover-mac-mini.sh`). Bash syntax and **15/15** read-only preflight checks passed against this build. The original backup tar and running production SSH-MCP 2.2.5 are unchanged. **The new release is not yet active.**

**Rollout procedure** (only when the exact latest PR CI is green, from an independent interactive SSH/Tailscale SSH session):

1. Keep the independent terminal open and run `/bin/bash ~/.local/share/ssh-mcp-releases/viewer2-cutover-f1314bf.sh preflight`. Expect `allPass:true`.
2. Run `/bin/bash ~/.local/share/ssh-mcp-releases/viewer2-cutover-f1314bf.sh activate` and type `INDEPENDENT-ACTIVATE`; this restarts only the SSH-MCP tunnel.
3. Reconnect ChatGPT MCP; verify installed 2.11 version, 23 profiles, Viewer read, Viewer write denial and Admin read/run.
4. Issue the bounded SFTP grant via independent terminal above, then use the MCP connector `sftp-upload` under `mac-mini-admin` for the **exact** approved file and verify SFTP read-back and audit rule. Do not test this by granting arbitrary directories or all Admin profiles.
5. If this or any other gate fails, immediately run `/bin/bash ~/.local/share/ssh-mcp-releases/viewer2-cutover-f1314bf.sh rollback` in that same independent session, confirm `RESTORE-ORIGINAL`, and recheck 2.2.5.

The PR remains Draft until the live canary and post-cutover audit validate the full fixed workflow.

## Second canary activation failure: literal redaction marker in rollback path (2026-10-08)

The independent operator issued the exact-path 30-minute SFTP canary grant and `preflight` returned **15/15 passed**. During `activate`, the old global directory was renamed and the new candidate was moved to its place; then the script failed at line 63 while trying to open its state marker. **This was a cutover-helper defect, not an SSH-MCP package or SFTP authorization failure.**

**Root cause proven:** the previous GitHub script source and its deployed Mac mini copy both contained a **literal redaction placeholder** in the `BACKUP` assignment instead of the real directory name. The path was not simply redacted when displayed: exact literal comparison against the expected backup path failed, and both downloaded sources contained the placeholder. This caused the attempted state-marker write to point to a nonexistent directory.

**Safety/recovery:** the `trap rescue EXIT` handler executed. Live after the failure, the active package was **2.2.5-readonly-extension.3**, the SSH-MCP tunnel had relaunched, all 23 connections were available, the old `*.restored` backup marker remained and there was no pending active-rollback marker. The new candidate's inactive sibling directory was preserved. **No manual rollback was necessary after this failed second activation.**

**Fix:** `scripts/viewer2-cutover-mac-mini.sh` and the deployed copy `~/.local/share/ssh-mcp-releases/viewer2-cutover-f1314bf.sh` now construct the non-secret backup path in two short components (`BACKUP_ROOT` plus the dated child) and refuse to start if the resulting backup directory is missing. The helper contains **no literal redaction placeholder**. Bash syntax and the live read-only preflight passed again (15/15). A new isolated simulation verified actual switch-to-new, switch-back-to-old and an injected failure during the second package rename. No `launchctl` command was executed in the simulation. CI now includes `test/unit/ops/viewer2-cutover-script.test.ts` to catch embedded redaction markers or missing rollback invariants before release.

**Next attempt:** only after green CI on the latest exact PR commit, use the existing independent Mac mini SSH/Tailscale terminal to run the corrected helper's `preflight` and `activate`. The time-limited SFTP grant might need to be **reissued** before performing the live exact-file upload. Keep the independent session open, check the new process and live SFTP upload+download and audit, and roll back immediately if a gate fails. Do not run a fresh activation from the SSH-MCP tunnel being replaced.

## Third canary rollout: live accepted, no regression (2026-10-08)

Operator issued a fresh independent-terminal grant bound to `mac-mini-admin`, exact file `/Users/rentamac/.cache/ssh-mcp-restore-check/sftp-canary.txt`, size limit 1024 bytes, expiration `2026-10-08T09:00:57.290Z`. Corrected `viewer2-cutover-f1314bf.sh` passed the **15/15** preflight checks, then printed `ACTIVATED` after the operator supplied `INDEPENDENT-ACTIVATE`.

Actual ChatGPT SSH-MCP connector was immediately used for post-cutover acceptance:

- Live installed package `2.11.0-readonly-extension.3` from `/opt/homebrew/lib/node_modules/ssh-mcp/package.json`.
- Tunnel-client restarted successfully with `node /opt/homebrew/bin/ssh-mcp --config=...`; 23 configured profiles discovered, including Viewer/Admin.
- **Real connector upload succeeded** with `mac-mini-admin` to the sole granted file: 89 bytes. Same connector read back exactly the expected text.
- Upload audit: `commandClass=destructive`, `decision=allow`, `ruleId=out-of-band-sftp-preapproval`, `approver=operator-owned-30min-sftp-grant`, `exitCode=0`. Download audited as `read-only`, `allow`.
- Admin `run-command` with `/opt/homebrew/bin/node --version` succeeded. Viewer `hostname` on local Mac mini and remote Salty VPS succeeded.
- A second Admin SFTP upload with a **different, not preapproved file path** was denied (client lacks elicitation, fails closed). No forbidden file was created. Its audit captured `require-approval` / `approval-policy`.
- Viewer SFTP upload to the canary path denied `POLICY_DENIED` (cannot inherit Admin's grant). Viewer `touch` denied `POLICY_DENIED` and audited `deny` / `role-binding`. Neither test created a file.
- Corrected rollback state marker `viewer2-active-rollback-path` exists with protected mode `0600`; previously installed 2.2.5 package retained as `/opt/homebrew/lib/node_modules/.ssh-mcp-prev-20261008T083103Z`; prior full package/config/launchd archive untouched.

**Conclusion: the original approval/elicitation regression, the rollback-path placeholder defect, the rebuilt package startup and the live restricted SFTP acceptance tests are resolved. Live candidate is operational.** The 30-minute canary grant is an intentionally temporary authorization; it expires by time even if its file stays on disk. It does *not* enable general admin uploads or restore implicit unrestricted destructive writes. Viewer2 diagnostic packs are still opt-in per profile and have not yet been activated. Keep rollback available until operational acceptance is complete. Full cryptographic WebAuthn authorization remains a separate scope.

## Preflight evidence — read only, 2026-10-08

- macOS 27.0.1.
- Mac mini launchd contains `com.openai.tunnel-client.ssh-mcp`, with PID observed.
- `com.openai.tunnel-client.browser-mcp` and `ai.openclaw.gateway` are separate services. Viewer 2 must not modify them.
- Production `ssh-mcp` installed at `/opt/homebrew/lib/node_modules/ssh-mcp`.
- Production config at `/Users/rentamac/.config/ssh-mcp/config.toml`.
- Current viewer config includes `approvalMode = "deny"` globally and `role = "viewer"`, `group = "prod"`, `readOnly = true` per Viewer profile.
- Available existing backups in `/Users/rentamac/.config/ssh-mcp` date to September 2026. They are not a substitute for a fresh deploy-specific backup.

## Safe staged deployment (only after all hard stop conditions clear)

1. Confirm the exact commit and package build/checksum.
2. Independently establish and **test** an SSH/Tailscale recovery route to the Mac mini that does not require the SSH-MCP tunnel process.
3. Capture copies of production package, active config, launchd job, tunnel-client configuration and SHA-256 manifests in a restricted dated backup directory. Secrets stay on Mac mini.
4. Validate the prospective package/config off to the side with a separate port/transport and no production session state.
5. Run the positive and **negative** policy tests against that offline instance.
6. Install via atomic release switch or equivalent reversible swap. Do not edit global `node_modules` in place without a verified prior copy.
7. Restart **only** the SSH-MCP tunnel process/service, not OpenClaw, browser-mcp, cloudflared, or other launchd jobs.
8. Validate viewer read operations and denials (writes must still be rejected), then admin role and default timeout/auth behavior.
9. Roll back immediately if connectivity, policy behavior, auditing or server start differs from baseline.
10. Keep the backup until post-rollout soak and sign-off.

## Health checks

- GitHub release commit/checksum matches deployed build.
- `launchctl list` reports `com.openai.tunnel-client.ssh-mcp` running.
- MCP tool/list and control read-command succeeds.
- On **every** configured Viewer role, `read-command` and batch read commands function, but `systemctl restart`, `nft add`, `sudo` and arbitrary scripts are rejected without execution.
- Audit records include correct profile, individual batch item, decision and command class.
- Admin role remains subject to original host-group bindings and approval policy.
- No private keys, tokens or secrets are leaked in logs/reports.

## Rollback

- Preserve an independent recovery session before the release switch.
- Revert to the snapshotted SSH-MCP package, active config and service registration.
- Restart only the SSH-MCP tunnel service using the independent channel.
- Re-run connectivity and viewer/admin denial tests; compare against snapshots.
- Do not auto-merge or auto-deploy from PR CI.

## Manual participation needed

- Confirm the **independent** Mac mini access path is working and can recover a failed launchd tunnel without physical access.
- Approve concrete diagnostic network egress allowlists (initially disabled).
- Provide human monitoring for the switchover if the tunnel that ChatGPT uses is affected.

User approval for the rollout phase has been received on 2026-10-08, but approval does not waive any of these hard safety gates.
