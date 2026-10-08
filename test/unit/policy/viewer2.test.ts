import { describe, expect, it } from 'vitest';
import { isViewer2ReadOnly, isSafeProbeTarget } from '../../../src/policy/viewer2.js';

describe('Viewer2 staged matcher (not yet activated)', () => {
  const positive: [string, readonly ('linux' | 'network' | 'vpn' | 'openwrt' | 'macos' | 'icmp')[]][] = [
    ['wg show wg0', ['vpn']],
    ['wg show wg0 endpoints', ['vpn']],
    ['tailscale serve status', ['vpn']],
    ['tailscale dns status', ['vpn']],
    ['systemctl --failed --no-pager', ['linux']],
    ['systemctl is-active sing-box tailscaled', ['linux']],
    ['journalctl -u sing-box --since -6h -n 100 --no-pager', ['linux']],
    ["journalctl -u sing-box --since '24 hours ago' --no-pager", ['linux']],
    ["journalctl -u tailscaled.service --since '6 hours ago' -p warning --no-pager", ['linux']],
    ["journalctl --since '6 hours ago' -p warning --no-pager", ['linux']],
    ["journalctl -u ssh --since '10 minutes ago' --no-pager", ['linux']],
    ['journalctl -k -n 250 --no-pager', ['linux']],
    ['journalctl --list-boots', ['linux']],
    ['hostname', ['openwrt']],
    ['mwan3 status', ['openwrt']],
    ['logread -l 250', ['openwrt']],
    ['opkg list-installed', ['openwrt']],
    ['sysctl net.ipv4.ip_forward', ['openwrt']],
    ['pmset -g assertions', ['macos']],
    ['scutil --nc status "My VPN"', ['macos']],
    ['getent ahostsv4 example.org', ['linux']],
    ['ip -d link show eth0', ['network']],
    ['ip route show table all', ['network']],
    ['nft -a list ruleset', ['network']],
    ['nft list set inet passwall2 psw2_direct', ['network']],
    ['ss -lntp', ['network']],
    ['ss -uapmni', ['network']],
    ['ss -tnp', ['network']],
    ['hostname', ['linux']],
    ['date', ['linux']],
    ['ifconfig eth0', ['network']],
    ['tailscale status --json', ['vpn']],
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
    'ss -K dst 1.1.1.1',
    'ping -c 999 1.1.1.1',
    'ping -c 1 1.1.1.1; reboot',
    'ifconfig eth0 down',
    'tailscale down',
    'wg showconf wg0',
    'wg show wg0 dump',
    'wg show wg0; touch /tmp/pwn',
    'wg show wg0 && reboot',
    'wg show $(touch /tmp/pwn)',
    'wg show wg0 | sh',
    'wg show wg0 > /tmp/log',
    'wg show wg0\nreboot',
    'nft list ruleset; sudo id',
    "journalctl --since '99 hours ago' --no-pager",
    "journalctl --since '24 hours ago' --output=cat --no-pager",
    "journalctl -u sing-box --since '24 hours ago' -p emerg --no-pager",
    'logread -l 501',
    'sysctl -w net.ipv4.ip_forward=1',
    'opkg install dropbear',
    'scutil --nc start VPN',
    'pmset -a sleep 0',
  ];
  for (const cmd of negative) {
    it('rejects unsafe form: ' + cmd.replaceAll('\n', '[newline]'), () => {
      expect(isViewer2ReadOnly(cmd, ['linux', 'network', 'vpn', 'openwrt', 'macos'])).toBe(false);
    });
  }
  it('rejects unknown packs rather than throwing or widening privileges', () => {
    expect(isViewer2ReadOnly('wg show wg0', ['vpn', 'bogus' as never])).toBe(false);
  });
  it('requires BOTH the icmp pack and exact permitted IP (never DNS names)', () => {
    expect(isViewer2ReadOnly('ping -c 3 -W 2 1.1.1.1', ['network'])).toBe(false);
    expect(isViewer2ReadOnly('ping -c 3 -W 2 1.1.1.1', ['network', 'icmp'])).toBe(false);
    expect(isViewer2ReadOnly('ping -c 3 -W 2 1.1.1.1', ['icmp'], ['1.1.1.1'])).toBe(true);
    expect(isViewer2ReadOnly('ping -6 -c 2 -W 1 2606:4700:4700::1111', ['icmp'], ['2606:4700:4700::1111'])).toBe(true);
    expect(isViewer2ReadOnly('ping -c 1 example.com', ['icmp'], ['example.com'])).toBe(false);
    expect(isViewer2ReadOnly('ping -c 1 169.254.169.254', ['icmp'], ['169.254.169.254'])).toBe(false);
    expect(isViewer2ReadOnly('ping -c 1 127.0.0.1', ['icmp'], ['127.0.0.1'])).toBe(false);
    expect(isViewer2ReadOnly('ping -c 1 10.1.2.3', ['icmp'], ['10.1.2.3'])).toBe(true);
    expect(isViewer2ReadOnly('ping -c 1 10.1.2.4', ['icmp'], ['10.1.2.3'])).toBe(false);
    expect(isViewer2ReadOnly('ping -6 -c 1 1.1.1.1', ['icmp'], ['1.1.1.1'])).toBe(false);
  });
  it('refuses loopback, link-local, metadata, multicast and mapped addresses', () => {
    for(const ip of ['127.0.0.1','0.0.0.0','169.254.169.254','224.0.0.1',
                     '0:0:0:0:0:0:0:1','0:0:0:0:0:0:0:0',
                     'FE80:0000:0000:0000:0000:0000:0000:0001',
                     '255.255.255.255','::','::1','fe80::1','ff02::1','::ffff:169.254.169.254']) {
      expect(isSafeProbeTarget(ip)).toBe(false);
    }
    for(const ip of ['1.1.1.1','10.1.2.3','172.16.1.1','2001:db8::1','fd00::1']) {
      expect(isSafeProbeTarget(ip)).toBe(true);
    }
  });
  it('is opt-in and grants nothing by default', () => {
    expect(isViewer2ReadOnly('wg show wg0', [])).toBe(false);
  });
});
