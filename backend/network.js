import { networkInterfaces } from 'node:os';

export function getLocalIPv4Addresses() {
  return [...new Set(Object.values(networkInterfaces()).flatMap(entries =>
    entries.filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address)
  ))];
}

export function getAllowedHosts() {
  return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', ...getLocalIPv4Addresses()];
}
