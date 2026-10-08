import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLocalSftpUploadGrant, hasValidSftpUploadGrant } from '../../../src/policy/sftp-preapproval.js';
const original = process.env.SSH_MCP_SFTP_GRANT_FILE;
const dirs: string[] = [];
afterEach(() => {
  if (original === undefined) delete process.env.SSH_MCP_SFTP_GRANT_FILE;
  else process.env.SSH_MCP_SFTP_GRANT_FILE = original;
  for (const p of dirs.splice(0)) rmSync(p, { recursive:true, force:true });
});
const path = '/Users/example/staged/approved.txt';
const cmd = (p = path) => `sftp:upload --overwrite --bytes=10 --sha256=${'f'.repeat(32)} ${p}`;
function make(override: Record<string, unknown> = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ssh-mcp-sftp-grant-'));
  dirs.push(d);
  chmodSync(d, 0o700);
  const f = join(d, 'grant.json');
  const now = Date.now();
  const g = { version:1, profile:'mac-mini-admin', paths:[path], maxBytes:1024,
    issuedAt:new Date(now-5_000).toISOString(), expiresAt:new Date(now+300_000).toISOString(), ...override };
  writeFileSync(f,JSON.stringify(g),{mode:0o600});
  process.env.SSH_MCP_SFTP_GRANT_FILE=f;
  return f;
}
describe('owner-only short-lived local SFTP preapprovals', () => {
  it('reads a securely owned file only for the named profile', () => {
    make();
    const grant=readLocalSftpUploadGrant('mac-mini-admin');
    expect(grant).toBeDefined();
    expect(hasValidSftpUploadGrant(cmd(), grant!)).toBe(true);
    expect(hasValidSftpUploadGrant(cmd(path+'-bad'), grant!)).toBe(false);
    expect(readLocalSftpUploadGrant('r5s-changchun-admin')).toBeUndefined();
  });
  it('rejects exposed grant files, exposed parent folders and malformed scope', () => {
    const f=make();chmodSync(f,0o644);
    expect(readLocalSftpUploadGrant('mac-mini-admin')).toBeUndefined();
    chmodSync(f,0o600);chmodSync(join(f,'..'),0o755);
    expect(readLocalSftpUploadGrant('mac-mini-admin')).toBeUndefined();
  });
  it('rejects expired approvals, overly long windows, oversized caps and path traversal', () => {
    const now=Date.now();
    make({issuedAt:new Date(now-3_600_000).toISOString(), expiresAt:new Date(now-1_000).toISOString()});
    const e=readLocalSftpUploadGrant('mac-mini-admin');
    expect(e&&hasValidSftpUploadGrant(cmd(),e)).toBe(false);
    make({issuedAt:new Date(now-5000).toISOString(),expiresAt:new Date(now+3_600_000).toISOString()});
    const over=readLocalSftpUploadGrant('mac-mini-admin');
    expect(over&&hasValidSftpUploadGrant(cmd(),over)).toBe(false);
    make({maxBytes:1_048_577});const big=readLocalSftpUploadGrant('mac-mini-admin');
    expect(big&&hasValidSftpUploadGrant(cmd(),big)).toBe(false);
    make();const ok=readLocalSftpUploadGrant('mac-mini-admin')!;
    expect(hasValidSftpUploadGrant(cmd('/Users/example/staged/../secret'),ok)).toBe(false);
    expect(hasValidSftpUploadGrant(cmd()+'; rm -rf /',ok)).toBe(false);
  });
});
