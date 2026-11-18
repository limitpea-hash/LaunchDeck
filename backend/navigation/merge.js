import { HttpError, validatePatch } from '../validation.js';
import { check } from '../features/schema.js';
import { validateWidgetDocument, widgetDefinitions } from '../features/widgets.js';
import { validateNavigationBackup, SYSTEM_SITE_PAGES } from './schema.js';

export function mergeNavigationBackup(backup, portal, widgets) {
  validateNavigationBackup(backup);
  if (!portal) throw new HttpError(428, '请先保存当前页面后再恢复导航');
  const placed = new Set(backup.desktop.placements.filter(p => p.kind === 'widget').map(p => p.id));
  const old = new Map(widgets.layout.map(row => [row.id, row]));
  const layout = backup.widgetSlots.map((slot, order) => {
    const previous = old.get(slot.id);
    check(!previous || previous.type === slot.type, '同一组件ID的类型不同，恢复已取消');
    old.delete(slot.id);
    return { id: slot.id, type: slot.type, order, enabled: placed.has(slot.id),
      config: structuredClone(previous?.config ?? widgetDefinitions.find(d => d.type === slot.type).defaultConfig) };
  });
  // Preserve local configuration even when the imported desktop hides a widget.
  for (const previous of old.values()) layout.push({ ...structuredClone(previous), enabled: false, order: layout.length });
  check(layout.length <= 24, '合并后的组件配置超过24项，恢复已取消');
  const nextPortal = { ...structuredClone(portal), sites: backup.sites.filter(s => SYSTEM_SITE_PAGES.includes(s.category)) };
  const nextWidgets = { ...structuredClone(widgets), layout, desktop: structuredClone(backup.desktop) };
  validatePatch(nextPortal, true); validateWidgetDocument(nextWidgets, widgets);
  return { portal: nextPortal, widgets: nextWidgets, browserData: {
    pages: structuredClone(backup.pages), customSites: structuredClone(backup.sites.filter(s => !SYSTEM_SITE_PAGES.includes(s.category))),
    siteOrder: backup.sites.map(site => site.id) } };
}
