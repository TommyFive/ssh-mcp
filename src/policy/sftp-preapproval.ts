import { readFileSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { isExactSftpGrantPath } from '../config/schema.js';
import type { Profile } from '../types.js';

/** Local operator-owned SFTP grant; never accepted from the MCP caller. */
export interface SftpUploadGrant {
  paths: string[];
  issuedAt: string;
  expiresAt: string;
  maxBytes: number;
}

const DEFAULT_GRANT_FILE = join(homedir(), '.config', 'ssh-mcp', 'admin-sftp-grant.json');
const MAX_GRANT_BYTES = 4096;

/** Reject non-canonical paths and untrusted/overly broad grant files. */
export function readLocalSftpUploadGrant(profileName: string): SftpUploadGrant | undefined {
  const file = process.env.SSH_MCP_SFTP_GRANT_FILE || DEFAULT_GRANT_FILE;
  if (!isAbsolute(file)) return undefined;
  try {
    const dir = lstatSync(dirname(file));
    const stat = lstatSync(file);
    if (!dir.isDirectory() || (dir.mode & 0o077) !== 0 ||
        !stat.isFile() || (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.() || dir.uid !== process.getuid?.() ||
        stat.size < 2 || stat.size > MAX_GRANT_BYTES) return undefined;
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const x = raw as Record<string, unknown>;
    if (x.version !== 1 || x.profile !== profileName ||
        !Array.isArray(x.paths) || x.paths.length < 1 || x.paths.length > 16 ||
        !x.paths.every((p) => typeof p === 'string' && isExactSftpGrantPath(p)) ||
        typeof x.issuedAt !== 'string' || typeof x.expiresAt !== 'string' ||
        typeof x.maxBytes !== 'number') return undefined;
    return {paths: x.paths as string[], issuedAt: x.issuedAt, expiresAt: x.expiresAt,
      maxBytes: x.maxBytes};
  } catch {
    // No grant or invalid grant always falls back to normal MCP approval.
    return undefined;
  }
}

/** Exact command, exact remote file, capped bytes and 30-minute timebox. */
export function hasValidSftpUploadGrant(command: string, grant: SftpUploadGrant): boolean {
  const now = Date.now(), issued = Date.parse(grant.issuedAt), expiry = Date.parse(grant.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expiry)
      || now < issued || now >= expiry || expiry <= issued || expiry - issued > 1_800_000
      || !Number.isSafeInteger(grant.maxBytes) || grant.maxBytes < 1
      || grant.maxBytes > 1_048_576) return false;
  const m = /^sftp:upload --overwrite --bytes=(0|[1-9][0-9]{0,8}) --sha256=[a-f0-9]{32} (\/[^\r\n]*)$/.exec(command);
  return !!m && Number(m[1]) <= grant.maxBytes
    && isExactSftpGrantPath(m[2]) && grant.paths.includes(m[2]);
}

/** No permission by default. A separate interactive/operator channel issues grants. */
export function approvedSftpUpload(command: string, profile: Profile): boolean {
  const configGrant = profile.sftpUploadPreapproval;
  return (configGrant && hasValidSftpUploadGrant(command, configGrant))
    || hasValidSftpUploadGrant(command, readLocalSftpUploadGrant(profile.name) ?? {
      paths: [], issuedAt: '', expiresAt: '', maxBytes: 0,
    });
}
