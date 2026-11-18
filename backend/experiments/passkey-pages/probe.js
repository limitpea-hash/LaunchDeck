import { FIXTURE_PAGES, encodePage, createOptions, getOptions,
  verifyRegistration, verifyWrite, verifyRead } from './protocol.js';

const ready = document.getElementById('providerReady');
const importButton = document.getElementById('importPage');
const environment = document.getElementById('environment');
const supported = isSecureContext && location.hostname === 'localhost' &&
  typeof navigator.credentials?.create === 'function' && typeof navigator.credentials?.get === 'function';
environment.textContent = supported
  ? '环境可发起 WebAuthn 请求；这不代表 Bitwarden 支持页面数据存储。'
  : '当前环境不可测试，请使用支持 WebAuthn 的浏览器访问 http://localhost:3007/。';
const batchId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const rows = [];
let busy = false;
function sync() {
  const allowed = supported && ready.checked && !busy;
  importButton.disabled = !allowed;
  for (const row of rows) {
    row.create.disabled = !allowed || !row.data || Boolean(row.credentialId);
    row.write.disabled = !allowed || !row.credentialId;
    row.read.disabled = !allowed || !row.written;
  }
}
async function run(status, operation) {
  if (busy || !ready.checked || !supported) return;
  busy = true; sync(); status.textContent = '等待选择 Bitwarden 并完成提示…';
  try { await operation(); }
  catch (error) { status.textContent = `未完成：${error?.message || '请求取消或失败'}。没有修改 LaunchDeck 数据。`; }
  finally { busy = false; sync(); }
}
for (const [index, page] of FIXTURE_PAGES.entries()) {
  const section = document.createElement('section');
  const heading = document.createElement('h2'); heading.textContent = page.title;
  const size = document.createElement('p');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const row = { data: null, credentialId: null, written: false };
  for (const [key, label] of [['create', '1．创建测试通行密钥'], ['write', '2．写入该页'], ['read', '3．校验读回']]) {
    row[key] = document.createElement('button'); row[key].type = 'button'; row[key].textContent = label;
  }
  row.create.addEventListener('click', () => run(status, async () => {
    const credential = await navigator.credentials.create(createOptions(index, batchId));
    row.credentialId = verifyRegistration(credential);
    status.textContent = '所选提供者报告支持 largeBlob；测试凭据已创建，页面数据尚未写入。';
  }));
  row.write.addEventListener('click', () => run(status, async () => {
    row.written = false;
    const credential = await navigator.credentials.get(getOptions({ credentialId: row.credentialId, write: row.data }));
    verifyWrite(credential, row.credentialId); row.written = true;
    status.textContent = '提供者已确认写入，尚需点击“校验读回”核对完整内容。';
  }));
  row.read.addEventListener('click', () => run(status, async () => {
    const credential = await navigator.credentials.get(getOptions({ credentialId: row.credentialId, read: true }));
    await verifyRead(credential, row.data);
    status.textContent = '所选提供者本机写入与读回字节一致。Bitwarden 云端及跨设备恢复仍待验证。';
  }));
  rows.push(row); section.append(heading, size, row.create, row.write, row.read, status);
  document.getElementById('pages').append(section);
  try {
    row.data = await encodePage(index, batchId);
    size.textContent = `${page.sites.length} 个合成网站，压缩与校验封装后 ${row.data.length} 字节。每页使用一个通行密钥。`;
  } catch (error) { status.textContent = `准备失败：${error.message}`; }
}
ready.addEventListener('change', sync);
importButton.addEventListener('click', () => run(document.getElementById('importStatus'), async () => {
  const preview = document.getElementById('importPreview'); preview.textContent = '';
  const credential = await navigator.credentials.get(getOptions({ read: true }));
  const body = await verifyRead(credential);
  preview.textContent = JSON.stringify(body, null, 2);
  document.getElementById('importStatus').textContent = '已读回并校验一页合成数据，仅预览，没有应用到导航。需逐页选择并核对批次一致、页数完整。';
}));
sync();
