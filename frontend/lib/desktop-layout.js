import { DEFAULT_WIDGET_DEFINITIONS } from './feature-client.js';
import {
  MAX_DESKTOP_FOLDERS,
  MIN_FOLDER_SITES,
  MAX_FOLDER_SITES,
  MAX_FOLDER_TITLE_LENGTH,
  DEFAULT_FOLDER_TITLE,
  isValidFolderId,
  isValidFolderSiteId,
  sanitizeFolderTitle,
  generateFolderId,
  normalizeFolderRecords,
  finalizeDesktopFoldersAndPlacements,
  createSiteFolder,
  addSiteToFolder,
  renameSiteFolder,
  reorderFolderSite,
  moveFolderSiteToPage,
  dissolveSiteFolder,
} from './desktop-folders.js';

export {
  MAX_DESKTOP_FOLDERS,
  MIN_FOLDER_SITES,
  MAX_FOLDER_SITES,
  MAX_FOLDER_TITLE_LENGTH,
  DEFAULT_FOLDER_TITLE,
  isValidFolderId,
  isValidFolderSiteId,
  sanitizeFolderTitle,
  generateFolderId,
  normalizeFolderRecords,
  finalizeDesktopFoldersAndPlacements,
  createSiteFolder,
  addSiteToFolder,
  renameSiteFolder,
  reorderFolderSite,
  moveFolderSiteToPage,
  dissolveSiteFolder,
};

export const DESKTOP_SCHEMA_VERSION = 2;
export const MAX_DESKTOP_PAGES = 50;
export const MIN_DESKTOP_PAGES = 5;
export const MAX_DESKTOP_PLACEMENTS = 5000;

export const ALLOWED_PAGE_ICONS = new Set(['sparkles', 'folder', 'code', 'book', 'globe']);

export const DEFAULT_SYSTEM_PAGES = Object.freeze([
  { id: 'all', title: '精选主页', icon: 'sparkles', isSystem: true, order: 0 },
  { id: 'ai', title: 'AI 与效率', icon: 'sparkles', isSystem: true, order: 1 },
  { id: 'design', title: '设计灵感', icon: 'folder', isSystem: true, order: 2 },
  { id: 'dev', title: '开发与技术', icon: 'code', isSystem: true, order: 3 },
  { id: 'media', title: '影音与社区', icon: 'globe', isSystem: true, order: 4 },
]);

const SYSTEM_PAGE_IDS = new Set(DEFAULT_SYSTEM_PAGES.map(p => p.id));
const CUSTOM_PAGE_ID_RE = /^page_[a-z0-9_-]{1,64}$/i;
const PLACEMENT_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

export function isValidCustomPageId(id) {
  return CUSTOM_PAGE_ID_RE.test(String(id || ''));
}

export function isValidPlacementId(id) {
  return PLACEMENT_ID_RE.test(String(id || ''));
}

export function sanitizePageIcon(icon, fallback = 'sparkles') {
  const key = String(icon || '').trim();
  return ALLOWED_PAGE_ICONS.has(key) ? key : fallback;
}

export function normalizePages(rawPages, fallbackPages = DEFAULT_SYSTEM_PAGES) {
  const sourceList = Array.isArray(rawPages) && rawPages.length > 0 ? rawPages : fallbackPages;
  const byId = new Map();

  for (const item of sourceList) {
    if (!item || typeof item !== 'object') continue;
    const rawId = String(item.id || '').trim();
    if (!rawId || byId.has(rawId)) continue;

    if (SYSTEM_PAGE_IDS.has(rawId)) {
      const sysDef = DEFAULT_SYSTEM_PAGES.find(p => p.id === rawId);
      const title = String(item.title || sysDef?.title || rawId).trim().slice(0, 14) || sysDef.title;
      byId.set(rawId, {
        id: rawId,
        title,
        icon: sanitizePageIcon(item.icon, sysDef?.icon || 'sparkles'),
        isSystem: true,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : sysDef.order,
      });
    } else if (isValidCustomPageId(rawId)) {
      const title = String(item.title || '自定义页').trim().slice(0, 14) || '自定义页';
      byId.set(rawId, {
        id: rawId,
        title,
        icon: sanitizePageIcon(item.icon, 'sparkles'),
        isSystem: false,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : 999,
      });
    }
  }

  for (const sysPage of DEFAULT_SYSTEM_PAGES) {
    if (!byId.has(sysPage.id)) {
      byId.set(sysPage.id, { ...sysPage });
    }
  }

  const combined = Array.from(byId.values())
    .sort((a, b) => {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      return Number(a.order) - Number(b.order);
    })
    .slice(0, MAX_DESKTOP_PAGES)
    .map((page, idx) => ({
      id: page.id,
      title: page.title,
      icon: sanitizePageIcon(page.icon),
      isSystem: Boolean(SYSTEM_PAGE_IDS.has(page.id)),
      order: idx,
    }));

  return combined;
}

