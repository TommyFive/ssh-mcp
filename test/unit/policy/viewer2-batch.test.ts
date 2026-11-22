import { describe, expect, it } from 'vitest';
import { planViewer2Batch } from '../../../src/policy/viewer2-batch.js';

describe('Viewer2 batch planner (no command execution)', () => {
  it('evaluates each element independently', () => {
    const result = planViewer2Batch([
      ['wg','show','wg0'],
      ['systemctl','restart','sing-box'],
      ['ip','route','show','table','all'],
    ], ['vpn','linux','network']);
    expect(result.map(x => x.authorized)).toEqual([true,false,true]);
    expect(result[1].command).toBeNull();
    expect(result[0].command).toBe('wg show wg0');
  });
  it('rejects shell separators and whitespace in argv', () => {
    const r = planViewer2Batch([
      ['wg','show','wg0;','reboot'],
      ['wg','show','$(touch /tmp/pwn)'],
      ['wg','show','wg0 && reboot'],
    ], ['vpn']);
    expect(r.every(x => !x.authorized && x.command === null)).toBe(true);
  });
  it('never authorizes without explicit pack and limits batch sizes', () => {
    expect(planViewer2Batch([['wg','show','wg0']], [])[0].authorized).toBe(false);
    expect(() => planViewer2Batch([], ['vpn'])).toThrow();
    expect(() => planViewer2Batch(Array.from({length:17},()=>['wg','show']), ['vpn'])).toThrow();
  });
});
