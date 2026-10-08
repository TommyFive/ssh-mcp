# Viewer 2.0 — Production rollout and rollback runbook (not yet executable)

## Hard stop conditions

Do not start deployment while any of the following applies:

1. PR #1 is draft, failed, pending or unreviewed; all required CI checks including `security-scan` must be green.
2. `src/policy/viewer2.ts` prototype is not integrated and explicitly opted into verified profiles.
3. No full policy replay against the actual compiled candidate and representative denied audit corpus has been completed.
4. New binary has not been verified against the **installed** SSH-MCP 2.2.5-readonly-extension.3 API and the currently installed config; GitHub main uses 2.11.0-readonly-extension.3.
5. No known-good independent recovery channel (separate from the SSH-MCP tunnel) has been proved.
6. No tested rollback path exists or no person can restore the Mac mini if SSH-MCP or the tunnel stops.

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