export function normalizeWidgetLayout(rawLayout, definitions = DEFAULT_WIDGET_DEFINITIONS) {
  const defs = Array.isArray(definitions) && definitions.length > 0
    ? definitions
    : DEFAULT_WIDGET_DEFINITIONS;
  const defMap = new Map(defs.map(d => [d.type, d]));
  const seenIds = new Set();
  const list = [];
  const hasExplicitLayout = Array.isArray(rawLayout);

  if (hasExplicitLayout) {
    for (const item of rawLayout) {
      if (!item || typeof item !== 'object') continue;
      const type = String(item.type || item.id || '').trim();
      const id = String(item.id || type).trim();
      if (!defMap.has(type) || !isValidPlacementId(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      const def = defMap.get(type);
      list.push({
        id,
        type,
        enabled: item.enabled !== false,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : list.length,
        config:
          item.config && typeof item.config === 'object'
            ? structuredClone(item.config)
            : structuredClone(def.defaultConfig || {}),
      });
    }
  }

  for (const def of defs) {
    if (!seenIds.has(def.type)) {
      seenIds.add(def.type);
      list.push({
        id: def.type,
        type: def.type,
        enabled: !hasExplicitLayout,
        order: list.length,
        config: structuredClone(def.defaultConfig || {}),
      });
    }
  }

  return list
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((item, idx) => ({
      ...item,
      order: idx,
    }));
}

export function reconcileDesktopWithLayout(
  rawDesktop,
  rawLayout,
  { fallbackPages = DEFAULT_SYSTEM_PAGES, definitions = DEFAULT_WIDGET_DEFINITIONS } = {}
) {
  const layout = normalizeWidgetLayout(rawLayout, definitions);
  if (!rawDesktop || typeof rawDesktop !== 'object') {
    return { layout, desktop: null };
  }

  const pages = normalizePages(rawDesktop.pages, fallbackPages);
  const validPageIds = new Set(pages.map(p => p.id));
  const enabledWidgetIds = new Set(layout.filter(w => w.enabled).map(w => w.id));

  // Normalize folder definitions first
  const rawFolders = Array.isArray(rawDesktop.folders) ? rawDesktop.folders : [];
  const folderMap = new Map();
  for (const f of rawFolders) {
    if (!f || typeof f !== 'object') continue;
    const fId = String(f.id || '').trim();
    if (!isValidFolderId(fId) || folderMap.has(fId)) continue;
    const seenSites = new Set();
    const siteIds = [];
    for (const rawSiteId of Array.isArray(f.siteIds) ? f.siteIds : []) {
      const sId = String(rawSiteId || '').trim();
      if (!isValidPlacementId(sId) || seenSites.has(sId)) continue;
      seenSites.add(sId);
      siteIds.push(sId);
      if (siteIds.length >= MAX_FOLDER_SITES) break;
    }
    if (siteIds.length === 0) continue;
    folderMap.set(fId, {
      id: fId,
      title: sanitizeFolderTitle(f.title, DEFAULT_FOLDER_TITLE),
      siteIds,
    });
  }

  const perPageBuckets = new Map(pages.map(p => [p.id, []]));
  const perPageSeen = new Map(pages.map(p => [p.id, new Set()]));
  const placedWidgets = new Set();
  const placedFolders = new Set();

  const rawPlacements = Array.isArray(rawDesktop.placements)
    ? rawDesktop.placements.slice()
    : [];

  const indexedPlacements = rawPlacements.map((entry, idx) => ({ entry, idx }));
  indexedPlacements.sort((a, b) => {
    const orderA = Number.isFinite(Number(a.entry?.order)) ? Number(a.entry.order) : a.idx;
    const orderB = Number.isFinite(Number(b.entry?.order)) ? Number(b.entry.order) : b.idx;
    return orderA - orderB || a.idx - b.idx;
  });

  for (const { entry } of indexedPlacements) {
    if (!entry || typeof entry !== 'object') continue;
    const kind =
      entry.kind === 'widget'
        ? 'widget'
        : entry.kind === 'folder'
          ? 'folder'
          : entry.kind === 'site'
            ? 'site'
            : null;
    const id = String(entry.id || '').trim();
    if (!kind || !isValidPlacementId(id)) continue;

    const pageId = validPageIds.has(entry.pageId) ? entry.pageId : 'all';
    const pageSeen = perPageSeen.get(pageId);
    const key = `${kind}:${id}`;
    if (!pageSeen || pageSeen.has(key)) continue;

    if (kind === 'widget') {
      if (!enabledWidgetIds.has(id) || placedWidgets.has(id)) continue;
      placedWidgets.add(id);
    } else if (kind === 'folder') {
      if (!isValidFolderId(id) || placedFolders.has(id)) continue;
      const folderRec = folderMap.get(id);
      if (!folderRec) continue;
      if (folderRec.siteIds.length === 1) {
        // Auto-dissolve 1-member folder into its slot
        const singleSiteId = folderRec.siteIds[0];
        folderMap.delete(id);
        const siteKey = `site:${singleSiteId}`;
        if (!pageSeen.has(siteKey)) {
          pageSeen.add(siteKey);
          perPageBuckets.get(pageId).push({ kind: 'site', id: singleSiteId, pageId });
        }
        continue;
      }
      if (placedFolders.size >= MAX_DESKTOP_FOLDERS) continue;
      placedFolders.add(id);
    }

    pageSeen.add(key);
    perPageBuckets.get(pageId).push({ kind, id, pageId });
  }

  // Ensure every enabled widget in layout has exactly one placement
  const allBucket = perPageBuckets.get('all');
  const allSeen = perPageSeen.get('all');
  for (const widget of layout) {
    if (!widget.enabled) continue;
    if (!placedWidgets.has(widget.id)) {
      placedWidgets.add(widget.id);
      allSeen.add(`widget:${widget.id}`);
      allBucket.push({
        kind: 'widget',
        id: widget.id,
        pageId: 'all',
      });
    }
  }

  const placements = [];
  const finalFolders = [];

  for (const page of pages) {
    const bucket = perPageBuckets.get(page.id) || [];
    // Claim folder member sites first on this page
    const pageFolderMemberIds = new Set();
    const resolvedBucket = [];

    for (const item of bucket) {
      if (item.kind === 'folder') {
        const rec = folderMap.get(item.id);
        if (!rec) continue;
        const uniqueForPage = rec.siteIds.filter(sId => !pageFolderMemberIds.has(sId));
        if (uniqueForPage.length === 0) continue;
        if (uniqueForPage.length === 1) {
          const singleSiteId = uniqueForPage[0];
          resolvedBucket.push({ kind: 'site', id: singleSiteId, pageId: page.id });
          continue;
        }
        rec.siteIds = uniqueForPage;
        for (const sId of uniqueForPage) {
          pageFolderMemberIds.add(sId);
        }
        finalFolders.push({
          id: rec.id,
          title: rec.title,
          siteIds: rec.siteIds.slice(),
        });
        resolvedBucket.push(item);
      } else {
        resolvedBucket.push(item);
      }
    }

    const finalPageSeen = new Set();
    let order = 0;
    for (const item of resolvedBucket) {
      if (placements.length >= MAX_DESKTOP_PLACEMENTS) break;
      if (item.kind === 'site' && pageFolderMemberIds.has(item.id)) {
        // Site is already inside a folder on this page
        continue;
      }
      const key = `${item.kind}:${item.id}`;
      if (finalPageSeen.has(key)) continue;
      finalPageSeen.add(key);
      placements.push({
        kind: item.kind,
        id: item.id,
        pageId: page.id,
        order: order++,
      });
    }
  }

  // Sync layout.order with widget placement order on pages
  const widgetOrderList = placements.filter(p => p.kind === 'widget').map(p => p.id);
  const widgetOrderRank = new Map(widgetOrderList.map((id, idx) => [id, idx]));
  const syncedLayout = layout
    .slice()
    .sort((a, b) => {
      const rankA = widgetOrderRank.has(a.id) ? widgetOrderRank.get(a.id) : 1000 + a.order;
      const rankB = widgetOrderRank.has(b.id) ? widgetOrderRank.get(b.id) : 1000 + b.order;
      return rankA - rankB;
    })
    .map((item, idx) => ({
      ...item,
      order: idx,
    }));

  const isV2 =
    Number(rawDesktop.schemaVersion) === 2 ||
    Array.isArray(rawDesktop.folders) ||
    finalFolders.length > 0;

  return {
    layout: syncedLayout,
    desktop: isV2
      ? {
          schemaVersion: 2,
          pages,
          placements,
          folders: finalFolders,
        }
      : {
          schemaVersion: 1,
          pages,
          placements,
        },
  };
}

export function migrateLegacyDesktop({
  pages = DEFAULT_SYSTEM_PAGES,
  sites = [],
  layout = [],
  definitions = DEFAULT_WIDGET_DEFINITIONS,
} = {}) {
  const normalizedPages = normalizePages(pages, DEFAULT_SYSTEM_PAGES);
  const normalizedLayout = normalizeWidgetLayout(layout, definitions);
  const rawPlacements = [];

  let allOrder = 0;
  for (const widget of normalizedLayout) {
    if (!widget.enabled) continue;
    rawPlacements.push({
      kind: 'widget',
      id: widget.id,
      pageId: 'all',
      order: allOrder++,
    });
  }

  const safeSites = Array.isArray(sites) ? sites : [];
  for (const site of safeSites) {
    const siteId = String(site?.id || '').trim();
    if (!isValidPlacementId(siteId)) continue;
    rawPlacements.push({
      kind: 'site',
      id: siteId,
      pageId: 'all',
      order: allOrder++,
    });
  }

  for (const page of normalizedPages) {
    if (page.id === 'all') continue;
    let pageOrder = 0;
    for (const site of safeSites) {
      const siteId = String(site?.id || '').trim();
      if (!isValidPlacementId(siteId)) continue;
      if (site.category === page.id) {
        rawPlacements.push({
          kind: 'site',
          id: siteId,
          pageId: page.id,
          order: pageOrder++,
        });
      }
    }
  }

  return reconcileDesktopWithLayout(
    {
      schemaVersion: 2,
      pages: normalizedPages,
      placements: rawPlacements,
      folders: [],
    },
    normalizedLayout,
    { fallbackPages: normalizedPages, definitions }
  );
}

export function getPagePlacements(desktop, pageId) {
  if (!desktop || !Array.isArray(desktop.placements)) return [];
  return desktop.placements
    .filter(p => p && p.pageId === pageId)
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order));
}

