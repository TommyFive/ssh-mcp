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
  it('keeps legacy Linux/ASUS reads while refusing their mutating siblings', () => {
    expect(classifyCommand('hostname', ['linux-system-diagnostics']).class).toBe('read-only');
    expect(classifyCommand('systemd-analyze time', ['linux-system-diagnostics']).class).toBe('read-only');
    expect(classifyCommand('nvram get lan_ipaddr', ['asus-merlin-diagnostics']).class).toBe('read-only');
    expect(classifyCommand('nvram set lan_ipaddr=192.0.2.1', ['asus-merlin-diagnostics']).class).not.toBe('read-only');
  });
});
