import { validatePatch } from '../../validation.js';
import { record, check, string, integer } from '../../features/schema.js';

const SYSTEM_PAGES = ['all', 'ai', 'design', 'dev', 'media'];

export function validateBrowserData(value) {
  if (value === null || value === undefined) return;
  record(value, ['pages', 'customSites'], '浏览器页面备份');
  check(Array.isArray(value.pages) && value.pages.length >= 5 && value.pages.length <= 50, '导航页数量不正确');
  check(Array.isArray(value.customSites) && value.customSites.length <= 1000, '自定义网站数量不正确');
  const ids = new Set();
  const orders = new Set();
  for (const page of value.pages) {
    record(page, ['id', 'title', 'icon', 'isSystem', 'order'], '导航页');
    check(typeof page.id === 'string' && (SYSTEM_PAGES.includes(page.id) || /^page_[a-z0-9_-]{1,64}$/i.test(page.id)), '导航页 ID 不正确');
    check(!ids.has(page.id), '导航页 ID 重复');
    ids.add(page.id);
    string(page.title, 100, '导航页标题');
    check(['sparkles', 'folder', 'code', 'book', 'globe'].includes(page.icon), '导航页图标不正确');
    check(page.isSystem === SYSTEM_PAGES.includes(page.id), '导航页类型不正确');
    integer(page.order, 0, 49, '导航页顺序');
    check(!orders.has(page.order), '导航页顺序重复');
    orders.add(page.order);
  }
  check(SYSTEM_PAGES.every(id => ids.has(id)), '预设导航页不完整');
  const siteIds = new Set();
  for (const site of value.customSites) {
    check(ids.has(site.category) && !SYSTEM_PAGES.includes(site.category), '自定义网站必须属于已有自定义导航页');
    validatePatch({ sites: [{ ...site, category: 'ai' }] });
    check(!siteIds.has(site.id), '自定义网站 ID 重复');
    siteIds.add(site.id);
  }
}
