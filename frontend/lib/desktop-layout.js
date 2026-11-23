import {
  DEFAULT_WIDGET_DEFINITIONS,
  createDefaultWidgetState,
  getDefaultSizeForWidgetType,
  normalizeWidgetSize,
} from './feature-client.js';
import { safeHttpUrl } from './dom.js';
import {
  MIN_CELL_ROW,
  MAX_CELL_ROW,
  MIN_CELL_COLUMN,
  MAX_CELL_COLUMN,
  FIXED_CELL_KINDS,
  isFixedCellCapableKind,
  isValidPlacementCell,
  normalizePlacementCell,
  formatCellKey,
  attachOptionalPlacementCell,
} from './desktop-cells.js';
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
  MIN_CELL_ROW,
  MAX_CELL_ROW,
  MIN_CELL_COLUMN,
  MAX_CELL_COLUMN,
  FIXED_CELL_KINDS,
  isFixedCellCapableKind,
  isValidPlacementCell,
  normalizePlacementCell,
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
        ...(Object.hasOwn(item, 'size') ? { size: normalizeWidgetSize(item.size, type, defs) } : {}),
        config:
          item.config && typeof item.config === 'object'
            ? structuredClone(item.config)
            : structuredClone(def.defaultConfig || {}),
      });
    }
  }

  for (const def of defs) {
    // Opt-in (defaultEnabled:false) daily widgets are never appended until the user adds one;
    // their first row is created by enableWidgetOnPage.
    if (def?.defaultEnabled === false) continue;
    if (!seenIds.has(def.type)) {
      seenIds.add(def.type);
      list.push({
        id: def.type,
        type: def.type,
        enabled: !hasExplicitLayout && def.defaultEnabled !== false,
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
    const pageChanged = entry.pageId !== pageId;
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

    const normalizedCell = !pageChanged ? normalizePlacementCell(entry.cell, kind) : null;
    pageSeen.add(key);
    perPageBuckets.get(pageId).push({
      kind,
      id,
      pageId,
      ...(normalizedCell ? { cell: normalizedCell } : {}),
    });
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
    const finalPageSeenCells = new Set();
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
      placements.push(
        attachOptionalPlacementCell(
          {
            kind: item.kind,
            id: item.id,
            pageId: page.id,
            order: order++,
          },
          item.cell,
          finalPageSeenCells
        )
      );
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
  omitHomeSiteIds = [],
} = {}) {
  const normalizedPages = normalizePages(pages, DEFAULT_SYSTEM_PAGES);
  const normalizedLayout = normalizeWidgetLayout(layout, definitions);
  const omitHomeSet = new Set(
    omitHomeSiteIds instanceof Set || Array.isArray(omitHomeSiteIds)
      ? Array.from(omitHomeSiteIds, id => String(id || '').trim()).filter(Boolean)
      : []
  );
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
    if (!isValidPlacementId(siteId) || omitHomeSet.has(siteId)) continue;
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

function normalizeUrlForDefaultSiteComparison(rawUrl) {
  const safe = safeHttpUrl(rawUrl);
  if (safe) return safe;
  return String(rawUrl || '').trim();
}

export function doesSitesMatchDefaultSnapshot(sites = [], defaultSites = []) {
  if (!Array.isArray(sites) || !Array.isArray(defaultSites)) return false;
  if (sites.length !== defaultSites.length) return false;
  for (let i = 0; i < defaultSites.length; i++) {
    const cur = sites[i];
    const def = defaultSites[i];
    if (!cur || typeof cur !== 'object' || !def || typeof def !== 'object') return false;
    if (String(cur.id || '').trim() !== String(def.id || '').trim()) return false;
    if (String(cur.title || '').trim() !== String(def.title || '').trim()) return false;
    if (String(cur.category || '').trim() !== String(def.category || '').trim()) return false;
    if (normalizeUrlForDefaultSiteComparison(cur.url) !== normalizeUrlForDefaultSiteComparison(def.url)) {
      return false;
    }
    if (Boolean(cur.pinned) !== Boolean(def.pinned)) return false;
  }
  return true;
}

export function doesDesktopMatchLegacyDefaultSnapshot(
  desktop,
  {
    pages = DEFAULT_SYSTEM_PAGES,
    sites = [],
    defaultPages = DEFAULT_SYSTEM_PAGES,
    defaultSites = [],
    definitions = DEFAULT_WIDGET_DEFINITIONS,
    omitHomeSiteIds = [],
    hasUnsyncedLayout = false,
    hasRestoreMarker = false,
  } = {}
) {
  if (hasUnsyncedLayout || hasRestoreMarker) return false;
  if (!desktop || typeof desktop !== 'object') return false;
  if (Array.isArray(desktop.folders) && desktop.folders.length > 0) return false;
  if (!doesSitesMatchDefaultSnapshot(sites, defaultSites)) return false;

  const defs = Array.isArray(definitions) && definitions.length > 0
    ? definitions
    : DEFAULT_WIDGET_DEFINITIONS;
  const legacyDefault = migrateLegacyDesktop({
    pages: defaultPages,
    sites: defaultSites,
    layout: createDefaultWidgetState(defs).layout,
    definitions: defs,
    omitHomeSiteIds,
  }).desktop;

  const checkPagesMatch = (candidatePages) => {
    if (!Array.isArray(candidatePages) || candidatePages.length !== legacyDefault.pages.length) {
      return false;
    }
    for (let i = 0; i < legacyDefault.pages.length; i++) {
      const p = candidatePages[i];
      const d = legacyDefault.pages[i];
      if (!p || typeof p !== 'object') return false;
      if (
        p.id !== d.id ||
        p.title !== d.title ||
        p.icon !== d.icon ||
        Boolean(p.isSystem) !== Boolean(d.isSystem) ||
        Number(p.order) !== Number(d.order)
      ) {
        return false;
      }
    }
    return true;
  };

  if (!checkPagesMatch(desktop.pages)) return false;
  if (Array.isArray(pages) && pages.length > 0 && !checkPagesMatch(pages)) return false;

  if (
    !Array.isArray(desktop.placements) ||
    desktop.placements.length !== legacyDefault.placements.length
  ) {
    return false;
  }

  for (let i = 0; i < legacyDefault.placements.length; i++) {
    const p = desktop.placements[i];
    const d = legacyDefault.placements[i];
    if (!p || typeof p !== 'object') return false;
    if (
      p.kind !== d.kind ||
      p.id !== d.id ||
      p.pageId !== d.pageId ||
      Number(p.order) !== Number(d.order) ||
      Boolean(p.cell) !== Boolean(d.cell)
    ) {
      return false;
    }
  }

  return true;
}

export function applyDefaultWidgetSizesToPristineDesktop(
  desktop,
  layout,
  options = {}
) {
  if (!Array.isArray(layout)) return layout;
  if (!doesDesktopMatchLegacyDefaultSnapshot(desktop, options)) {
    return layout;
  }

  const definitions =
    Array.isArray(options?.definitions) && options.definitions.length > 0
      ? options.definitions
      : DEFAULT_WIDGET_DEFINITIONS;

  let changed = false;
  const nextLayout = layout.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const type = String(item.type || '').trim();
    const id = String(item.id || '').trim();
    if (!type || id !== type || item.enabled === false) {
      return item;
    }
    if (Object.hasOwn(item, 'size') && item.size !== undefined) {
      return item;
    }
    const defaultSize = getDefaultSizeForWidgetType(type, definitions);
    if (!defaultSize) {
      return item;
    }
    changed = true;
    const { config, ...fields } = item;
    return {
      ...fields,
      size: defaultSize,
      config,
    };
  });

  return changed ? nextLayout : layout;
}

export function stripDefaultSitePlacementsFromHomePage(
  desktop,
  layout = [],
  {
    defaultSites = [],
    fallbackPages = DEFAULT_SYSTEM_PAGES,
    definitions = DEFAULT_WIDGET_DEFINITIONS,
  } = {}
) {
  if (!desktop || typeof desktop !== 'object') {
    return reconcileDesktopWithLayout(desktop, layout, { fallbackPages, definitions });
  }
  const presetSiteIds = new Set(
    (Array.isArray(defaultSites) ? defaultSites : [])
      .map(s => String(s?.id || '').trim())
      .filter(Boolean)
  );
  const filteredPlacements = (Array.isArray(desktop.placements) ? desktop.placements : []).filter(
    p => !(p && p.pageId === 'all' && p.kind === 'site' && presetSiteIds.has(String(p.id || '').trim()))
  );
  return reconcileDesktopWithLayout(
    {
      ...desktop,
      placements: filteredPlacements,
    },
    layout,
    { fallbackPages, definitions }
  );
}

export function getPagePlacements(desktop, pageId) {
  if (!desktop || !Array.isArray(desktop.placements)) return [];
  return desktop.placements
    .filter(p => p && p.pageId === pageId)
    .map((p) => {
      const cell = normalizePlacementCell(p.cell, p.kind);
      return cell ? { ...p, cell } : { ...p };
    })
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
      const cell = normalizePlacementCell(placement.cell, 'site');
      items.push({
        kind: 'site',
        id: placement.id,
        pageId,
        order: placement.order,
        ...(cell ? { cell } : {}),
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
      const cell = normalizePlacementCell(placement.cell, 'widget');
      items.push({
        kind: 'widget',
        id: placement.id,
        pageId,
        order: placement.order,
        ...(cell ? { cell } : {}),
        widget,
      });
    }
  }
  return items;
}

function normalizePlacementsForDesktopResult(pages, rawPlacements) {
  const validPageIds = new Set(pages.map((p) => p.id));
  const perPageSeenKeys = new Map(pages.map((p) => [p.id, new Set()]));
  const perPageSeenCells = new Map(pages.map((p) => [p.id, new Set()]));
  const result = [];

  for (const raw of Array.isArray(rawPlacements) ? rawPlacements : []) {
    if (!raw || typeof raw !== 'object') continue;
    if (result.length >= MAX_DESKTOP_PLACEMENTS) break;
    const kind =
      raw.kind === 'widget'
        ? 'widget'
        : raw.kind === 'folder'
          ? 'folder'
          : raw.kind === 'site'
            ? 'site'
            : null;
    const id = String(raw.id || '').trim();
    if (!kind || !isValidPlacementId(id)) continue;
    const pageId = validPageIds.has(raw.pageId) ? raw.pageId : 'all';
    const pageChanged = raw.pageId !== pageId;
    const seenKeys = perPageSeenKeys.get(pageId);
    const seenCells = perPageSeenCells.get(pageId);
    const key = `${kind}:${id}`;
    if (!seenKeys || seenKeys.has(key)) continue;
    seenKeys.add(key);

    result.push(
      attachOptionalPlacementCell(
        {
          kind,
          id,
          pageId,
          order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : result.length,
        },
        pageChanged ? null : raw.cell,
        seenCells
      )
    );
  }

  // Reindex order sequentially per page while keeping relative order
  const grouped = new Map(pages.map((p) => [p.id, []]));
  for (const p of result) {
    grouped.get(p.pageId)?.push(p);
  }
  const ordered = [];
  for (const page of pages) {
    const list = (grouped.get(page.id) || []).sort((a, b) => Number(a.order) - Number(b.order));
    list.forEach((entry, idx) => {
      ordered.push({
        ...entry,
        ...(entry.cell ? { cell: { row: entry.cell.row, column: entry.cell.column } } : {}),
        order: idx,
      });
    });
  }
  return ordered;
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

  const sanitizedPlacements = normalizePlacementsForDesktopResult(pages, placements);

  const candidate = isV2
    ? {
        schemaVersion: 2,
        pages,
        placements: sanitizedPlacements,
        folders: Array.isArray(resolvedFolders) ? resolvedFolders : [],
      }
    : {
        schemaVersion: 1,
        pages,
        placements: sanitizedPlacements,
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
    const seenCells = new Set();
    let order = 0;
    for (const item of list) {
      if (!item || !isValidPlacementId(item.id)) continue;
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nextPlacements.push(
        attachOptionalPlacementCell(
          {
            kind: item.kind,
            id: item.id,
            pageId: page.id,
            order: order++,
          },
          item.cell,
          seenCells
        )
      );
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
        // Moved across pages onto a page that already held a placement for this item: clear old pin
        const { cell: _clearedCell, ...existingUnpinned } = list[existingIdx];
        list[existingIdx] = existingUnpinned;
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

    const seenCells = new Set();
    list.forEach((item, idx) => {
      if (nextPlacements.length < MAX_DESKTOP_PLACEMENTS) {
        nextPlacements.push(
          attachOptionalPlacementCell(
            {
              kind: item.kind,
              id: item.id,
              pageId: page.id,
              order: idx,
            },
            item.cell,
            seenCells
          )
        );
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
    let preservedCell = null;
    if (fromPageId === toPageId && page.id === toPageId && isFixedCellCapableKind(kind)) {
      const existingSamePage = list.find(item => item.kind === kind && item.id === id);
      preservedCell = normalizePlacementCell(existingSamePage?.cell, kind);
    }

    if (kind === 'widget' || kind === 'folder') {
      list = list.filter(item => !(item.kind === kind && item.id === id));
    } else if (page.id === fromPageId || page.id === toPageId) {
      list = list.filter(item => !(item.kind === 'site' && item.id === id));
    }

    if (page.id === toPageId) {
      deduplicateMovedItemOnTargetPage(desktop, { toPageId, kind, id, list, folders });
      const movedEntry = {
        kind,
        id,
        pageId: toPageId,
        order: list.length,
        ...(preservedCell ? { cell: preservedCell } : {}),
      };
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

    const seenCells = new Set();
    list.forEach((item, idx) => {
      if (nextPlacements.length < MAX_DESKTOP_PLACEMENTS) {
        nextPlacements.push(
          attachOptionalPlacementCell(
            {
              kind: item.kind,
              id: item.id,
              pageId: page.id,
              order: idx,
            },
            item.cell,
            seenCells
          )
        );
      }
    });
  }

  return buildDesktopResult(desktop, pages, nextPlacements, folders);
}

export function setDesktopItemCell(
  desktop,
  { fromPageId = null, toPageId = fromPageId, kind, id, cell } = {}
) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanId = String(id || '').trim();
  if (!isFixedCellCapableKind(kind) || !isValidPlacementId(cleanId)) {
    return desktop;
  }

  const isClearing = cell === null;
  const normalizedCell = isClearing ? null : normalizePlacementCell(cell, kind);
  if (!isClearing && !normalizedCell) {
    return desktop;
  }

  const pages = normalizePages(desktop.pages);
  const placements = Array.isArray(desktop.placements) ? desktop.placements : [];

  let resolvedFromPageId = fromPageId ? String(fromPageId).trim() : '';
  if (kind === 'widget' && !resolvedFromPageId) {
    const existingWidgetPlacement = placements.find(
      p => p && p.kind === 'widget' && p.id === cleanId
    );
    if (!existingWidgetPlacement) {
      return desktop;
    }
    resolvedFromPageId = String(existingWidgetPlacement.pageId || '').trim();
  }
  if (!resolvedFromPageId || !pages.some(p => p.id === resolvedFromPageId)) {
    return desktop;
  }

  const sourcePageList = getPagePlacements(desktop, resolvedFromPageId);
  const sourceIdx = sourcePageList.findIndex(
    item => item.kind === kind && item.id === cleanId
  );
  if (sourceIdx === -1) {
    return desktop;
  }

  if (isClearing) {
    const currentCell = normalizePlacementCell(sourcePageList[sourceIdx].cell, kind);
    if (!currentCell) {
      return desktop;
    }
    const nextSourceItems = sourcePageList.map((item, idx) => {
      if (idx !== sourceIdx) return item;
      const { cell: _prevCell, ...rest } = item;
      return rest;
    });
    return rebuildPlacementsFromPageItems(desktop, resolvedFromPageId, nextSourceItems);
  }

  const resolvedToPageId = toPageId ? String(toPageId).trim() : resolvedFromPageId;
  if (!resolvedToPageId || !pages.some(p => p.id === resolvedToPageId)) {
    return desktop;
  }

  const workingDesktop =
    resolvedFromPageId !== resolvedToPageId
      ? movePlacementToPage(desktop, {
          fromPageId: resolvedFromPageId,
          toPageId: resolvedToPageId,
          kind,
          id: cleanId,
        })
      : desktop;

  const targetPageList = getPagePlacements(workingDesktop, resolvedToPageId);
  const targetIdx = targetPageList.findIndex(
    item => item.kind === kind && item.id === cleanId
  );
  if (targetIdx === -1) {
    return desktop;
  }

  const desiredKey = formatCellKey(normalizedCell);
  const duplicateExists = targetPageList.some((item, idx) => {
    if (idx === targetIdx) return false;
    const otherCell = normalizePlacementCell(item.cell, item.kind);
    return otherCell && formatCellKey(otherCell) === desiredKey;
  });
  if (duplicateExists) {
    return desktop;
  }

  const currentCell = normalizePlacementCell(targetPageList[targetIdx].cell, kind);
  if (
    workingDesktop === desktop &&
    currentCell &&
    currentCell.row === normalizedCell.row &&
    currentCell.column === normalizedCell.column
  ) {
    return desktop;
  }

  const nextTargetPageItems = targetPageList.map((item, idx) => {
    if (idx !== targetIdx) return item;
    const { cell: _prevCell, ...rest } = item;
    return { ...rest, cell: normalizedCell };
  });

  return rebuildPlacementsFromPageItems(workingDesktop, resolvedToPageId, nextTargetPageItems);
}

export function applyDesktopCellDrop(
  desktop,
  { fromPageId = null, toPageId = fromPageId, kind, id, cell, moves = [] } = {}
) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanId = String(id || '').trim();
  if (!isFixedCellCapableKind(kind) || !isValidPlacementId(cleanId)) {
    return desktop;
  }

  const normalizedCell = normalizePlacementCell(cell, kind);
  if (!normalizedCell) {
    return desktop;
  }
  if (!Array.isArray(moves)) {
    return desktop;
  }

  const pages = normalizePages(desktop.pages);
  const placements = Array.isArray(desktop.placements) ? desktop.placements : [];

  let resolvedFromPageId = fromPageId ? String(fromPageId).trim() : '';
  if (kind === 'widget' && !resolvedFromPageId) {
    const existingWidgetPlacement = placements.find(
      (p) => p && p.kind === 'widget' && p.id === cleanId
    );
    if (!existingWidgetPlacement) {
      return desktop;
    }
    resolvedFromPageId = String(existingWidgetPlacement.pageId || '').trim();
  }
  if (!resolvedFromPageId || !pages.some((p) => p.id === resolvedFromPageId)) {
    return desktop;
  }

  const resolvedToPageId = toPageId ? String(toPageId).trim() : resolvedFromPageId;
  if (!resolvedToPageId || !pages.some((p) => p.id === resolvedToPageId)) {
    return desktop;
  }

  const sourcePageList = getPagePlacements(desktop, resolvedFromPageId);
  const sourceExists = sourcePageList.some((item) => item.kind === kind && item.id === cleanId);
  if (!sourceExists) {
    return desktop;
  }

  const mainKey = `${kind}:${cleanId}`;
  const seenChangeKeys = new Set([mainKey]);
  const normalizedMoves = [];

  for (const rawMove of moves) {
    if (!rawMove || typeof rawMove !== 'object') {
      return desktop;
    }
    const moveKind = rawMove.kind;
    const moveId = String(rawMove.id || '').trim();
    if (!isFixedCellCapableKind(moveKind) || !isValidPlacementId(moveId)) {
      return desktop;
    }
    const moveCell = normalizePlacementCell(rawMove.cell, moveKind);
    if (!moveCell) {
      return desktop;
    }
    const moveKey = `${moveKind}:${moveId}`;
    if (seenChangeKeys.has(moveKey)) {
      return desktop;
    }
    seenChangeKeys.add(moveKey);
    normalizedMoves.push({
      key: moveKey,
      kind: moveKind,
      id: moveId,
      cell: moveCell,
    });
  }

  const workingDesktop =
    resolvedFromPageId !== resolvedToPageId
      ? movePlacementToPage(desktop, {
          fromPageId: resolvedFromPageId,
          toPageId: resolvedToPageId,
          kind,
          id: cleanId,
        })
      : desktop;

  const targetPageList = getPagePlacements(workingDesktop, resolvedToPageId);
  const targetIndexByKey = new Map();
  targetPageList.forEach((item, idx) => {
    targetIndexByKey.set(`${item.kind}:${item.id}`, idx);
  });

  if (!targetIndexByKey.has(mainKey)) {
    return desktop;
  }
  for (const mv of normalizedMoves) {
    if (!targetIndexByKey.has(mv.key)) {
      return desktop;
    }
  }

  const replacementCellsByKey = new Map([[mainKey, normalizedCell]]);
  for (const mv of normalizedMoves) {
    replacementCellsByKey.set(mv.key, mv.cell);
  }

  // Validate final uniqueness across all resulting cells simultaneously (enables swaps and cycles)
  const finalSeenStarts = new Set();
  let anyCellChanged = workingDesktop !== desktop;

  const nextTargetPageItems = targetPageList.map((item) => {
    const itemKey = `${item.kind}:${item.id}`;
    if (replacementCellsByKey.has(itemKey)) {
      const nextCell = replacementCellsByKey.get(itemKey);
      const prevCell = normalizePlacementCell(item.cell, item.kind);
      if (
        !prevCell ||
        prevCell.row !== nextCell.row ||
        prevCell.column !== nextCell.column
      ) {
        anyCellChanged = true;
      }
      const { cell: _prevCell, ...rest } = item;
      return { ...rest, cell: nextCell };
    }
    return item;
  });

  for (const item of nextTargetPageItems) {
    const finalCell = normalizePlacementCell(item.cell, item.kind);
    if (!finalCell) continue;
    const cellKey = formatCellKey(finalCell);
    if (finalSeenStarts.has(cellKey)) {
      return desktop;
    }
    finalSeenStarts.add(cellKey);
  }

  if (!anyCellChanged) {
    return desktop;
  }

  return rebuildPlacementsFromPageItems(workingDesktop, resolvedToPageId, nextTargetPageItems);
}

export const MAX_WIDGET_LAYOUT_ENTRIES = 24;

export function enableWidgetOnPage(
  { layout, desktop },
  { widgetId, pageId = 'all', definitions = DEFAULT_WIDGET_DEFINITIONS }
) {
  const defs = Array.isArray(definitions) && definitions.length > 0 ? definitions : DEFAULT_WIDGET_DEFINITIONS;
  let normalizedLayout = normalizeWidgetLayout(layout, defs);
  let targetWidget = normalizedLayout.find(w => w.id === widgetId);
  let createdRow = false;
  if (!targetWidget) {
    // First add of an opt-in definition: create its initial row (id = type) with default size/config
    const def = defs.find(d => d && d.type === widgetId);
    if (
      !def ||
      !isValidPlacementId(widgetId) ||
      normalizedLayout.length >= MAX_WIDGET_LAYOUT_ENTRIES
    ) {
      return {
        ...reconcileDesktopWithLayout(desktop, normalizedLayout, { definitions: defs }),
        added: false,
        reason: !def ? 'unknown-type' : 'layout-full',
      };
    }
    const initialSize = getDefaultSizeForWidgetType(def.type, defs);
    targetWidget = {
      id: def.type,
      type: def.type,
      enabled: false,
      order: normalizedLayout.length,
      ...(initialSize ? { size: initialSize } : {}),
      config: structuredClone(def.defaultConfig || {}),
    };
    normalizedLayout = [...normalizedLayout, targetWidget];
    createdRow = true;
  }

  // Daily (on-demand, defaultEnabled:false) widgets get their registry default size on first placement
  // so e.g. date-tile (single/square) never renders with an unsupported legacy compact fallback.
  const targetDef = defs.find(d => d && d.type === targetWidget.type);
  const firstPlacementSize =
    !createdRow && targetDef && targetDef.defaultEnabled === false && targetWidget.size === undefined
      ? getDefaultSizeForWidgetType(targetWidget.type, defs)
      : null;
  const nextLayout = normalizedLayout.map(w =>
    w.id === widgetId
      ? { ...w, enabled: true, ...(firstPlacementSize ? { size: firstPlacementSize } : {}) }
      : w
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
    { fallbackPages: pages, definitions: defs }
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
    const seenCells = new Set();
    list.forEach((item, idx) => {
      nextPlacements.push(
        attachOptionalPlacementCell(
          {
            kind: item.kind,
            id: item.id,
            pageId: page.id,
            order: idx,
          },
          item.cell,
          seenCells
        )
      );
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
          // Orphans change page from deleted pageId to targetFallbackId: clear old pin
          list.push({
            kind: orphan.kind,
            id: orphan.id,
            pageId: targetFallbackId,
            order: list.length,
          });
        }
      }
    }
    const seenCells = new Set();
    list.forEach((item, idx) => {
      if (nextPlacements.length < MAX_DESKTOP_PLACEMENTS) {
        nextPlacements.push(
          attachOptionalPlacementCell(
            {
              kind: item.kind,
              id: item.id,
              pageId: page.id,
              order: idx,
            },
            item.cell,
            seenCells
          )
        );
      }
    });
  }

  return buildDesktopResult(desktop, remainingPages, nextPlacements, folders);
}
