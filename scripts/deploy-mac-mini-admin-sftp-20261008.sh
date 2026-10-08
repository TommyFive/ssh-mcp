#!/bin/bash
# Production Mac mini SSH-MCP 2.11 scoped-Admin-SFTP cutover.
# Run ONLY in an independent interactive Tailscale SSH terminal on the Mac mini.
# Never start activate/rollback from the SSH-MCP server you are replacing.
set -Eeuo pipefail
umask 077

COMMIT=62089183cc07f667a731ca52125674f4959a8a8f
SHORT=62089183
HOME_EXPECTED=/Users/rentamac
MODE="$1"
PREFIX=/opt/homebrew/lib/node_modules
ACTIVE="$PREFIX/ssh-mcp"
NEXT="$PREFIX/.ssh-mcp-sftp-next-$SHORT"
OLD="$PREFIX/.ssh-mcp-sftp-prev-$SHORT"
FAILED="$PREFIX/.ssh-mcp-sftp-failed-$SHORT"
CFG="$HOME/.config/ssh-mcp/config.toml"
LAUNCH="$HOME/Library/LaunchAgents/com.openai.tunnel-client.ssh-mcp.plist"
LABEL="gui/$(id -u)/com.openai.tunnel-client.ssh-mcp"
RELEASES="$HOME/.local/share/ssh-mcp-releases"
STAGE="$RELEASES/admin-sftp-$SHORT"
SNAP="$HOME/.local/share/ssh-mcp-backups/admin-sftp-$SHORT"
NODE=/opt/homebrew/bin/node
NPM=/opt/homebrew/bin/npm
GH=/opt/homebrew/bin/gh

die() { printf 'STOP: %s\n' "$*" >&2; exit 2; }
[ "$HOME" = "$HOME_EXPECTED" ] || die "Run as rentamac in the independent Mac mini terminal."
[ "$(id -un)" = rentamac ] || die "Wrong macOS user."
[ -x "$NODE" ] && [ -x "$NPM" ] && [ -x "$GH" ] || die "Required node/npm/gh executable absent."
[ -f "$CFG" ] && [ -f "$LAUNCH" ] && [ -d "$ACTIVE" ] || die "Live SSH-MCP/config/launchd missing."
[ -d "$HOME/.openclaw/workspace/documentation" ] || die "Missing documentation workspace."
[ -d "$HOME/.openclaw/workspace/projects" ] || die "Missing projects workspace."
[ -d "$HOME/.local/share/ssh-mcp-backups" ] || die "No protected backup directory."
[ "$(stat -f %Lp "$CFG")" = 600 ] || die "Config must be mode 0600."
[ "$(stat -f %Lp "$HOME/.config/ssh-mcp")" = 700 ] || die "Config directory must be mode 0700."

case "$MODE" in
prepare)
  [ ! -e "$STAGE" ] || die "Staging already exists: $STAGE (do not overwrite blindly)."
  [ ! -e "$NEXT" ] || die "Next package directory already exists: $NEXT."
  [ ! -e "$OLD" ] || die "Old package directory already exists: $OLD."
  [ ! -e "$SNAP" ] || die "Backup directory already exists: $SNAP."
  mkdir -m 700 "$STAGE"
  echo "PREPARE: obtaining immutable GitHub source revision $COMMIT"
  "$GH" api "repos/TommyFive/ssh-mcp/commits/$COMMIT" --jq .sha |
    grep -Fx "$COMMIT" >/dev/null || die "GitHub commit identity mismatch / unauthorized."
  "$GH" api "repos/TommyFive/ssh-mcp/tarball/$COMMIT" > "$STAGE/revision.tar.gz"
  mkdir -m 700 "$STAGE/source"
  tar -xzf "$STAGE/revision.tar.gz" -C "$STAGE/source" --strip-components=1
  grep -q 'approvedSftpWorkspaceRoot' "$STAGE/source/src/policy/engine.ts" ||
    die "Scoped SFTP feature missing."
  grep -q 'O_NOFOLLOW' "$STAGE/source/src/policy/sftp-preapproval.ts" ||
    die "O_NOFOLLOW security fix missing."

  echo "PREPARE: building candidate outside the live package"
  (cd "$STAGE/source" && PATH="/opt/homebrew/bin:$PATH" "$NPM" ci --no-audit --no-fund &&
      PATH="/opt/homebrew/bin:$PATH" "$NPM" run build)

  echo "PREPARE: copying and checking side-by-side package"
  /usr/bin/ditto "$STAGE/source" "$NEXT"
  chmod 700 "$NEXT"
  grep -q 'fstatSync' "$NEXT/build/policy/sftp-preapproval.js" ||
    die "Staged compiled binary lacks secure descriptor check."
  grep -q 'admin-sftp-workspace-scope' "$NEXT/build/policy/engine.js" ||
    die "Staged policy feature missing."

  echo "PREPARE: validating 23 profiles and new scoped TOML, without replacing live config"
  CANDIDATE="$HOME/.config/ssh-mcp/.candidate-$SHORT.toml"
  [ ! -e "$CANDIDATE" ] || die "Candidate config already exists."
  STAGE_PKG="$NEXT" CONFIG_OLD="$CFG" CONFIG_NEW="$CANDIDATE" "$NODE" --input-type=module <<'NODEJS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const pkg = process.env.STAGE_PKG;
