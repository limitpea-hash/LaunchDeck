import { validatePatch } from '../validation.js';
import { record, check, identifier } from '../features/schema.js';
import { validateDesktop, widgetDefinitions } from '../features/widgets.js';

export const MAX_NAVIGATION_BYTES = 1024 * 1024;
export const SYSTEM_SITE_PAGES = ['ai', 'design', 'dev', 'media'];

// Keep the server's system-site order, inserting local custom sites before their
// next known system-site anchor. With a restored order this recreates the exact
// interleaving, while later remote system reorders still take effect.
export function mergeNavigationSites(systemSites, customSites, siteOrder) {
  if (!Array.isArray(siteOrder)) return [...systemSites, ...customSites];
  const systemIds = new Set(systemSites.map(site => site.id));
  const remaining = new Map(customSites.map(site => [site.id, site]));
  const before = new Map(); let pending = [];
  for (const id of siteOrder.slice(0, 2000)) {
    if (remaining.has(id)) { pending.push(remaining.get(id)); remaining.delete(id); }
    else if (systemIds.has(id)) {
      before.set(id, [...(before.get(id) || []), ...pending]); pending = [];
    }
  }
  const result = [];
  for (const site of systemSites) result.push(...(before.get(site.id) || []), site);
  return [...result, ...pending, ...remaining.values()];
}
const siteKeys = ['id', 'title', 'url', 'category', 'pinned', 'gradient', 'accent', 'iconKey', 'keywords'];
const pageKeys = ['id', 'title', 'icon', 'isSystem', 'order'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));

export function validateNavigationBackup(value) {
  record(value, ['format', 'version', 'backupId', 'exportedAt', 'sites', 'pages', 'desktop', 'widgetSlots'], '导航备份');
  check(value.format === 'launchdeck-navigation' && value.version === 1, '导航备份格式或版本不支持');
  check(typeof value.backupId === 'string' && /^[a-f0-9]{32}$/.test(value.backupId), '备份标识不正确');
  check(typeof value.exportedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.exportedAt) &&
    Number.isFinite(Date.parse(value.exportedAt)) && new Date(value.exportedAt).toISOString() === value.exportedAt, '导出时间不正确');
  check(Array.isArray(value.sites) && value.sites.length <= 1000, '网站最多1000项');
  check(Array.isArray(value.pages) && value.pages.length >= 5 && value.pages.length <= 50, '导航页数量不正确');
  check(Array.isArray(value.widgetSlots) && value.widgetSlots.length <= 24, '组件位置标识过多');
  const widgetIds = new Set();
  check(value.desktop?.schemaVersion === 2 && Array.isArray(value.desktop.placements), '导航备份必须使用文件夹布局v2');
  const placedWidgets = new Set(value.desktop.placements.filter(p => p?.kind === 'widget').map(p => p.id));
  const layout = value.widgetSlots.map((slot, order) => {
    record(slot, ['id', 'type'], '组件位置标识'); identifier(slot.id);
    const definition = widgetDefinitions.find(d => d.type === slot.type);
    check(definition && !widgetIds.has(slot.id), '组件类型未知或ID重复'); widgetIds.add(slot.id);
    return { id: slot.id, type: slot.type, order, enabled: placedWidgets.has(slot.id), config: definition.defaultConfig };
  });
  check(value.desktop?.schemaVersion === 2, '导航备份必须使用文件夹布局v2');
  validateDesktop(value.desktop, layout);
  check(JSON.stringify(value.pages) === JSON.stringify(value.desktop.pages), '导航页与桌面记录不一致');
  const pages = new Set(value.pages.map(p => p.id)); const ids = new Set();
  for (const site of value.sites) {
    record(site, siteKeys, '网站');
    check(pages.has(site.category) && site.category !== 'all', '网站分类不存在');
    validatePatch({ sites: [{ ...site, category: 'ai' }] });
    check(!ids.has(site.id), '网站ID重复'); ids.add(site.id);
  }
  for (const placement of value.desktop.placements) {
    if (placement.kind === 'site') check(ids.has(placement.id), '桌面引用了不存在的网站');
  }
  for (const folder of value.desktop.folders) check(folder.siteIds.every(id => ids.has(id)), '文件夹引用了不存在的网站');
  check(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_NAVIGATION_BYTES, '导航备份不能超过1MiB');
  return value;
}

export function createNavigationBackup({ sites, pages, desktop, layout }) {
  check(Array.isArray(sites) && Array.isArray(pages) && Array.isArray(layout) && desktop, '当前桌面尚未准备好，请刷新后导出');
  // getRandomValues also works on plain HTTP LAN pages; randomUUID does not.
  check(globalThis.crypto?.getRandomValues, '当前浏览器不支持安全随机数，请更新浏览器后重试');
  const backupId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const cleanPages = pages.map(page => pick(page, pageKeys)).sort((a, b) => a.order - b.order);
  const value = {
    format: 'launchdeck-navigation', version: 1,
    backupId, exportedAt: new Date().toISOString(),
    sites: sites.map(site => pick(site, siteKeys)), pages: cleanPages,
    desktop: { schemaVersion: 2, pages: structuredClone(cleanPages),
      placements: (desktop.placements || []).map(p => pick(p, ['kind', 'id', 'pageId', 'order'])),
      folders: (desktop.folders || []).map(f => pick(f, ['id', 'title', 'siteIds'])) },
    widgetSlots: layout.map(slot => pick(slot, ['id', 'type'])),
  };
  return validateNavigationBackup(value);
}

export function navigationSummary(backup) {
  validateNavigationBackup(backup);
  return { sites: backup.sites.length, pages: backup.pages.length, folders: backup.desktop.folders.length,
    widgets: backup.desktop.placements.filter(p => p.kind === 'widget').length,
    pinned: backup.sites.filter(site => site.pinned).length };
}

export function validateNavigationImportRequest(input) {
  record(input, ['backup', 'portalRevision', 'widgetRevision'], '导航恢复请求');
  check(Number.isSafeInteger(input.portalRevision) && input.portalRevision >= 0 &&
    Number.isSafeInteger(input.widgetRevision) && input.widgetRevision >= 0, '需要当前网站与组件版本');
  validateNavigationBackup(input.backup);
  return input;
}