export function getFolderById(desktop, folderId) {
  if (!desktop || !Array.isArray(desktop.folders) || !folderId) return null;
  const f = desktop.folders.find(item => item && item.id === folderId);
  return f ? structuredClone(f) : null;
}

export function getRenderablePageItems({ desktop, pageId, sites = [], layout = [] }) {
  const pagePlacements = getPagePlacements(desktop, pageId);
  const siteMap = new Map(
    (Array.isArray(sites) ? sites : [])
      .filter(s => s && s.id)
      .map(s => [String(s.id), s])
  );
  const widgetMap = new Map(
    (Array.isArray(layout) ? layout : [])
      .filter(w => w && w.id && w.enabled)
      .map(w => [String(w.id), w])
  );
  const folderMap = new Map(
    (Array.isArray(desktop?.folders) ? desktop.folders : [])
      .filter(f => f && f.id && Array.isArray(f.siteIds) && f.siteIds.length >= MIN_FOLDER_SITES)
      .map(f => [String(f.id), f])
  );

  const items = [];
  for (const placement of pagePlacements) {
    if (placement.kind === 'site') {
      const site = siteMap.get(placement.id);
      if (!site) continue;
      items.push({
        kind: 'site',
        id: placement.id,
        pageId,
        order: placement.order,
        site,
      });
    } else if (placement.kind === 'folder') {
      const folder = folderMap.get(placement.id);
      if (!folder) continue;
      const memberEntries = folder.siteIds.map((sId) => {
        const resolvedSite = siteMap.get(sId) || null;
        return {
          siteId: sId,
          site: resolvedSite,
          isUnresolved: !resolvedSite,
        };
      });
      items.push({
        kind: 'folder',
        id: placement.id,
        pageId,
        order: placement.order,
        folder: {
          id: folder.id,
          title: folder.title,
          siteIds: folder.siteIds.slice(),
        },
        memberEntries,
        resolvedSites: memberEntries.filter(m => m.site).map(m => m.site),
      });
    } else if (placement.kind === 'widget') {
      const widget = widgetMap.get(placement.id);
      if (!widget) continue;
      items.push({
        kind: 'widget',
        id: placement.id,
        pageId,
        order: placement.order,
        widget,
      });
    }
  }
  return items;
}

