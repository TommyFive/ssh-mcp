import { describe, expect, it } from 'vitest';
import { profileSchema } from '../../../src/config/schema.js';
import { classifyCommand } from '../../../src/policy/classifier.js';

describe('Out-of-band SFTP approval configuration', () => {
  const input = { name: 'mac-mini-admin', host: 'localhost', user: 'rentamac',
    role: 'admin', readOnly: false };
  const now = Date.now();
  const issuedAt = new Date(now - 60_000).toISOString();
  const expiresAt = new Date(now + 10 * 60_000).toISOString();
  it('accepts exact absolute paths and defaults byte bound', () => {
    const p = profileSchema.parse({ ...input, sftpUploadPreapproval: {
      paths: ['/Users/rentamac/.cache/staging/payload.mjs'], issuedAt, expiresAt,
    } });
    expect(p.sftpUploadPreapproval?.maxBytes).toBe(65536);
    expect(p.sftpUploadPreapproval?.paths).toEqual(['/Users/rentamac/.cache/staging/payload.mjs']);
  });
  it('denies directory prefixes, relative paths, dot segments, globs and extended grant windows', () => {
    for(const path of [
      '../payload.mjs', '/Users/x/../secret', '/Users/x/./secret',
      '/Users/x//file', '/Users/x/*', '/Users/x/', '/Users/x/file name',
    ]) {
      expect(() => profileSchema.parse({ ...input, sftpUploadPreapproval: {
        paths: [path], issuedAt, expiresAt,
      } })).toThrow();
    }
    expect(() => profileSchema.parse({ ...input, sftpUploadPreapproval: {
      paths: ['/tmp/file'], issuedAt,
      expiresAt: new Date(now + 31 * 60_000).toISOString(),
    } })).toThrow();
    expect(() => profileSchema.parse({ ...input, sftpUploadPreapproval: {
      paths: ['/tmp/file'], issuedAt, expiresAt, maxBytes: 100_000_000,
    } })).toThrow();
  });
});

describe('Viewer2 production-profile compatibility', () => {
  it('accepts existing legacy diagnostic extensions and empty Viewer2 opt-in', () => {
    const p = profileSchema.parse({
      name: 'example-viewer', host: 'example.invalid', user: 'viewer',
      role: 'viewer', readOnly: true,
      readOnlyExtensions: ['linux-system-diagnostics', 'asus-merlin-diagnostics'],
    });
    expect(p.readOnlyExtensions).toEqual(['linux-system-diagnostics', 'asus-merlin-diagnostics']);
    expect(p.viewer2Packs).toEqual([]);
  });
  it('rejects invalid opt-in packs before starting SSH-MCP', () => {
    expect(() => profileSchema.parse({
      name: 'example-viewer', host: 'example.invalid', user: 'viewer',
      viewer2Packs: ['all-commands'],
    })).toThrow();
  });
  it('accepts only explicitly allowed literal IPs and keeps probes disabled', () => {
    const input = { name: 'example-viewer', host: 'example.invalid', user: 'viewer',
      role: 'viewer', readOnly: true, viewer2Packs: ['icmp'],
      viewer2ProbeTargets: ['1.1.1.1', 'fd00::1'] };
    const p = profileSchema.parse(input);
    expect(p.viewer2Packs).toEqual(['icmp']);
    expect(p.viewer2ProbeTargets).toEqual(['1.1.1.1', 'fd00::1']);
    expect(profileSchema.parse({ ...input, viewer2ProbeTargets: [] }).viewer2ProbeTargets).toEqual([]);
    for (const disallowed of ['localhost','169.254.169.254','127.0.0.1','::ffff:169.254.169.254','fe80::1']) {
      expect(() => profileSchema.parse({ ...input, viewer2ProbeTargets: [disallowed] })).toThrow();
    }
    expect(() => profileSchema.parse({
      ...input, viewer2ProbeTargets: Array.from({ length: 33 }, (_, i) => '10.0.0.' + (i + 1)),
    })).toThrow();
  });
  it('keeps legacy Linux/ASUS reads while refusing their mutating siblings', () => {
    expect(classifyCommand('hostname', ['linux-system-diagnostics']).class).toBe('read-only');
    expect(classifyCommand('systemd-analyze time', ['linux-system-diagnostics']).class).toBe('read-only');
    expect(classifyCommand('nvram get lan_ipaddr', ['asus-merlin-diagnostics']).class).toBe('read-only');
    expect(classifyCommand('nvram set lan_ipaddr=192.0.2.1', ['asus-merlin-diagnostics']).class).not.toBe('read-only');
  });
});
