# Fork extensions (upstream base v2.27.1)

This branch ports the original fork's opt-in features without importing machine
identifiers, home directories, live configuration files, or production runbooks.

## Security invariants

- Upstream command classification and permanent deny rules remain authoritative.
  A legacy or Viewer2 matcher may promote only a command already classified as
  `safe`, never a `destructive` or `privileged` command.
- Each `read-commands-batch` item uses the same policy and audit pipeline as
  `read-command`; rejected commands cannot authorize subsequent items.
- Admin inline SFTP workspace writes are opt-in per profile, path-scoped, byte
  limited and denied for Viewer and approvalPolicy=deny. The remote tree is
  inspected using `lstat` before upload and before publishing.
- `sftp-upload-file` and ordinary shell commands retain their own authorization
  requirements. Short-lived exact-file grants are bounded to 30 minutes.
- A ChatGPT UI approval is not cryptographically attested at MCP level.
- No production profile is enabled or changed by this source-only branch.

## Required validation before deployment

1. All Upstream unit, integration, E2E, lint, and security CI jobs must pass.
2. Run negative tests against nested shell grammars, never-allowed paths, Viewer
   writes, SFTP symlink swaps, approvalPolicy=deny, and OPA fail-closed decisions.
3. Parse a protected copy of the existing operator TOML, confirming each profile
   and its Viewer/Admin role, without publishing its contents.
4. Use an independent operator recovery route for a staged package cutover.
   The production installation and configuration must not be changed by this
   branch's creation or testing.


## Preserving the 2.11 reader boundary

Pre-existing downstream profiles that explicitly opt in to Viewer2 or
`readOnlyExtensions` retain the **2.11 read-only surface** even though
upstream 2.27.1 recognizes additional readers. Newly recognized commands
remain classified `safe` for those opted-in profiles: an admin can use the
ordinary execution tool under its existing policy, but `read-command` and
read-only profiles do not silently gain access. A finite list of eleven exact, harmless help/version commands restores their
previous read-only classification. No arbitrary operands or shell syntax are
allowed in that exception. The upstream mandatory deny rules, remote-write
restrictions and shell-grammar protections remain authoritative.

The opt-in condition is intentional: installations with no downstream
diagnostic configuration receive the standard upstream 2.27.1 behavior.
Run the compatibility matrix against the deployment's private profiles before
promoting a new version. Do not publish production configuration or the matrix.