function buildDesktopResult(desktop, pages, placements, folders = undefined) {
  const resolvedFolders =
    folders !== undefined
      ? folders
      : Array.isArray(desktop?.folders)
        ? structuredClone(desktop.folders)
        : undefined;
  const isV2 =
    Number(desktop?.schemaVersion) === 2 ||
    Array.isArray(desktop?.folders) ||
    Array.isArray(resolvedFolders);

  const candidate = isV2
    ? {
        schemaVersion: 2,
        pages,
        placements: placements.slice(0, MAX_DESKTOP_PLACEMENTS),
        folders: Array.isArray(resolvedFolders) ? resolvedFolders : [],
      }
    : {
        schemaVersion: 1,
        pages,
        placements: placements.slice(0, MAX_DESKTOP_PLACEMENTS),
      };

  return isV2 ? finalizeDesktopFoldersAndPlacements(candidate, { forceV2: true }) : candidate;
}

function rebuildPlacementsFromPageItems(desktop, pageId, nextPageItems) {
  const pages = normalizePages(desktop?.pages);
  const nextPlacements = [];

  for (const page of pages) {
    const list = page.id === pageId
      ? nextPageItems
      : getPagePlacements(desktop, page.id);
    const seen = new Set();
    let order = 0;
    for (const item of list) {
      if (!item || !isValidPlacementId(item.id)) continue;
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nextPlacements.push({
        kind: item.kind,
        id: item.id,
        pageId: page.id,
        order: order++,
      });
    }
  }

  return buildDesktopResult(desktop, pages, nextPlacements);
}

