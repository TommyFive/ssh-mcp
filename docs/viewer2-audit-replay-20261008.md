# Viewer 2.0 — offline migration and security replay (2026-10-08)

## Method

- Remote Mac mini test checkout: `~/.cache/ssh-mcp-viewer2-audit-lab`, **separate** from the installed production SSH-MCP under `/opt/homebrew/lib/node_modules/ssh-mcp`.
- The test build read, but did not change, `~/.config/ssh-mcp/config.toml` and `~/Library/Logs/ssh-mcp/audit.log`.
- Tests run with the actual candidate **compiled** `PolicyEngine` and `classifyCommand`. No historical shell command was executed.
- Raw audit records (including potentially private command text) were not uploaded to GitHub; only aggregate counts are included here.
- Candidate opt-in packs were selected by host category for simulation. **No production profile has been opted in.** This is a simulation of proposed rollout packs, not a prediction of actual user-issued commands.

## Migration compatibility

1. Initial compilation of the candidate passed, but the production configuration **failed parsing**: 15 of 23 profile definitions used pack names removed from the newer repository.
2. Missing named packs: `linux-system-diagnostics` (13 uses) and `asus-merlin-diagnostics` (2 uses).
3. The matcher definitions were recovered from the deployed 2.2.5 classifier, retained behind the existing shell-control-character gate and reinstated in the schema/types.
4. The updated isolated candidate build now accepts **all 23 profiles**. This does not yet mean production migration/rollback tests are complete.

## Audit replay results (live audit snapshot, 2026-10-08)

| Measurement | Count |
|---|---:|
| Raw events examined | 6,525 |
| Denied events | 535 |
| Viewer-profile events used for historical behavior comparison | 1,588 |
| Historically allowed Viewer events | 1,132 |
| Previously allowed events still allowed with candidate host-category opt-ins | 1,097 |
| Previously allowed events newly denied | **35** |
| Historically denied Viewer events now allowed in candidate simulation | 88 |

A separately scoped check focused on historically denied commands found **32** commands newly allowed *because of candidate positive-list patterns* compared with the newer baseline.

Counts naturally vary while the live audit log is appended. The comparison identifies policy deltas, not whether individual commands would succeed on their destination OS. The batch command tool and synthetic SFTP audit entries can also differ from ordinary command classification.

### Remaining historical allow-to-deny regression families (35 total)

- `journalctl`: 10
- `tailscale`: 5; macOS Tailscale binary path: 2
- `hostname`: 2; `date`: 1
- Other low-frequency diagnostics: `sing-box` 2; `log`, `mwan3`, `pmset`, `systemctl`, `lsblk`, `/usr/local/bin/sing-box`, `uci`, `ubus`, `logread`, `opkg`, `plutil`, `scutil`, `sysctl` (one each).

Do not broadly grant `safe` or general shell utilities to eliminate these residual diffs. Treat each family by its actual command grammar and host-specific risk.

## Security regression discovered and fixed

Historical denied **destructive** commands were classified read-only by the newer baseline:

- `find ... -fprint0 FILE` writes a file.
- `file --compile -m FILE` compiles a binary magic DB.

These were **not** Viewer2 additions: they already slipped through the baseline allowlisted binary check. The new branch now disqualifies `find -fprint0`, `file --compile`, `file -C`, and the combined-output `sort -oFILE` form, with negative tests. The apparent historical destructive-to-read-only drift dropped from 2 to 0.

## CI status / constraints

- On commit `e24b1144` all 7 required GitHub Actions jobs passed, including the repository's now-enabled Dependency Review.
- Later commits (legacy pack migration compatibility and file/find fixes) require their **own** CI evidence. A green older commit is not a green current PR.
- Isolated Mac mini TypeScript compilation and 122 related policy tests passed after the file/find fixes; the newer Viewer2 network matchers subsequently passed 74 related tests locally.

## Production rollout blockers

- Recheck CI on PR current head after these changes.
- Review the remaining 35 previously allowed diagnostics and resolve only those low-risk cases approved for Viewer.
- Decide egress scope and authorization architecture for probes (TCP/HTTP/TLS) separately from passive reads.
- Confirm a working independent SSH/Tailscale or Remote Desktop recovery session at rollout time (user says all exist), take dated backups, rehearse restoration without touching the live SSH-MCP tunnel.
- The production installation is still `2.2.5-readonly-extension.3` and the candidate `2.11.0-readonly-extension.3` plus new Viewer2 changes.
- **Do not merge/deploy until safety gates pass.** User's approval B authorizes a planned rollout, not bypassing these gates.


## Follow-up replay after bounded compatibility additions

A later *isolated* re-run added narrowly matched journal, OpenWrt and macOS passive diagnostics. Against the same 1,588 historical Viewer records, **1,113 of the 1,132 historically allowed operations remain allowed** and **19** would be denied by the candidate opt-in policy, compared with 35 in the first replay. **91** previously denied records are newly allowed in this overall comparison, including historical version differences (do not attribute all 91 to Viewer2 packs).

The 19 remaining are mostly Tailscale, sing-box and low-frequency device-specific commands. These must be reviewed individually; they are not authorization to grant the general `safe` class. Active probes remain a separate egress/SSRF design decision. The current prototype includes a bounded `ping` form in the network pack; the risk and target scope of that form must be explicitly reviewed before production activation.

The production SSH-MCP, its system service and config have not been changed by this replay.
