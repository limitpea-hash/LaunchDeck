import { networkInterfaces } from 'node:os';

export function getLocalIPv4Addresses() {
  return [...new Set(Object.values(networkInterfaces()).flatMap(entries =>
    entries.filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address)
  ))];
}

const hostnameLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseAllowedHosts(raw = '') {
  const hosts = new Set();
  for (const item of raw.split(/[,\s]+/).filter(Boolean)) {
    const host = item.toLowerCase();
    const hostname = URL.parse(`http://${host}`)?.hostname;
    const dnsName = host.replace(/\.$/, '');
    const isBracketedIPv6 = /^\[[0-9a-f:.]+\]$/.test(host);
    const isBareHostname = hostname === host && dnsName.length <= 253 &&
      dnsName.split('.').every(label => hostnameLabel.test(label));
    if (!hostname || (!isBracketedIPv6 && !isBareHostname)) {
      throw new Error(`ALLOWED_HOSTS 中的 ${JSON.stringify(item)} 无效。请填写主机名、IPv4 或带方括号的 IPv6，不能包含协议、端口或路径。`);
    }
    hosts.add(hostname);
  }
  return [...hosts];
}

export function getAllowedHosts(extra = process.env.ALLOWED_HOSTS) {
  return [...new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0',
    ...getLocalIPv4Addresses(), ...parseAllowedHosts(extra)])];
}