export function reorderPlacementInPage(
  desktop,
  { pageId, draggedKind, draggedId, targetKind, targetId }
) {
  if (!desktop || !pageId) return desktop;
  if (draggedKind === targetKind && draggedId === targetId) return desktop;

  const list = getPagePlacements(desktop, pageId);
  const fromIdx = list.findIndex(item => item.kind === draggedKind && item.id === draggedId);
  const toIdx = list.findIndex(item => item.kind === targetKind && item.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return desktop;

  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  return rebuildPlacementsFromPageItems(desktop, pageId, list);
}

export function stepPlacementInPage(desktop, { pageId, kind, id, delta }, renderableContext = null) {
  if (!desktop || !pageId || !delta) return desktop;
  const list = getPagePlacements(desktop, pageId);
  const fromIdx = list.findIndex(item => item.kind === kind && item.id === id);
  if (fromIdx === -1) return desktop;

  if (renderableContext) {
    const visible = getRenderablePageItems({
      desktop,
      pageId,
      sites: renderableContext.sites,
      layout: renderableContext.layout,
    });
    const visIdx = visible.findIndex(item => item.kind === kind && item.id === id);
    const targetVis = visible[visIdx + delta];
    if (!targetVis) return desktop;
    return reorderPlacementInPage(desktop, {
      pageId,
      draggedKind: kind,
      draggedId: id,
      targetKind: targetVis.kind,
      targetId: targetVis.id,
    });
  }

  const toIdx = fromIdx + delta;
  if (toIdx < 0 || toIdx >= list.length) return desktop;
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  return rebuildPlacementsFromPageItems(desktop, pageId, list);
}

function deduplicateMovedItemOnTargetPage(desktop, { toPageId, kind, id, list, folders }) {
  const folderMap = new Map((Array.isArray(folders) ? folders : []).map(f => [f.id, f]));
  if (kind === 'site') {
    // If site is moved to toPageId, remove it from any folder on toPageId so it is not duplicated
    const pageFolderIds = new Set(list.filter(p => p.kind === 'folder').map(p => p.id));
    for (const fId of pageFolderIds) {
      const f = folderMap.get(fId);
      if (f && Array.isArray(f.siteIds) && f.siteIds.includes(id)) {
        f.siteIds = f.siteIds.filter(sId => sId !== id);
      }
    }
  } else if (kind === 'folder') {
    // If a folder is moved to toPageId, remove any top-level site placements on toPageId that are already in this folder,
    // and remove those member sites from any other folder on toPageId
    const movedFolder = folderMap.get(id);
    if (movedFolder && Array.isArray(movedFolder.siteIds)) {
      const memberSet = new Set(movedFolder.siteIds);
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (item.kind === 'site' && memberSet.has(item.id)) {
          list.splice(i, 1);
        } else if (item.kind === 'folder' && item.id !== id) {
          const otherFolder = folderMap.get(item.id);
          if (otherFolder && Array.isArray(otherFolder.siteIds)) {
            otherFolder.siteIds = otherFolder.siteIds.filter(sId => !memberSet.has(sId));
          }
        }
      }
    }
  }
}

