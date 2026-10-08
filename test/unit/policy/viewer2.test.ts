import { describe, expect, it } from 'vitest';
import { isViewer2ReadOnly } from '../../../src/policy/viewer2.js';

describe('Viewer2 staged matcher (not yet activated)', () => {
  const positive: [string, readonly ('linux' | 'network' | 'vpn' | 'openwrt' | 'macos')[]][] = [
    ['wg show wg0', ['vpn']],
    ['wg show wg0 endpoints', ['vpn']],
    ['tailscale serve status', ['vpn']],
    ['tailscale dns status', ['vpn']],
    ['systemctl --failed --no-pager', ['linux']],
    ['systemctl is-active sing-box tailscaled', ['linux']],
    ['journalctl -u sing-box --since -6h -n 100 --no-pager', ['linux']],
    ['getent ahostsv4 example.org', ['linux']],
    ['ip -d link show eth0', ['network']],
    ['ip route show table all', ['network']],
    ['nft -a list ruleset', ['network']],
    ['nft list set inet passwall2 psw2_direct', ['network']],
    ['ss -lntp', ['network']],
    ['iw dev wlan0 station dump', ['openwrt']],
    ['brctl showmacs br-lan', ['openwrt']],
    ['pgrep -af ssh-mcp', ['macos']],
    ['sw_vers', ['macos']],
    ['openclaw --version', ['macos']],
  ];
  for (const [cmd, packs] of positive) {
    it('accepts single diagnostic: ' + cmd, () => {
      expect(isViewer2ReadOnly(cmd, packs)).toBe(true);
    });
  }
  const negative = [
    'systemctl restart sing-box',
    'nft add rule inet filter input accept',
    'ip route add default via 1.1.1.1',
    'tailscale down',
    'tailscale serve --bg 3000',
    'wg set wg0',
    'wg showconf wg0',
    'wg show wg0 dump',
    'wg show wg0; touch /tmp/pwn',
    'wg show wg0 && reboot',
    'wg show $(touch /tmp/pwn)',
    'wg show wg0 | sh',
    'wg show wg0 > /tmp/log',
    'wg show wg0\nreboot',
    'nft list ruleset; sudo id',
  ];
  for (const cmd of negative) {
    it('rejects unsafe form: ' + cmd.replaceAll('\n', '[newline]'), () => {
      expect(isViewer2ReadOnly(cmd, ['linux', 'network', 'vpn', 'openwrt', 'macos'])).toBe(false);
    });
  }
  it('rejects unknown packs rather than throwing or widening privileges', () => {
    expect(isViewer2ReadOnly('wg show wg0', ['vpn', 'bogus' as never])).toBe(false);
  });
  it('is opt-in and grants nothing by default', () => {
    expect(isViewer2ReadOnly('wg show wg0', [])).toBe(false);
  });
});
