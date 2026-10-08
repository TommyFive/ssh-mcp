/**
 * Experimental Viewer 2.0 matcher. Deliberately NOT wired into production
 * policy: current profiles retain exactly their existing rights.
 */
export type Viewer2Pack = 'linux' | 'network' | 'vpn' | 'openwrt' | 'macos';

const NAME = '[A-Za-z0-9_.:@-]+';
const UNIT = '[A-Za-z0-9_.@-]+';
const TARGET = '[A-Za-z0-9_.:%-]+';
const LAST = '(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)';

const matchers: Record<Viewer2Pack, readonly RegExp[]> = {
  linux: [
    /^systemctl --failed(?: --no-pager)?$/,
    /^systemctl list-timers(?: --all)? --no-pager$/,
    new RegExp('^systemctl (?:is-active|is-enabled|is-failed) ' + UNIT + '(?: ' + UNIT + '){0,9}$'),
    new RegExp('^systemctl show ' + UNIT + ' -p [A-Za-z][A-Za-z0-9]{0,80}$'),
    /^journalctl --list-boots --no-pager$/,
    new RegExp('^journalctl -u ' + UNIT + ' --since -[1-9][0-9]{0,2}(?:min|h|d) -n ' + LAST + ' --no-pager$'),
    new RegExp('^getent (?:hosts|ahostsv4|ahostsv6) ' + TARGET + '$'),
    /^sshd -T$/,
    /^sysctl [A-Za-z0-9_.]+(?: [A-Za-z0-9_.]+){0,9}$/,
    /^hostname$/,
    /^date$/,
    /^dpkg --audit$/,
    /^apt-mark showhold$/,
    /^apt-cache policy [A-Za-z0-9_.+:-]+$/,
  ],
  network: [
    new RegExp('^ip -d link show(?: ' + NAME + ')?$'),
    /^ip -o link show$/,
    /^ip(?: -[46])? route show table all$/,
    new RegExp('^ip -[46] route get ' + TARGET + '$'),
    new RegExp('^ip addr show ' + NAME + '$'),
    /^nft -a list ruleset$/,
    /^nft (?:-a )?list (?:chain|set|map) (?:inet|ip|ip6|bridge|arp|netdev) [A-Za-z0-9_.:-]+ [A-Za-z0-9_.:-]+$/,
    new RegExp('^ethtool -(?:S|k|i) ' + NAME + '$'),
    // Enumerate passive ss modes: -K and other socket-mutating flags are absent.
    /^ss -(?:lntp|ltnp|lnup|lntup|tnp|ntp|unp|uapn|uapmni|tupn|s)$/,
    // Bound active ICMP tests to 1-5 packets / at most 5 s per response.
    new RegExp('^ping(?: -6)? -c [1-5](?: -W [1-5])? ' + TARGET + '
  ],
  vpn: [
    new RegExp('^wg show ' + NAME + '$'),
    new RegExp('^wg show ' + NAME + ' (?:endpoints|latest-handshakes|transfer|peers)$'),
    /^tailscale (?:serve|dns) status$/,
    /^tailscale status --json$/,
  ],
  openwrt: [
    new RegExp('^iw dev ' + NAME + ' station dump$'),
    new RegExp('^brctl showmacs ' + NAME + '$'),
  ],
  macos: [
    /^pgrep -af [A-Za-z0-9_.:-]+$/,
    /^sw_vers$/,
    /^openclaw --version$/,
  ],
};

/** Exact, literal single-command only; no shell-control operators. */
export function isViewer2ReadOnly(command: string, packs: readonly Viewer2Pack[]): boolean {
  if (typeof command !== 'string' || command.length < 1 || command.length > 5000) return false;
  if (/[;&|<>\x60$(){}\n\r\\]/.test(command)) return false;
  if (/[\x00-\x1f\x7f]/.test(command)) return false;
  return packs.every(p => Object.hasOwn(matchers, p))
    && packs.some(pack => matchers[pack].some(re => re.test(command)));
}
),
    /^ifconfig(?: -a| [A-Za-z0-9_.:@-]+)?$/,
  ],
  vpn: [
    new RegExp('^wg show ' + NAME + '$'),
    new RegExp('^wg show ' + NAME + ' (?:endpoints|latest-handshakes|transfer|peers)$'),
    /^tailscale (?:serve|dns) status$/,
  ],
  openwrt: [
    new RegExp('^iw dev ' + NAME + ' station dump$'),
    new RegExp('^brctl showmacs ' + NAME + '$'),
  ],
  macos: [
    /^pgrep -af [A-Za-z0-9_.:-]+$/,
    /^sw_vers$/,
    /^openclaw --version$/,
  ],
};

/** Exact, literal single-command only; no shell-control operators. */
export function isViewer2ReadOnly(command: string, packs: readonly Viewer2Pack[]): boolean {
  if (typeof command !== 'string' || command.length < 1 || command.length > 5000) return false;
  if (/[;&|<>\x60$(){}\n\r\\]/.test(command)) return false;
  if (/[\x00-\x1f\x7f]/.test(command)) return false;
  return packs.every(p => Object.hasOwn(matchers, p))
    && packs.some(pack => matchers[pack].some(re => re.test(command)));
}
