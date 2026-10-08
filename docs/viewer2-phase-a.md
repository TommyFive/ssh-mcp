# Viewer 2.0 — Experimental Phase A

**Status:** Development branch only. Do **not** merge or deploy until a separate production approval. No VPS changes and no production SSH-MCP changes are included.

## Source and baseline

- Production mac-mini SSH-MCP observed on 2026-10-08: `2.2.5-readonly-extension.3`.
- GitHub `main` is already `2.11.0-readonly-extension.3`; upgrading production is a **separate migration** and compatibility exercise.
- Observed audit log: 6,331 events at the initial snapshot (2026-08-17 to 2026-10-08).
- At the later replay snapshot: 532 denied events, 400 `safe` commands denied by role binding. Counts changed because the shared audit log is live and constantly appended.
- An *independent* conservative matcher dry-run across those 400 events found 33 literal standalone commands matching the new positive-list prototype (**8.3%**). This is a simulation of the candidate regexes, **not** proof of runtime authorization and not a full replay of the built SSH-MCP.
- Most remaining rejections concern shell sequences, pipes, filters, nonliteral quoting, and commands outside the existing positive list. The goal is to add these safely, not make `safe` executable by viewers.

## Components included

- `src/policy/viewer2.ts`: deny-by-default positive-list read-only pack matcher, **now integrated** behind optional per-profile `viewer2Packs` (defaults to empty). No existing profile is activated or updated.
- `src/policy/viewer2-batch.ts`: non-executing planner for up to 16 independent commands; useful for test-only evaluation.
- `src/tools/viewer2-batch-tool.ts`: optional MCP read-commands-batch tool; every command individually uses the **existing** `runAudited()` central pipeline, the **existing** classifier, the per-profile policy and the `enforceClass: 'read-only'` rule. The batch tool receives the central classifier's current decision (including per-profile Viewer2 opt-in) and cannot override a deny decision.
- `src/tools/registry.ts`: registers this new tool.
- `test/unit/policy/viewer2*.test.ts`: positive matching and negative injection tests.

## Security invariants

1. No `safe`/unknown blanket role authorization; Viewer still permits only `read-only` in production.
2. No arbitrary command composition via `; && || | > <`, substitution, redirects or shell wrappers. The batch tool requires simple literal argv words.
3. **Each** batch item is separately authorized and audited. Rejection of one item does not silently grant subsequent commands.
4. Hard denylist, host-group binding and approval semantics remain unchanged. All commands use the central `runAudited()` pipeline.
5. Active network probing (`nc`, `curl`, `iperf3`, `tcpdump`) and SFTP downloads are **not** activated.
6. No broadening of paths or secret-reading permissions. The existing root-Viewer confidentiality issue remains a separate major security concern.
7. Repository feature branch does not imply permission to patch the production SSH-MCP process, restart it, or change any remote machine.

## Remaining Phase A work before readiness

- Confirm the newly integrated opt-in Viewer 2 matcher is covered by the full current GitHub classifier regression suite, including nested-command defenses.
- Implement diagnostic capabilities as explicit operations with per-target allowlists and DNS-rebinding/SSRF safety. Do not disguise them as `read-only`.
- End-to-end integration tests with simulated SSH targets, plus negative tests through all MCP entrypoints (run_command, sessions, SFTP).
- Confirm CI typechecking, tests and package compatibility against the exact production version. A build of the newer GitHub code does not prove compatibility with the installed 2.2.5 fork.
- Replay the entire raw audit in an isolated test environment using the *actual compiled* candidate classifier; current 33/400 is only an approximate rule-simulation.
- Migration and rollback rehearsal without restarting any production MCP.
- Obtain **separate explicit approval B** prior to editing the Mac mini production installation or production remote hosts.

## Suggested deployment acceptance gates

- Build and full unit/integration/security tests all green.
- No formerly forbidden or mutating command is promoted to Viewer.
- Audit log attribution preserved for every batch item.
- Read-only reductions measured against the real replay and reviewed by human.
- Access continuity through an independent recovery route verified.
- Source version and production drift reconciled before any rollout.

## Manual input

No manual action required for isolated development. Before production: confirm approved diagnostic egress targets and ports, verify Mac mini alternate recovery access, and explicitly approve the production rollout and any SSH profile changes.

## Updated recovery and dependency preflight (2026-10-08)

- User confirmed independent SSH, Tailscale SSH and Remote Desktop access to the Mac mini. Recovery route is therefore available, but a live rollback rehearsal is still outstanding.
- Development-branch lockfile was refreshed with compatible dependency security updates on an isolated GitHub Actions runner. The vulnerable `shx` build helper and its transitive `shelljs` dependency graph were removed and replaced with a native Node chmod helper. This does **not** prove the audit is clean until the CI security-scan passes on the resulting commit.
- No production SSH-MCP package, configuration or service has been changed.

## Viewer2 opt-in configuration (source branch only)

The profile schema accepts `viewer2Packs = ["linux", "network", "vpn", "openwrt", "macos"]` with only the host-specific subsets needed, e.g. `viewer2Packs = ["linux", "network", "vpn"]` for an explicitly approved Viewer host. The property defaults to `[]`, and **must not be placed into any production config until the separately gated rollout**. It does not make `safe` generally allowed, and cannot overwrite an existing `destructive`/`privileged` classification or policy denylist.

## Active probing is separate from passive diagnostics

The `network` pack no longer allows generic `ping`. For ICMP probes, **both** a profile opt-in (`viewer2Packs = ["icmp"]`) and an exact literal-IP allowlist (`viewer2ProbeTargets = ["198.51.100.10"]`) are required. The IP is documentation-only and not a suggested endpoint. The former generic target-hostname matcher is intentionally removed. Loopback, link-local/metadata, multicast, unspecified and IPv4-mapped IPv6 targets are rejected even if configured. A bounded command grammar limits count and timeout; the normal policy, quota, audit and read-only tool gates still apply.

No HTTP/TCP/TLS active diagnostic tool has been enabled, and no `curl`, `wget`, `nc`, shell pipelines, or unrestricted remote destinations are granted to Viewer.

