import { isExactSftpGrantPath } from '../config/schema.js';
import type { Profile } from '../types.js';

/**
 * Scoped, operator-configured Admin SFTP workspace writes.
 *
 * This is NOT evidence of a ChatGPT UI approval: MCP tools/call does not include
 * that decision. ChatGPT can ask before invoking the destructive tool, but the
 * SSH-MCP server independently authorizes only explicitly configured roots.
 *
 * Called by the policy engine AND the file handler. The handler must add a
 * remote SFTP safety check before executing; lexical containment alone is not
 * protection against remote symlinks.
 */
export function approvedSftpWorkspaceRoot(command: string, profile: Profile): string | undefined {
  const grant = profile.sftpWorkspaceWrite;
  if (!grant || profile.role !== 'admin' || profile.readOnly ||
      profile.approvalPolicy === 'deny' || !Array.isArray(grant.roots) ||
      grant.roots.length < 1 || grant.roots.length > 8 ||
      !Number.isSafeInteger(grant.maxBytes) || grant.maxBytes < 1 ||
      grant.maxBytes > 1_048_576) return undefined;

  const m = /^sftp:upload --overwrite --bytes=(0|[1-9][0-9]{0,8}) --sha256=[a-f0-9]{32} (\/[^\r\n]*)$/.exec(command);
  if (!m || Number(m[1]) > grant.maxBytes || !isExactSftpGrantPath(m[2])) return undefined;

  const remotePath = m[2];
  const restrictedNames = new Set([
    'authorized_keys', 'known_hosts', 'config.toml', 'credentials',
    'secrets', 'secrets.json', 'token', 'tokens', 'private-key',
  ]);

  for (const root of grant.roots) {
    // Add a path separator so "/docs2" cannot be authorized by "/docs".
    if (!isExactSftpGrantPath(root) || !remotePath.startsWith(root + '/')) continue;
    const relativeSegments = remotePath.slice(root.length + 1).split('/');
    // Dot entries include .git, .ssh, .env, all dotfiles and dot directories.
    // Hard-reject obvious credentials even when nested inside an allowed root.
    if (relativeSegments.some(s => s.startsWith('.') || restrictedNames.has(s.toLowerCase()) ||
        /^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/i.test(s))) continue;
    return root;
  }
  return undefined;
}
