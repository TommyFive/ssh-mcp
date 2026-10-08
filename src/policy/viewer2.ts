/** Conservative opt-in Viewer2 matcher, with active probes isolated. */
import { isIP } from 'node:net';

export type Viewer2Pack = 'linux' | 'network' | 'vpn' | 'openwrt' | 'macos' | 'icmp';

const NAME = '[A-Za-z0-9_.:@-]+';
const UNIT = '[A-Za-z0-9_.@-]+';
const TARGET = '[A-Za-z0-9_.:%-]+';
const LAST = '(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)';

const matchers: Record<Viewer2Pack, readonly RegExp[]> = {
  linux: [
    /^systemctl --failed(?: --no-pager)?$/,
    /^systemctl list-timers(?: --all)? --no-pager$/,
    /^systemctl list-units(?: --all)?(?: --type=(?:service|socket|timer))? --no-pager$/,

    new RegExp('^systemctl (?:is-active|is-enabled|is-failed) ' + UNIT + '(?: ' + UNIT + '){0,9}$'),
    new RegExp('^systemctl show ' + UNIT + ' -p [A-Za-z][A-Za-z0-9]{0,80}$'),
    /^journalctl --list-boots(?: --no-pager)?$/,
    // Quoted, bounded relative periods from historical diagnostics; prohibit
    // shell metacharacters and unbounded absolute timestamp/free-form phrases.
    /^journalctl(?: -u [A-Za-z0-9_.@-]+)? --since '(?:[1-9]|1[0-9]|2[0-4]) hours? ago'(?: -p (?:warning|err|crit))? --no-pager$/,
    /^journalctl(?: -u [A-Za-z0-9_.@-]+)? --since '(?:[1-9]|[1-5][0-9]) minutes? ago'(?: -p (?:warning|err|crit))? --no-pager$/,
    /^journalctl -k -n (?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500) --no-pager$/,
    new RegExp('^journalctl -u ' + UNIT + ' --since -[1-9][0-9]{0,2}(?:min|h|d) -n ' + LAST + ' --no-pager$'),
    // No DNS resolution in the passive Linux pack: getent hosts may query the network.
    // DNS queries need separate opt-in and exact target scope.
    /^sshd -T$/,
    /^sysctl [A-Za-z0-9_.]+(?: [A-Za-z0-9_.]+){0,9}$/,
    /^hostname$/,
    /^date$/,
    /^dpkg --audit$/,
    /^lsblk -f$/,
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
    // Enumerate passive ss modes; socket-killing -K must never match.
    /^ss -(?:lntp|ltnp|lnup|lntup|tnp|ntp|unp|uapn|uapmni|tupn|s)$/,
    /^ifconfig(?: -a| [A-Za-z0-9_.:@-]+)?$/,
  ],
  // Passive packs never authorize active probing. ICMP is checked below
  // only against separately configured literal-IP targets.
  icmp: [],
  vpn: [
    new RegExp('^wg show ' + NAME + '$'),
    new RegExp('^wg show ' + NAME + ' (?:endpoints|latest-handshakes|transfer|peers)$'),
    /^tailscale (?:serve|dns) status$/,
    /^tailscale status --json$/,
  ],
  openwrt: [
    new RegExp('^iw dev ' + NAME + ' station dump$'),
    new RegExp('^brctl showmacs ' + NAME + '$'),
    /^hostname$/,
    /^logread -l (?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)$/,
    /^sysctl [A-Za-z0-9_.]+$/,
    /^mwan3 (?:status|interfaces|policies)$/,

    /^opkg list-installed$/,
    /^opkg status [A-Za-z0-9_.+:-]{1,100}$/,

  ],
  macos: [
    /^pgrep -af [A-Za-z0-9_.:-]+$/,
    /^sw_vers$/,
    /^openclaw --version$/,
    /^pmset -g(?: (?:assertions|sched|custom|cap|therm|ps|batt))?$/,
    /^scutil --nc list$/,
    /^\/Applications\/Tailscale\.app\/Contents\/MacOS\/Tailscale status(?: --json)?$/,

    /^scutil --nc status "[A-Za-z0-9_. -]{1,80}"$/,
  ],
};

/** Disallow metadata/link-local, loopback, unspecified and multicast probes. */
export function isSafeProbeTarget(target: string): boolean {
  const family = isIP(target);
  if (family === 0) return false;
  const s = target.toLowerCase();
  if (family === 4) {
    const [a, b] = s.split('.').map(Number);
    return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254);
  }
  // Canonicalize expanded IPv6 before testing special ranges. In particular,
  // 0:0:0:0:0:0:0:1 is loopback just like ::1.
  let ip: string;
  try { ip = new URL('http://[' + s + ']/').hostname.slice(1, -1); }
  catch { return false; }
  // Mapped IPv4 can conceal blocked IPv4 destinations, e.g. metadata IPs.
  if (ip.includes('ffff:')) return false;
  return ip !== '::' && ip !== '::1' && !/^fe[89ab]/.test(ip) && !ip.startsWith('ff');
}

/** No shell composition and no new active probe authorization without an
 * explicitly configured, exact literal-IP allowlist and the icmp pack. */
export function isViewer2ReadOnly(
  command: string,
  packs: readonly Viewer2Pack[],
  probeTargets: readonly string[] = [],
): boolean {
  if (typeof command !== 'string' || command.length < 1 || command.length > 5000) return false;
  if (/[;&|<>\x60$(){}\n\r\\]/.test(command)) return false;
  if (/[\x00-\x1f\x7f]/.test(command)) return false;
  if (!packs.every(p => Object.hasOwn(matchers, p))) return false;
  const active = /^ping(?: -6)? -c [1-5](?: -W [1-5])? ([A-Fa-f0-9:.]+)$/.exec(command);
  if (active) {
    const target = active[1];
    const ipv = isIP(target);
    if ((command.startsWith('ping -6 ') && ipv !== 6)
      || !packs.includes('icmp') || !isSafeProbeTarget(target)) return false;
    return probeTargets.some(allowed => isSafeProbeTarget(allowed)
      && allowed.toLowerCase() === target.toLowerCase());
  }
  return packs.some(pack => matchers[pack].some(re => re.test(command)));
}
