import { describe, expect, it } from 'vitest';
import { profileSchema } from '../../../src/config/schema.js';
import { classifyCommand } from '../../../src/policy/classifier.js';

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
