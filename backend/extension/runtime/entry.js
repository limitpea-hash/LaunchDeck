import { installFetchBridge } from './bridge.js';
import { NETWORK_ORIGINS } from './environment.js';
import { validateBrowserData } from './backup.js';
import { validatePatch } from '../../validation.js';
import { validateWidgetPatch } from '../../features/widgets.js';
import { validateSettingsPatch } from '../../features/settings.js';
import { installFaviconEnhancement, browserFaviconUrl, presetIconKey } from './favicons.js';
import { iconPresets } from '../icon-presets.js';

installFetchBridge();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function json(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '操作失败');
  return body;
}

function hydrateBrowserData(data, portal) {
  if (!data) return;
  validateBrowserData(data);
  localStorage.setItem('ios18_nav_pages_v1', JSON.stringify(data.pages));
  localStorage.setItem('ios18_nav_sites_v1', JSON.stringify([...(portal?.sites || []), ...data.customSites]));
}

function installPermissionTools() {
  const locationPanel = document.getElementById('settingsPanelLocation');
  const card = node('section', null, 'extension-local-card');
  card.append(node('strong', '联网天气与城市搜索'), node('p', '导航、便签与待办始终保存在此浏览器。天气和 IP 近似位置需要连接指定的数据服务，允许后将刷新页面。'));
  const enable = node('button', '启用联网并刷新', 'ui-btn ui-btn-primary ui-btn-sm');
  enable.type = 'button';
  const status = node('span', '', 'extension-local-status');
  enable.addEventListener('click', async () => {
    try {
      const granted = await chrome.permissions.request({ origins: NETWORK_ORIGINS });
      if (granted) location.reload();
      else status.textContent = '未启用联网，离线功能可继续使用。';
    } catch { status.textContent = '权限申请失败，请稍后重试。'; }
  });
  card.append(enable, status);
  locationPanel?.prepend(card);
  chrome.permissions.contains({ origins: NETWORK_ORIGINS }).then(granted => {
    if (granted) { enable.textContent = '联网权限已启用'; enable.disabled = true; }
  }).catch(() => {});

  let geoGranted = false;
  document.addEventListener('click', async event => {
    const trigger = event.target.closest?.('#requestBrowserGeoBtn');
    if (!trigger || geoGranted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      geoGranted = await chrome.permissions.request({ permissions: ['geolocation'] });
      if (geoGranted) trigger.click();
      else { const text = document.getElementById('locationStatusText'); if (text) text.textContent = '定位未授权，可继续使用 IP 近似位置或手动城市。'; }
    } catch { const text = document.getElementById('locationStatusText'); if (text) text.textContent = '定位授权失败，请稍后重试。'; }
  }, true);

  const autoOption = document.querySelector('#clockModeSelect option[value="automatic"]');
  if (autoOption) autoOption.textContent = '自动（跟随设备时间）';
  const syncHelp = document.querySelector('#settingsPanelSync .settings-sub-text');
  if (syncHelp) syncHelp.textContent = '数据保存在当前浏览器，不需要启动本地网页服务。Chrome、Edge 和不同浏览器配置文件之间不会自动同步。';
}

function installBackupTools(app) {
  const panel = document.getElementById('settingsPanelSync');
  if (!panel) return;
  const card = node('section', null, 'extension-local-card');
  card.append(node('strong', '本地数据备份'), node('p', '导出导航、便签、组件和当前浏览器设置。备份含个人内容，请自行保管。导入会替换当前数据。'));
  const exportButton = node('button', '导出备份', 'ui-btn ui-btn-sm');
  const importButton = node('button', '导入并替换', 'ui-btn ui-btn-sm');
  exportButton.type = importButton.type = 'button';
  const file = node('input');
  file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  const status = node('p', '', 'extension-local-status');
  exportButton.addEventListener('click', async () => {
    try {
      const backup = await json('/api/extension/backup');
      const presets = new Set(['ai', 'design', 'dev', 'media']);
      backup.portal = { sites: structuredClone(app.state.sites.filter(site => presets.has(site.category))), prefs: structuredClone(app.state.prefs), note: app.state.note };
      backup.widgets = structuredClone(app.state.widgetState);
      backup.device = structuredClone(app.state.deviceSettings);
      backup.browserData = { pages: structuredClone(app.state.pages).map((page, order) => ({ ...page, order })), customSites: structuredClone(app.state.sites.filter(site => !presets.has(site.category))) };
      validatePatch(backup.portal, true); validateWidgetPatch(backup.widgets); validateSettingsPatch(backup.device); validateBrowserData(backup.browserData);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      if (blob.size > 2 * 1024 * 1024) throw new Error('备份内容过大，请先减少不需要的数据');
      const url = URL.createObjectURL(blob);
      const link = node('a'); link.href = url; link.download = `launchdeck-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status.textContent = '已生成备份文件。';
    } catch (error) { status.textContent = error.message || '导出失败'; }
  });
  importButton.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      if (selected.size > 2 * 1024 * 1024) throw new Error('备份文件不能超过 2 MB');
      const backup = JSON.parse(await selected.text());
      if (!confirm('将用备份替换当前浏览器的导航、便签、组件和设置。建议先导出当前备份。是否继续？')) return;
      await json('/api/extension/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
      if (backup.portal === null) {
        for (const key of ['ios18_nav_sites_v1', 'ios18_nav_prefs_v1', 'ios18_nav_quicknote_v1']) localStorage.removeItem(key);
      }
      hydrateBrowserData(backup.browserData, backup.portal);
      // Previously queued web-style writes must not overwrite the restored documents.
      for (const key of ['ios18_nav_outbox_v1', 'ios18_widgets_outbox_v1', 'ios18_widgets_state_v1', 'ios18_widgets_revision_v1']) localStorage.removeItem(key);
      location.reload();
    } catch (error) { status.textContent = error.message || '导入失败'; }
    finally { file.value = ''; }
  });
  card.append(exportButton, importButton, file, status);
  panel.append(card);
}

try {
  // Restore imported browser-only navigation pages before app.js reads its caches.
  const browserData = await json('/api/extension/browser-data');
  if (browserData && localStorage.getItem('ios18_nav_pages_v1') === null) {
    hydrateBrowserData(browserData, (await json('/api/state')).state);
  }
  installPermissionTools();
  const iconEnhancement = installFaviconEnhancement({ document, MutationObserver, extensionId: chrome.runtime.id, presets: iconPresets });
  window.LaunchDeckIcons = Object.freeze({
    presetKey: site => presetIconKey(site, iconPresets),
    faviconUrl: (url, size = 64) => browserFaviconUrl(url, { extensionId: chrome.runtime.id, size }),
    refresh: iconEnhancement.refresh,
  });
  window.addEventListener('pagehide', () => iconEnhancement.destroy(), { once: true });
  await import('../../../backend-client.js');
  const app = await import('../../../app.js');
  await app.startApplication();
  installBackupTools(app);
} catch (error) {
  const notice = node('section', null, 'extension-local-card extension-startup-error');
  notice.setAttribute('role', 'alert');
  notice.append(node('strong', '起始页启动失败'), node('p', error.message || '请刷新页面重试，现有数据不会被自动清空。'));
  const retry = node('button', '刷新重试', 'ui-btn'); retry.type = 'button'; retry.addEventListener('click', () => location.reload());
  notice.append(retry); document.body.prepend(notice);
}