export function movePlacementToPage(
  desktop,
  { fromPageId, toPageId, kind, id, targetKind = null, targetId = null }
) {
  if (!desktop || !fromPageId || !toPageId || !kind || !isValidPlacementId(id)) {
    return desktop;
  }

  const pages = normalizePages(desktop.pages);
  if (!pages.some(p => p.id === toPageId)) return desktop;

  if (fromPageId === toPageId) {
    if (targetKind && targetId) {
      return reorderPlacementInPage(desktop, {
        pageId: toPageId,
        draggedKind: kind,
        draggedId: id,
        targetKind,
        targetId,
      });
    }
    return desktop;
  }

  const folders = Array.isArray(desktop.folders) ? structuredClone(desktop.folders) : undefined;
  const nextPlacements = [];

  for (const page of pages) {
    let list = getPagePlacements(desktop, page.id);

    if (kind === 'widget' || kind === 'folder') {
      // Widgets and folders are unique across all pages
      list = list.filter(item => !(item.kind === kind && item.id === id));
    } else if (page.id === fromPageId) {
      list = list.filter(item => !(item.kind === 'site' && item.id === id));
    }

    if (page.id === toPageId) {
      deduplicateMovedItemOnTargetPage(desktop, { toPageId, kind, id, list, folders });
      const existingIdx = list.findIndex(item => item.kind === kind && item.id === id);
      const movedEntry = { kind, id, pageId: toPageId, order: list.length };

      if (existingIdx !== -1) {
        if (targetKind && targetId && !(targetKind === kind && targetId === id)) {
          const [existing] = list.splice(existingIdx, 1);
          const targetIdx = list.findIndex(item => item.kind === targetKind && item.id === targetId);
          if (targetIdx !== -1) {
            list.splice(targetIdx, 0, existing);
          } else {
            list.push(existing);
          }
        }
      } else if (targetKind && targetId) {
        const targetIdx = list.findIndex(item => item.kind === targetKind && item.id === targetId);
        if (targetIdx !== -1) {
          list.splice(targetIdx, 0, movedEntry);
        } else {
          list.push(movedEntry);
        }
      } else {
        list.push(movedEntry);
      }
    }

    list.forEach((item, idx) => {
      if (nextPlacements.length < MAX_DESKTOP_PLACEMENTS) {
        nextPlacements.push({
          kind: item.kind,
          id: item.id,
          pageId: page.id,
          order: idx,
        });
      }
    });
  }

  return buildDesktopResult(desktop, pages, nextPlacements, folders);
}

