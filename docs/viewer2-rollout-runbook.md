# Viewer 2.0 — Production rollout and rollback runbook (not yet executable)

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