const originalPath = process.env.CONFIG_OLD;
const candidatePath = process.env.CONFIG_NEW;
const { loadConfig } = await import(pathToFileURL(join(pkg, 'build/config/loader.js')).href);
const before = await loadConfig(originalPath);
assert.equal(before.profiles.length, 23);
assert.equal(before.profiles.filter(p => p.role === 'viewer' && p.readOnly).length, 13);
assert.equal(before.profiles.filter(p => p.role === 'admin' && !p.readOnly).length, 10);
assert.equal(before.profiles.filter(p => p.sftpWorkspaceWrite).length, 0);
const raw = readFileSync(originalPath, 'utf8');
const blocks = [...raw.matchAll(/^\[\[profiles\]\][ \t]*$/gm)];
assert.equal(blocks.length, 23);
const targets = blocks.map((m, i) => ({
  start: m.index,
  end: blocks[i + 1]?.index ?? raw.length,
})).filter(({ start, end }) =>
  /^name[ \t]*=[ \t]*"mac-mini-admin"[ \t]*$/m.test(raw.slice(start, end)));
assert.equal(targets.length, 1, 'mac-mini-admin must occur exactly once');
const at = targets[0].end;
const addition = '\n[profiles.sftpWorkspaceWrite]\n' +
  'roots = ["/Users/rentamac/.openclaw/workspace/documentation", ' +
  '"/Users/rentamac/.openclaw/workspace/projects"]\n' +
  'maxBytes = 65536\n\n';
const edited = raw.slice(0, at) + addition + raw.slice(at);
writeFileSync(candidatePath, edited, { flag: 'wx', mode: 0o600 });
chmodSync(candidatePath, 0o600);
const after = await loadConfig(candidatePath);
assert.equal(after.profiles.length, 23);
assert.deepEqual(after.profiles.find(p => p.name === 'mac-mini-admin')?.sftpWorkspaceWrite, {
  roots: [
    '/Users/rentamac/.openclaw/workspace/documentation',
    '/Users/rentamac/.openclaw/workspace/projects',
  ],
  maxBytes: 65536,
});
const withoutScope = {
  ...after,
  profiles: after.profiles.map(({ sftpWorkspaceWrite, ...rest }) => rest),
};
assert.deepEqual(withoutScope, before, 'Unexpected profile/default/policy change!');
console.log('PASS: 23/23 profiles validated; only mac-mini-admin.sftpWorkspaceWrite is new.');
NODEJS
  shasum -a 256 "$CFG" | awk '{print $1}' > "$STAGE/sha-config-before"
  echo "$COMMIT" > "$STAGE/release-commit"
  chmod 600 "$STAGE/sha-config-before" "$STAGE/release-commit"
  touch "$STAGE/READY"
  echo "READY: candidate built; service and original TOML NOT CHANGED."
  echo "NEXT: run this script with argument activate from the SAME INDEPENDENT SSH terminal."
  ;;
