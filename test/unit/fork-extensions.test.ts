import { describe, expect, it } from 'vitest';
import { makeProfile } from '../fixtures/profile.js';
import type { SFTPWrapper } from 'ssh2';
import { PolicyEngine } from '../../src/policy/engine.js';
import { profileSchema } from '../../src/config/schema.js';
import { isViewer2ReadOnly } from '../../src/policy/viewer2.js';
import { isExtensionReadOnly } from '../../src/policy/legacy-readonly.js';
import { approvedSftpWorkspaceRoot } from '../../src/policy/sftp-workspace.js';
import { hasValidSftpUploadGrant } from '../../src/policy/sftp-preapproval.js';
import { assertScopedSftpPath } from '../../src/ssh/sftp.js';

const root = '/srv/example/workspace';
const target = root + '/notes.txt';
const command = (path = target, n = 4) =>
  `sftp:upload --overwrite --bytes=${n} --sha256=${'a'.repeat(32)} ${path}`;
const admin = () => makeProfile({
  name: 'example-admin', role: 'admin', group: 'dev', readOnly: false,
  approvalPolicy: 'ask-destructive',
  sftpWorkspaceWrite: { roots: [root], maxBytes: 65_536 },
});

describe('ported profile extensions', () => {
  it('does not expand the deployed 2.11 reader surface for opted-in profiles', () => {
    const engine = new PolicyEngine();
    const legacy = makeProfile({
      name: 'example-viewer', role: 'viewer', group: 'dev', readOnly: true,
      viewer2Packs: ['linux'], readOnlyExtensions: ['linux-service-diagnostics'],
    });
    for (const cmd of ['ss -tulpen', 'systemctl status sshd',
      'journalctl -u sshd --no-pager -n 10', 'ping -c 1 192.0.2.1']) {
      const result = engine.evaluate(cmd, legacy);
      expect(result.commandClass).toBe('safe');
      expect(result.decision).toBe('deny');
    }
    for (const cmd of ['ls -la /tmp', 'docker ps',
      'systemctl status sshd --no-pager']) {
      const result = engine.evaluate(cmd, legacy);
      expect(result.commandClass).toBe('read-only');
      expect(result.decision).toBe('allow');
    }
    expect(engine.evaluate('sudo reboot', legacy).decision).toBe('deny');
    expect(engine.evaluate('rm -rf /tmp/example', legacy).decision).toBe('deny');
  });


  it('is disabled by default and validates exact scoped roots', () => {
    expect(profileSchema.safeParse({ name: 'example-admin', host: 'test', user: 'tester' }).success).toBe(true);
    expect(profileSchema.safeParse({ name: 'example-admin', host: 'test', user: 'tester',
      sftpWorkspaceWrite: { roots: [root] } }).success).toBe(true);
    for (const bad of [{ roots: ['/'] }, { roots: ['/srv/../etc'] },
      { roots: [] }, { roots: [root], maxBytes: 1_048_577 }]) {
      expect(profileSchema.safeParse({ name: 'example-admin', host: 'test', user: 'tester',
        sftpWorkspaceWrite: bad }).success).toBe(false);
    }
  });

  it('honors Viewer2 and legacy packs only with a literal single command', () => {
    expect(isViewer2ReadOnly('wg show wg0', ['vpn'])).toBe(true);
    expect(isViewer2ReadOnly('wg show wg0; reboot', ['vpn'])).toBe(false);
    expect(isExtensionReadOnly('date', ['linux-system-diagnostics'])).toBe(true);
    expect(isExtensionReadOnly('date; touch /tmp/no', ['linux-system-diagnostics'])).toBe(false);
  });

  it('grants only role-bound, opt-in Admin SFTP after upstream policy gates', () => {
    const engine = new PolicyEngine();
    expect(engine.evaluate(command(), admin(),
      { remotePath: target, remoteWrite: true }).ruleId).toBe('admin-sftp-workspace-scope');
    expect(engine.evaluate(command(), admin(), {}).decision).not.toBe('allow');
    expect(engine.evaluate(command(), makeProfile({ ...admin(), role: 'viewer', readOnly: true }),
      { remotePath: target, remoteWrite: true }).decision).toBe('deny');
    expect(engine.evaluate(command(), makeProfile({ ...admin(), approvalPolicy: 'deny' }),
      { remotePath: target, remoteWrite: true }).decision).toBe('deny');
    // Upstream's hard-deny families, not a generic /etc prefix ban.
    expect(engine.evaluate(command('/etc/cron.d/demo'), admin(),
      { remotePath: '/etc/cron.d/demo', remoteWrite: true }).decision).toBe('deny');
    expect(engine.evaluate(command('/etc/passwd'), admin(),
      { remotePath: '/etc/passwd', remoteWrite: true }).decision).not.toBe('allow');
  });

  it('does not grant an ancestor, sibling, dotfile, or oversized payload', () => {
    const p = admin();
    expect(approvedSftpWorkspaceRoot(command(), p)).toBe(root);
    for (const bad of [root, root + '-other/notes.txt', root + '/.env',
      root + '/.git/config', root + '/nested/id_ed25519', root + '/../notes.txt']) {
      expect(approvedSftpWorkspaceRoot(command(bad), p)).toBeUndefined();
    }
    expect(approvedSftpWorkspaceRoot(command(target, 65_537), p)).toBeUndefined();
  });

  it('requires an exact-file, still-active, at-most-30-minute grant', () => {
    const now = Date.now();
    const grant = {
      paths: [target], issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(), maxBytes: 4096,
    };
    expect(hasValidSftpUploadGrant(command(), grant)).toBe(true);
    expect(hasValidSftpUploadGrant(command(root + '/other.txt'), grant)).toBe(false);
    expect(hasValidSftpUploadGrant(command(), { ...grant, expiresAt: new Date(now + 40 * 60_000).toISOString() })).toBe(false);
  });

  it('rejects remote symlinks and writable ancestors before SFTP upload', async () => {
    const sftp = (writable = false): SFTPWrapper => ({
      lstat: (path: string, cb: (err: Error | undefined, attrs?: {mode:number}) => void) => {
        const m: Record<string, number> = {
          '/': 0o040755, '/srv': 0o040755,
          '/srv/example': writable ? 0o040777 : 0o040700,
          '/srv/example/workspace': 0o040700, [target]: 0o100600,
        };
        if (path in m) cb(undefined, {mode: m[path]});
        else cb(Object.assign(new Error('missing'), {code:2}));
      },
    }) as unknown as SFTPWrapper;
    const limits = { maxBytes: 65_536, idleTimeoutMs: 1000 };
    await expect(assertScopedSftpPath(sftp(), root, target, limits)).resolves.toBeUndefined();
    await expect(assertScopedSftpPath(sftp(true), root, target, limits)).rejects.toThrow(/writable/);
  });
});