export function placeDesktopItemBefore(
  desktop,
  { fromPageId, toPageId, kind, id, beforeKind = null, beforeId = null }
) {
  if (!desktop || !fromPageId || !toPageId || !kind || !isValidPlacementId(id)) {
    return desktop;
  }

  const pages = normalizePages(desktop.pages);
  if (!pages.some(p => p.id === toPageId)) return desktop;

  const isSelfAnchor = beforeKind === kind && beforeId === id;
  if (fromPageId === toPageId && isSelfAnchor) {
    return desktop;
  }

  const effectiveBeforeKind = isSelfAnchor ? null : beforeKind;
  const effectiveBeforeId = isSelfAnchor ? null : beforeId;
  const folders = Array.isArray(desktop.folders) ? structuredClone(desktop.folders) : undefined;

  const nextPlacements = [];
  for (const page of pages) {
    let list = getPagePlacements(desktop, page.id);

    if (kind === 'widget' || kind === 'folder') {
      list = list.filter(item => !(item.kind === kind && item.id === id));
    } else if (page.id === fromPageId || page.id === toPageId) {
      list = list.filter(item => !(item.kind === 'site' && item.id === id));
    }

    if (page.id === toPageId) {
      deduplicateMovedItemOnTargetPage(desktop, { toPageId, kind, id, list, folders });
      const movedEntry = { kind, id, pageId: toPageId, order: list.length };
      if (effectiveBeforeKind && effectiveBeforeId) {
        const anchorIdx = list.findIndex(
          item => item.kind === effectiveBeforeKind && item.id === effectiveBeforeId
        );
        if (anchorIdx !== -1) {
          list.splice(anchorIdx, 0, movedEntry);
        } else {
          list.push(movedEntry);
        }
      } else {
        list.push(movedEntry);
      }
    }

    list.forEach((item, idx) => {
      if (nextPlacements.length < MAX_DESKTOP_PLACEMENTS) {
        nextPlacements.push({
          kind: item.kind,
          id: item.id,
          pageId: page.id,
          order: idx,
        });
      }
    });
  }

  return buildDesktopResult(desktop, pages, nextPlacements, folders);
}

export function enableWidgetOnPage(
  { layout, desktop },
  { widgetId, pageId = 'all', definitions = DEFAULT_WIDGET_DEFINITIONS }
) {
  const normalizedLayout = normalizeWidgetLayout(layout, definitions);
  const targetWidget = normalizedLayout.find(w => w.id === widgetId);
  if (!targetWidget) {
    return reconcileDesktopWithLayout(desktop, normalizedLayout, { definitions });
  }

  const nextLayout = normalizedLayout.map(w =>
    w.id === widgetId ? { ...w, enabled: true } : w
  );

  const pages = normalizePages(desktop?.pages);
  const targetPageId = pages.some(p => p.id === pageId) ? pageId : 'all';
  const filteredPlacements = (Array.isArray(desktop?.placements) ? desktop.placements : []).filter(
    p => !(p && p.kind === 'widget' && p.id === widgetId)
  );
  const pageCount = filteredPlacements.filter(p => p && p.pageId === targetPageId).length;

  filteredPlacements.push({
    kind: 'widget',
    id: widgetId,
    pageId: targetPageId,
    order: pageCount,
  });

  return reconcileDesktopWithLayout(
    {
      schemaVersion: desktop?.schemaVersion || 1,
      pages,
      placements: filteredPlacements,
      ...(Array.isArray(desktop?.folders) ? { folders: structuredClone(desktop.folders) } : {}),
    },
    nextLayout,
    { fallbackPages: pages, definitions }
  );
}

export function disableWidget(
  { layout, desktop },
  widgetId,
  { definitions = DEFAULT_WIDGET_DEFINITIONS } = {}
) {
  const normalizedLayout = normalizeWidgetLayout(layout, definitions).map(w =>
    w.id === widgetId ? { ...w, enabled: false } : w
  );
  const pages = normalizePages(desktop?.pages);
  const filteredPlacements = (Array.isArray(desktop?.placements) ? desktop.placements : []).filter(
    p => !(p && p.kind === 'widget' && p.id === widgetId)
  );

  return reconcileDesktopWithLayout(
    {
      schemaVersion: desktop?.schemaVersion || 1,
      pages,
      placements: filteredPlacements,
      ...(Array.isArray(desktop?.folders) ? { folders: structuredClone(desktop.folders) } : {}),
    },
    normalizedLayout,
    { fallbackPages: pages, definitions }
  );
}

export function addSitePlacement(desktop, { siteId, pageId = 'all' }) {
  if (!desktop || !isValidPlacementId(siteId)) return desktop;
  const pages = normalizePages(desktop.pages);
  const targetPageId = pages.some(p => p.id === pageId) ? pageId : 'all';
  const currentList = getPagePlacements(desktop, targetPageId);
  if (currentList.some(item => item.kind === 'site' && item.id === siteId)) {
    return desktop;
  }
  // Also check if siteId is already inside a folder on targetPageId
  if (Array.isArray(desktop.folders)) {
    const pageFolderIds = new Set(
      currentList.filter(item => item.kind === 'folder').map(item => item.id)
    );
    for (const folder of desktop.folders) {
      if (pageFolderIds.has(folder.id) && Array.isArray(folder.siteIds) && folder.siteIds.includes(siteId)) {
        return desktop;
      }
    }
  }
  const nextPageItems = [
    ...currentList,
    {
      kind: 'site',
      id: siteId,
      pageId: targetPageId,
      order: currentList.length,
    },
  ];
  return rebuildPlacementsFromPageItems(desktop, targetPageId, nextPageItems);
}