activate)
  [ -f "$STAGE/READY" ] && [ -d "$NEXT" ] ||
    die "No successfully prepared, side-by-side package."
  [ ! -e "$OLD" ] && [ ! -e "$SNAP" ] && [ ! -e "$FAILED" ] ||
    die "Old/backup/failed path already exists; refusing another cutover."
  test "$(cat "$STAGE/release-commit")" = "$COMMIT" || die "Staged revision mismatch."
  test "$(shasum -a 256 "$CFG" | awk '{print $1}')" = "$(cat "$STAGE/sha-config-before")" || die "Live config drifted since prepare."
  [ -f "$HOME/.config/ssh-mcp/.candidate-$SHORT.toml" ] ||
    die "Validated candidate TOML missing."
  echo "ACTIVATE: making protected backup first"
  mkdir -m 700 "$SNAP"
  cp -p "$CFG" "$SNAP/config.toml"
  cp -p "$LAUNCH" "$SNAP/com.openai.tunnel-client.ssh-mcp.plist"
  /usr/bin/ditto "$ACTIVE" "$SNAP/ssh-mcp-package"
  chmod 700 "$SNAP/ssh-mcp-package"
  echo "$COMMIT" > "$SNAP/release-commit"
  test "$(shasum -a 256 "$SNAP/config.toml" | awk '{print $1}')" = "$(cat "$STAGE/sha-config-before")" || die "Backup integrity failure before switching."
  echo "ACTIVATE: switching binaries/config; rescue trap armed"
  rollback_on_error() {
    local rc="$1"
    trap - ERR HUP INT TERM
    set +e
    echo "AUTOMATIC ROLLBACK (code $rc)"
    if [ -d "$OLD" ]; then
      [ -d "$ACTIVE" ] && mv "$ACTIVE" "$FAILED"
      mv "$OLD" "$ACTIVE"
    fi
    if [ -f "$SNAP/config.toml" ]; then
      cp -p "$SNAP/config.toml" "$CFG.rollback-$SHORT"
      mv -f "$CFG.rollback-$SHORT" "$CFG"
    fi
    launchctl kickstart -k "$LABEL" 2>&1
    echo "Rollback attempted; inspect health from the independent SSH terminal."
    exit "$rc"
  }
  trap 'rollback_on_error $?' ERR
  trap 'rollback_on_error 129' HUP
  trap 'rollback_on_error 130' INT
  trap 'rollback_on_error 143' TERM
  mv "$ACTIVE" "$OLD"
  mv "$NEXT" "$ACTIVE"
  chmod 700 "$ACTIVE"
  mv "$HOME/.config/ssh-mcp/.candidate-$SHORT.toml" "$CFG"
  chmod 600 "$CFG"
  launchctl kickstart -k "$LABEL"
  sleep 8
  launchctl print "$LABEL" | grep -q 'state = running'
  ps aux | grep '[n]ode /opt/homebrew/bin/ssh-mcp --config=' >/dev/null
  trap - ERR HUP INT TERM
  echo "SUCCESS: new build active, 23 profiles staged/validated, original retained."
  echo "BACKUP: $SNAP"
  echo "OLD: $OLD"
  echo "Next: ChatGPT MCP read/write and Viewer denial smoke tests. Do not delete backups."
  ;;
rollback)
  [ -d "$OLD" ] && [ -f "$SNAP/config.toml" ] ||
    die "No old package or saved configuration for manual rollback."
  [ ! -e "$FAILED" ] || die "Failed-package destination already exists; manual review."
  echo "ROLLBACK: restore previous package and TOML from protected backup"
  mv "$ACTIVE" "$FAILED"
  mv "$OLD" "$ACTIVE"
  cp -p "$SNAP/config.toml" "$CFG.restore-$SHORT"
  mv -f "$CFG.restore-$SHORT" "$CFG"
  launchctl kickstart -k "$LABEL"
  sleep 8
  launchctl print "$LABEL" | grep -q 'state = running' ||
    die "Rollback attempted but LaunchAgent not running."
  echo "ROLLBACK COMPLETED: verify via ChatGPT SSH-MCP."
  ;;
*)
  die "Usage: bash $0 prepare | activate | rollback"
  ;;
esac
