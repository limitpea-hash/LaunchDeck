import { resolve } from 'node:path';
import { createApp } from './app.js';
import { backendRoot, projectRoot, resolveFrontendRoot } from './paths.js';
import { getLocalIPv4Addresses } from './network.js';

const port = Number(process.env.PORT || 3000);
const listenHost = process.env.LISTEN_HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535 的整数');
const server = createApp({
  root: resolveFrontendRoot,
  databasePath: process.env.DATABASE_PATH
    ? resolve(projectRoot, process.env.DATABASE_PATH)
    : resolve(backendRoot, 'data/portal.sqlite'),
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请设置其他 PORT。` : error.message);
  process.exitCode = 1;
});
server.listen(port, listenHost, () => {
  console.log(`后端监听：${listenHost}:${port}`);
  console.log(`本机访问：http://127.0.0.1:${port}`);
  if (listenHost === '0.0.0.0') {
    for (const address of getLocalIPv4Addresses()) console.log(`局域网访问：http://${address}:${port}`);
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
