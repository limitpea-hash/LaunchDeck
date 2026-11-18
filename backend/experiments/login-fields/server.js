import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const files = new Map([['/', ['index.html', 'text/html']], ['/probe.css', ['probe.css', 'text/css']],
  ['/probe.js', ['probe.js', 'text/javascript']], ['/codec.js', ['codec.js', 'text/javascript']]]);
export function createLoginProbeServer() {
  return createServer(async (req, res) => {
    if (req.headers.host !== `localhost:${req.socket.localPort}` || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const file = files.get(req.url);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const body = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500); res.end('Unable to load experiment'); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createLoginProbeServer();
  server.listen(3008, '127.0.0.1', () => console.log('字段恢复验证：http://localhost:3008/'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
