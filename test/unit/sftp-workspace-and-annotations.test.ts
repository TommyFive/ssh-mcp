import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SFTPWrapper } from 'ssh2';
import { profileSchema } from '../../src/config/schema.js';
import { DEFAULT_RULES, PolicyEngine } from '../../src/policy/engine.js';
import { approvedSftpWorkspaceRoot } from '../../src/policy/sftp-workspace.js';
import { assertScopedSftpPath } from '../../src/ssh/sftp.js';
import type { Profile } from '../../src/types.js';

const root = '/srv/workspace/documentation';
const cmd = (path: string, bytes = 42) =>
  `sftp:upload --overwrite --bytes=${bytes} --sha256=${'a'.repeat(32)} ${path}`;
const mkProfile = (changes: Record<string, unknown> = {}) => ({
  name: 'mac-mini-admin',
  role: 'admin', group: 'prod', readOnly: false,
  approvalPolicy: 'ask-destructive',
  readOnlyExtensions: [], viewer2Packs: [],
  sftpWorkspaceWrite: { roots: [root], maxBytes: 65_536 },
  ...changes,
}) as unknown as Profile;

describe('explicit Admin workspace upload scope', () => {
  it('has no implicit grant, and never approves Viewer or denied profiles', () => {
    expect(approvedSftpWorkspaceRoot(cmd(root + '/README.md'), mkProfile({sftpWorkspaceWrite: undefined}))).toBeUndefined();
    expect(approvedSftpWorkspaceRoot(cmd(root + '/README.md'), mkProfile({role: 'viewer', readOnly: true}))).toBeUndefined();
    expect(approvedSftpWorkspaceRoot(cmd(root + '/README.md'), mkProfile({approvalPolicy: 'deny'}))).toBeUndefined();
  });

  it('is bounded by an exact directory boundary, byte count and safe name', () => {
    expect(approvedSftpWorkspaceRoot(cmd(root + '/README.md'), mkProfile())).toBe(root);
    for (const dest of [
      root, root + '2/README.md', '/etc/passwd', root + '/../README.md',
      root + '/.git/config', root + '/.env', root + '/secrets.json',
      root + '/.ssh/authorized_keys', root + '/nested/id_ed25519',
    ]) {
      expect(approvedSftpWorkspaceRoot(cmd(dest), mkProfile()), dest).toBeUndefined();
    }
    expect(approvedSftpWorkspaceRoot(cmd(root + '/README.md', 65_537), mkProfile())).toBeUndefined();
    expect(approvedSftpWorkspaceRoot('sftp:download ' + root + '/README.md', mkProfile())).toBeUndefined();
    expect(approvedSftpWorkspaceRoot(cmd(root + '/README.md'), mkProfile({sftpWorkspaceWrite: {roots: [root], maxBytes: 1_048_577}}))).toBeUndefined();
  });

  it('allows only Admin inline SFTP via policy, leaving viewer and shell gates intact', () => {
    const policy = new PolicyEngine(DEFAULT_RULES);
    const admin = mkProfile();
    const permitted = policy.evaluate(cmd(root + '/README.md'), admin, 'sftp-upload');
    expect(permitted.decision).toBe('allow');
    expect(permitted.commandClass).toBe('destructive');
    expect(permitted.ruleId).toBe('admin-sftp-workspace-scope');
    expect(policy.evaluate(cmd('/etc/passwd'), admin, 'sftp-upload').decision).toBe('require-approval');
    expect(policy.evaluate(cmd(root + '/README.md'), admin, 'run-command').decision).not.toBe('allow');
    expect(policy.evaluate(cmd(root + '/README.md'), mkProfile({readOnly:true,role:'viewer'}), 'sftp-upload').decision).toBe('deny');
    expect(policy.evaluate(cmd(root + '/README.md'), mkProfile({approvalPolicy:'deny'}), 'sftp-upload').decision).toBe('deny');
  });

  it('accepts strict root config but rejects unbounded and malformed roots', () => {
    const base = {name:'test-admin',host:'host',user:'user',role:'admin',readOnly:false};
    expect(profileSchema.safeParse({...base,sftpWorkspaceWrite:{roots:[root]}}).success).toBe(true);
    for (const settings of [
      {roots:['/']}, {roots:['/srv/../etc']}, {roots:[]},
      {roots:[root],maxBytes:1_048_577}, {roots:[root],extra:true},
    ]) expect(profileSchema.safeParse({...base,sftpWorkspaceWrite:settings}).success).toBe(false);
  });
});

const DIR = 0o040700;
const FILE = 0o100600;
const LINK = 0o120777;
const statuses = (modes: Record<string,number>): SFTPWrapper => ({
  lstat: (path: string, cb: (err: Error | undefined, attributes?: {mode:number}) => void) => {
    if (path in modes) cb(undefined, {mode:modes[path]});
    else Object.assign(new Error('missing'), {code:2}) satisfies Error;
    // Unknown intermediate components must not be assumed safe.
    if (!(path in modes)) cb(Object.assign(new Error('missing'), {code:2}));
  },
}) as unknown as SFTPWrapper;

const safe = {
  '/': DIR, '/srv': 0o040755, '/srv/workspace': DIR,
  '/srv/workspace/documentation': DIR,
  '/srv/workspace/documentation/README.md': FILE,
};
const opts = {maxBytes: 65536, idleTimeoutMs: 1000};

describe('remote scoped SFTP write protection', () => {
  it('accepts owner-only ancestors and a regular existing or new file', async () => {
    await expect(assertScopedSftpPath(statuses(safe),root,root+'/README.md',opts)).resolves.toBeUndefined();
    await expect(assertScopedSftpPath(statuses({...safe,[root+'/README.md']:undefined} as Record<string,number>),root,root+'/README.md',opts)).rejects.toThrow();
    const withoutFile = {...safe}; delete (withoutFile as Record<string,number>)[root+'/README.md'];
    await expect(assertScopedSftpPath(statuses(withoutFile),root,root+'/new.md',opts)).resolves.toBeUndefined();
  });
  it('refuses symlinks, other-writable ancestors, devices and escape paths', async () => {
    for (const modes of [
      {...safe, '/srv/workspace': LINK},
      {...safe, '/srv/workspace': 0o040777},
      {...safe, [root+'/README.md']: LINK},
      {...safe, [root+'/README.md']: 0o020600},
    ]) await expect(assertScopedSftpPath(statuses(modes),root,root+'/README.md',opts)).rejects.toThrow();
    await expect(assertScopedSftpPath(statuses(safe),root,root+'2/README.md',opts)).rejects.toThrow();
  });
});

describe('MCP risk annotation coverage', () => {
  it('labels all 15 tools consistently with explicit readOnly/destructive/openWorld hints', () => {
    const paths = ['command-tools','session-tools','file-tools','transfer-tools','viewer2-batch-tool'];
    const source = paths.map(p=>readFileSync(new URL(`../../src/tools/${p}.ts`, import.meta.url), 'utf8')).join('\n');
    expect((source.match(/server\.tool\(/g) ?? []).length).toBe(15);
    expect((source.match(/\{ readOnlyHint: (?:true|false), destructiveHint: (?:true|false), openWorldHint: (?:true|false) \}/g) ?? []).length).toBe(15);
    expect(source).toContain("'sftp-upload'");
    expect(source).toContain("{ readOnlyHint: false, destructiveHint: true, openWorldHint: true }");
  });
});
