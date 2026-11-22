#!/usr/bin/env node
/**
 * Operator-only out-of-band, 30-minute, EXACT-FILE SFTP grant.
 * Run in an independent interactive Mac mini terminal, never through SSH-MCP.
 * A separate file is used so the rollback-compatible config.toml stays intact.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { statSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [profile, remotePath, byteLimit = '65536'] = process.argv.slice(2);
const file = join(homedir(), '.config', 'ssh-mcp', 'admin-sftp-grant.json');
const dir = join(homedir(), '.config', 'ssh-mcp');
const validPath = typeof remotePath === 'string'
  && /^\/(?:[A-Za-z0-9_@+.-]+\/)*[A-Za-z0-9_@+.-]+$/.test(remotePath)
  && remotePath.split('/').every(p => p !== '.' && p !== '..');
const cap = Number(byteLimit);
if (!stdin.isTTY || !stdout.isTTY) {
  console.error('REFUSED: requires an independent interactive operator terminal.');
  process.exit(2);
}
if (!/^[A-Za-z0-9_.-]{1,80}-admin$/.test(profile || '') ||
    !validPath || !Number.isSafeInteger(cap) || cap < 1 || cap > 1_048_576) {
  console.error('Usage: node grant-admin-sftp.mjs <admin-profile> <exact-absolute-file> [max-bytes<=1048576]');
  process.exit(2);
}
const st = statSync(dir);
if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) {
  console.error('REFUSED: ~/.config/ssh-mcp must be owner-owned and mode 0700.');
  process.exit(2);
}
const rl = createInterface({input: stdin, output: stdout});
console.log('Grant SFTP upload on '+profile+' to this EXACT file: '+remotePath);
console.log('Maximum '+cap+' bytes. Automatic expiry in 30 minutes.');
console.log('This is a standing authorization within the time window, NOT per-call 2FA.');
try {
  const confirmation = await rl.question('Type APPROVE-30M-SFTP to authorize: ');
  if (confirmation !== 'APPROVE-30M-SFTP') {
    console.log('No grant issued.');
    process.exit(2);
  }
} finally { rl.close(); }
const now = Date.now();
const grant = {
  version: 1, profile, paths:[remotePath], maxBytes: cap,
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 30*60_000).toISOString(),
};
const tmp = dir + '/.admin-sftp-grant-' + randomUUID();
writeFileSync(tmp, JSON.stringify(grant)+'\n', {mode:0o600,flag:'wx'});
renameSync(tmp,file);
console.log('Grant issued to '+profile+' until '+grant.expiresAt+'. No service restart required.');
