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
