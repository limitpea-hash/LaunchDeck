import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/probe.css', ['probe.css', 'text/css; charset=utf-8']],
  ['/probe.js', ['probe.js', 'text/javascript; charset=utf-8']],
  ['/protocol.js', ['protocol.js', 'text/javascript; charset=utf-8']],
]);
export function createProbeServer() {
  return createServer(async (request, response) => {
    const port = request.socket.localPort;
    if (request.headers.host !== `localhost:${port}` || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const file = files.get(request.url);
    if (!file) { response.writeHead(404); response.end('Not found'); return; }
    try {
      const data = await readFile(new URL(file[0], import.meta.url));
      response.writeHead(200, {
        'Content-Type': file[1], 'Content-Length': data.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(500); response.end('Unable to load experiment'); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createProbeServer();
  server.listen(3007, '127.0.0.1', () => console.log('分页通行密钥验证：http://localhost:3007/'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