export function removeSitePlacements(desktop, siteId) {
  if (!desktop || !isValidPlacementId(siteId)) return desktop;
  const pages = normalizePages(desktop.pages);
  const nextPlacements = [];

  for (const page of pages) {
    const list = getPagePlacements(desktop, page.id).filter(
      item => !(item.kind === 'site' && item.id === siteId)
    );
    list.forEach((item, idx) => {
      nextPlacements.push({
        kind: item.kind,
        id: item.id,
        pageId: page.id,
        order: idx,
      });
    });
  }

  let nextFolders = undefined;
  if (Array.isArray(desktop.folders)) {
    nextFolders = structuredClone(desktop.folders).map(folder => ({
      ...folder,
      siteIds: Array.isArray(folder.siteIds)
        ? folder.siteIds.filter(sId => sId !== siteId)
        : [],
    }));
  }

  return buildDesktopResult(desktop, pages, nextPlacements, nextFolders);
}

export function addDesktopPage(desktop, newPage) {
  if (!desktop || !newPage) return desktop;
  const currentPages = normalizePages(desktop.pages);
  if (currentPages.length >= MAX_DESKTOP_PAGES) return desktop;
  const rawId = String(newPage.id || '').trim();
  if (!isValidCustomPageId(rawId) || currentPages.some(p => p.id === rawId)) {
    return desktop;
  }

  const nextPages = normalizePages([
    ...currentPages,
    {
      id: rawId,
      title: String(newPage.title || '自定义页').trim().slice(0, 14) || '自定义页',
      icon: sanitizePageIcon(newPage.icon, 'sparkles'),
      isSystem: false,
      order: currentPages.length,
    },
  ]);

  return buildDesktopResult(desktop, nextPages, desktop.placements || []);
}

export function renameDesktopPage(desktop, { pageId, title, icon }) {
  if (!desktop || !pageId) return desktop;
  const cleanTitle = String(title || '').trim().slice(0, 14);
  if (!cleanTitle) return desktop;

  const pages = normalizePages(desktop.pages).map(page => {
    if (page.id !== pageId) return page;
    return {
      ...page,
      title: cleanTitle,
      icon: icon !== undefined ? sanitizePageIcon(icon, page.icon) : page.icon,
    };
  });

  return buildDesktopResult(desktop, pages, desktop.placements || []);
}

export function deleteDesktopPage(desktop, pageId, fallbackPageId = 'all') {
  if (!desktop || !pageId || SYSTEM_PAGE_IDS.has(pageId)) return desktop;
  const currentPages = normalizePages(desktop.pages);
  if (!currentPages.some(p => p.id === pageId && !p.isSystem)) return desktop;

  const removedPageItems = getPagePlacements(desktop, pageId);
  const remainingPages = currentPages
    .filter(p => p.id !== pageId)
    .map((p, idx) => ({ ...p, order: idx }));

  const targetFallbackId = remainingPages.some(p => p.id === fallbackPageId) ? fallbackPageId : 'all';
  const folders = Array.isArray(desktop.folders) ? structuredClone(desktop.folders) : undefined;
  const nextPlacements = [];

  for (const page of remainingPages) {
    const list = getPagePlacements(desktop, page.id);
    if (page.id === targetFallbackId) {
      const existingKeys = new Set(list.map(item => `${item.kind}:${item.id}`));
      for (const orphan of removedPageItems) {
        const key = `${orphan.kind}:${orphan.id}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          list.push({
            kind: orphan.kind,
            id: orphan.id,
            pageId: targetFallbackId,
            order: list.length,
          });
        }
      }
    }
    list.forEach((item, idx) => {
      if (nextPlacements.length < MAX_DESKTOP_PLACEMENTS) {
        nextPlacements.push({
          kind: item.kind,
          id: item.id,
          pageId: page.id,
          order: idx,
        });
      }
    });
  }

  return buildDesktopResult(desktop, remainingPages, nextPlacements, folders);
}
