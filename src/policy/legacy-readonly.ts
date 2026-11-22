import type { ReadOnlyExtension } from '../types.js';

// Imported literal-command allowlists from the existing fork. Never grant a
// class higher than 'safe', and only after upstream's mandatory deny checks.
const SHELL_CONTROL_CHARS = /[;&|<>`$(){}\n\r]/;
const READ_ONLY_EXTENSION_MATCHERS: Record<ReadOnlyExtension, readonly RegExp[]> = {
  'openwrt-diagnostics': [/^lsusb(?: -t)?$/, /^dmesg(?: -T)?$/, /^logread$/, /^mwan3 (?:status|interfaces)$/,
    /^ifstatus [A-Za-z0-9_.-]+$/, /^ubus call (?:system board|system info|network\.wireless status|network\.interface dump|network\.interface\.[A-Za-z0-9_.-]+ status|service list)$/,
    /^uci (?:show|get)(?: [A-Za-z0-9_@./-]+)?$/, /^ip(?: -[46])? (?:-brief|-br) (?:link|addr)$/,
    /^ip(?: -[46])? (?:addr|route|rule|neigh)(?: (?:show|list))?$/, /^ethtool [A-Za-z0-9_.:-]+$/,
    /^iw dev$/, /^iwinfo(?: [A-Za-z0-9_.:-]+ info)?$/, /^opkg list-installed$/, /^mount$/, /^wg show$/,
    /^block info$/, /^nft list ruleset$/, /^ip(?:6)?tables (?:-S|-L -n -v)$/],
  'tailscale-diagnostics': [/^tailscale (?:status|netcheck)$/],
  'linux-network-diagnostics': [/^ip(?: -[46])? (?:-brief|-br) (?:link|addr)$/,
    /^ip(?: -[46])? (?:addr|route|rule|neigh)(?: (?:show|list))?$/, /^ss -lntup$/, /^nft list ruleset$/, /^ip(?:6)?tables (?:-S|-L -n -v)$/],
  'linux-service-diagnostics': [/^systemctl (?:is-active|is-enabled|is-failed) [A-Za-z0-9_.@-]+$/, /^systemctl (?:list-units|list-timers)$/,
    /^systemctl status [A-Za-z0-9_.@-]+ --no-pager$/, /^systemctl show [A-Za-z0-9_.@-]+ --property=(?:ActiveState|SubState|MainPID|ExecMainStatus)$/,
    /^journalctl --disk-usage$/, /^journalctl -u [A-Za-z0-9_.@-]+ -n (?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500) --no-pager$/,
    /^fail2ban-client status(?: [A-Za-z0-9_.-]+)?$/, /^docker (?:ps|images)$/, /^docker inspect [A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/,
    /^docker logs --tail (?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500) --no-color [A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, /^docker stats --no-stream$/],
  'linux-storage-diagnostics': [/^mount$/, /^findmnt(?: --json|-rn)$/, /^lsblk --json --output NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS$/],
  'linux-login-diagnostics': [/^last reboot$/, /^last -n (?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/, /^lastlog$/],
  'linux-process-diagnostics': [/^dmesg(?: -T)?$/, /^lsof -nP -i(?:TCP)?(?: -sTCP:LISTEN)?$/],
  // Backward-compatible packs from the deployed SSH-MCP 2.2.5 fork.
  // Keep these explicit and behind the existing SHELL_CONTROL_CHARS gate.
  'linux-system-diagnostics': [
        /^date$/,
        /^hostname$/,
        /^sysctl (?:-a|-n [A-Za-z0-9_.]+|[A-Za-z0-9_.]+)$/,
        /^hostnamectl$/,
        /^timedatectl(?: show)?$/,
        /^resolvectl (?:status|statistics)$/,
        /^lsmod$/,
        /^modinfo [A-Za-z0-9_.-]+$/,
        /^systemd-analyze (?:time|blame|critical-chain)$/,
        /^dpkg -l$/,
        /^dpkg-query -W(?: [A-Za-z0-9_.+:-]+)?$/,
        /^sed -n [0-9]+(?:,[0-9]+)?p [A-Za-z0-9_./@%+,:=~-]+$/,
    ],
  'asus-merlin-diagnostics': [
        /^ifconfig(?: -a| [A-Za-z0-9_.:-]+)?$/,
        /^route -n$/,
        /^netstat -rn$/,
        /^sysctl (?:-a|-n [A-Za-z0-9_.]+|[A-Za-z0-9_.]+)$/,
        /^brctl show$/,
        /^nvram get [A-Za-z0-9_.:-]+$/,
        /^wl -i [A-Za-z0-9_.:-]+ (?:status|assoclist)$/,
        /^robocfg show$/,
        /^cru l$/,
        /^ip(?:6)?tables(?: -t (?:filter|nat|mangle|raw))? (?:-S(?: [A-Za-z0-9_.:-]+)?|-L(?: [A-Za-z0-9_.:-]+)? -n -v)$/,
        /^ip(?:6)?tables-save$/,
        /^sed -n [0-9]+(?:,[0-9]+)?p [A-Za-z0-9_./@%+,:=~-]+$/,
    ],
  'singbox-diagnostics': [/^sing-box version$/, /^sing-box check -c \/etc\/sing-box\/config\.json$/],
  'macos-network-diagnostics': [/^scutil --(?:dns|proxy|nwi)$/, /^scutil --get (?:ComputerName|HostName|LocalHostName)$/,
    /^networksetup (?:-listallhardwareports|-listallnetworkservices)$/, /^networksetup -(?:getinfo|getdnsservers|getwebproxy|getsecurewebproxy|getautoproxyurl|getairportnetwork|getnetworkserviceenabled) [A-Za-z0-9_.-]+$/,
    /^ifconfig(?: -a|-l| [A-Za-z0-9_.:-]+)?$/, /^route -n get [A-Za-z0-9_.:-]+$/],
  'macos-system-diagnostics': [/^sw_vers(?: -(?:productName|productVersion|buildVersion))?$/, /^hostname$/, /^date$/, /^launchctl list$/,
    /^launchctl print (?:system|gui\/501)\/[A-Za-z0-9_.-]+$/, /^defaults read(?: [A-Za-z0-9_./~-]+(?: [A-Za-z0-9_.-]+)?)?$/,
    /^sysctl (?:-a|-n [A-Za-z0-9_.]+|[A-Za-z0-9_.]+)$/, /^mount$/, /^lsof(?: -nP -i(?:TCP|UDP)?(?: -sTCP:LISTEN)?|-p [0-9]+)?$/,
    /^\/usr\/bin\/log show --last [1-9][0-9]{0,3}[smhd](?: --style (?:compact|syslog|json))?$/, /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js --version$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js status(?: --(?:all|json|usage|verbose|debug|deep)| --timeout [0-9]{1,6})*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js health(?: --(?:json|verbose|debug)| --timeout [0-9]{1,6})*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js sessions(?: list)?(?: --(?:all-agents|json|verbose)| --active [0-9]{1,6}| --agent [A-Za-z0-9_.-]+| --limit (?:all|[0-9]{1,5}))*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js models (?:status|list)(?: --(?:json|plain|all|local|check|probe)| --agent [A-Za-z0-9_.-]+| --provider [A-Za-z0-9_.-]+| --probe-(?:concurrency|max-tokens|timeout) [0-9]{1,7}| --probe-(?:profile|provider) [A-Za-z0-9_.@,-]+)*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js gateway (?:status|health|probe)(?: --(?:deep|json|no-probe|require-rpc|expect-final|ssh-auto)| --(?:port|timeout) [0-9]{1,6})*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js gateway stability(?: --(?:json|expect-final)| --(?:limit|since-seq|timeout|port) [0-9]{1,8}| --type [A-Za-z0-9_.-]+)*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js gateway usage-cost(?: --(?:json|expect-final|all-agents)| --(?:days|port|timeout) [0-9]{1,6}| --agent [A-Za-z0-9_.-]+)*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js channels status(?: --(?:json|probe)| --channel [A-Za-z0-9_.-]+| --timeout [0-9]{1,6})*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js plugins list(?: --(?:enabled|json|verbose))*$/,
    /^\/opt\/homebrew\/opt\/node@24\/bin\/node \/opt\/homebrew\/lib\/node_modules\/openclaw\/dist\/index\.js skills list(?: --(?:eligible|json|verbose)| -v| --agent [A-Za-z0-9_.-]+)*$/,
    /^diskutil list$/, /^diskutil apfs list$/, /^diskutil info disk[0-9]+(?:s[0-9]+)?$/, /^tmutil (?:status|destinationinfo)$/,
    /^pmset -g$/, /^ioreg -l$/, /^system_profiler SP[A-Za-z0-9]+DataType$/, /^softwareupdate --history$/, /^fdesetup status$/,
    /^csrutil status$/, /^spctl --status$/, /^profiles status -type enrollment$/, /^systemextensionsctl list$/, /^kmutil showloaded$/, /^mdutil -s \/$/],
};

export function isExtensionReadOnly(command: string, extensions: readonly ReadOnlyExtension[]): boolean {
  return !SHELL_CONTROL_CHARS.test(command)
    && extensions.some((extension) => READ_ONLY_EXTENSION_MATCHERS[extension].some((matcher) => matcher.test(command)));
}
