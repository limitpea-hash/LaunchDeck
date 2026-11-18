import { encodeFixture, decodeFields, importItem, PREFIX } from './codec.js';
const packet = await encodeFixture();
document.getElementById('sizes').textContent = `50个网站，${packet.parts.length}段数据；每段字符数：${packet.parts.map(p => p.length).join('、')}。`;
const fields = document.getElementById('fields');
for (const [name, label] of [[`${PREFIX}manifest`, '备份清单'],
  ...packet.parts.map((_, i) => [`${PREFIX}chunk_${i}`, `备份分段 ${i + 1}`])]) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = document.createElement('input'); input.type = 'password'; input.id = name;
  input.name = name; input.autocomplete = 'off'; input.spellcheck = false;
  wrapper.append(input); fields.append(wrapper);
}
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const exportButton = document.getElementById('exportItem'); exportButton.disabled = false;
exportButton.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(importItem(packet), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'launchdeck-synthetic-login.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const restoreButton = document.getElementById('restore'); restoreButton.disabled = false;
restoreButton.addEventListener('click', () => {
  preview.textContent = '';
  status.textContent = '请选择 Bitwarden 中的合成备份条目并填充，然后点击“校验并预览恢复”。';
  document.getElementById('username').focus({ preventScroll: true });
});
document.getElementById('clear').addEventListener('click', () => {
  document.getElementById('restoreForm').reset(); preview.textContent = ''; status.textContent = '已清空，请重新选择 Bitwarden 条目填充。';
});
document.getElementById('restoreForm').addEventListener('submit', async event => {
  event.preventDefault(); preview.textContent = '';
  try {
    const data = await decodeFields(document.getElementById(`${PREFIX}manifest`).value,
      packet.parts.map((_, i) => document.getElementById(`${PREFIX}chunk_${i}`).value));
    status.textContent = `恢复校验通过：${data.page.sites.length}个合成网站、顺序及Dock标记完整。仅预览，未修改真实导航。`;
    preview.textContent = JSON.stringify({ title: data.page.title, sites: data.page.sites.length,
      first: data.page.sites[0], last: data.page.sites.at(-1), pinned: data.page.sites.filter(s => s.pinned).length }, null, 2);
  } catch (error) { status.textContent = `拒绝恢复：${error.message}`; }
});
