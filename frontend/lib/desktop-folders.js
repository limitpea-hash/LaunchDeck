const FOLDER_ID_RE = /^folder_[a-zA-Z0-9_-]{1,64}$/;
const SITE_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

export const MAX_DESKTOP_FOLDERS = 200;
export const MIN_FOLDER_SITES = 2;
export const MAX_FOLDER_SITES = 100;
export const MAX_FOLDER_TITLE_LENGTH = 60;
export const DEFAULT_FOLDER_TITLE = '文件夹';

export function isValidFolderId(id) {
  return FOLDER_ID_RE.test(String(id || ''));
}

export function isValidFolderSiteId(id) {
  return SITE_ID_RE.test(String(id || ''));
}

export function sanitizeFolderTitle(rawTitle, fallback = DEFAULT_FOLDER_TITLE) {
  const cleaned = String(rawTitle ?? '')
    .replace(CONTROL_CHARS_RE, '')
    .trim()
    .slice(0, MAX_FOLDER_TITLE_LENGTH);
  return cleaned || fallback;
}

export function generateFolderId(existingIds = new Set()) {
  const seen =
    existingIds instanceof Set
      ? existingIds
      : new Set(Array.isArray(existingIds) ? existingIds : []);
  const baseTs = Date.now().toString(36);
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? Math.random().toString(36).slice(2, 6) : `${attempt}`;
    const candidate = `folder_${baseTs}_${suffix}`.slice(0, 71);
    if (isValidFolderId(candidate) && !seen.has(candidate)) {
      return candidate;
    }
  }
  return `folder_${Date.now()}`;
}

/**
 * Normalizes raw folder records and ensures each valid folder has 2..100 unique valid siteIds.
 */
export function normalizeFolderRecords(rawFolders = []) {
  if (!Array.isArray(rawFolders)) return [];
  const result = [];
  const seenFolderIds = new Set();

  for (const raw of rawFolders) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '').trim();
    if (!isValidFolderId(id) || seenFolderIds.has(id)) continue;

    const rawSiteIds = Array.isArray(raw.siteIds) ? raw.siteIds : [];
    const uniqueSiteIds = [];
    const seenSites = new Set();
    for (const sId of rawSiteIds) {
      const cleanSiteId = String(sId || '').trim();
      if (!isValidFolderSiteId(cleanSiteId) || seenSites.has(cleanSiteId)) continue;
      seenSites.add(cleanSiteId);
      uniqueSiteIds.push(cleanSiteId);
      if (uniqueSiteIds.length >= MAX_FOLDER_SITES) break;
    }

    if (uniqueSiteIds.length < MIN_FOLDER_SITES) continue;

    seenFolderIds.add(id);
    result.push({
      id,
      title: sanitizeFolderTitle(raw.title, DEFAULT_FOLDER_TITLE),
      siteIds: uniqueSiteIds,
    });

    if (result.length >= MAX_DESKTOP_FOLDERS) break;
  }

  return result;
}

function cloneDesktopInput(desktop) {
  if (!desktop || typeof desktop !== 'object') {
    return {
      schemaVersion: 1,
      pages: [],
      placements: [],
      folders: [],
    };
  }
  const hasFolders = Array.isArray(desktop.folders) && desktop.folders.length > 0;
  const schemaVersion =
    Number(desktop.schemaVersion) === 2 || hasFolders ? 2 : 1;
  return {
    schemaVersion,
    pages: Array.isArray(desktop.pages) ? structuredClone(desktop.pages) : [],
    placements: Array.isArray(desktop.placements) ? structuredClone(desktop.placements) : [],
    folders: Array.isArray(desktop.folders) ? structuredClone(desktop.folders) : [],
  };
}

function getPageOrderedPlacements(desktop, pageId) {
  if (!desktop || !Array.isArray(desktop.placements)) return [];
  return desktop.placements
    .filter((p) => p && p.pageId === pageId)
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order));
}

/**
 * Rebuilds a clean desktop object after folder or placement mutations:
 * - Dissolves any folder with 1 remaining site back into its folder placement slot
 * - Removes any folder with 0 sites
 * - Ensures every folder has at most 1 placement across the entire desktop
 * - Ensures within each page, a siteId appears at most once (either in a folder on that page or as a top-level site placement)
 * - Reindexes placement `order` sequentially per page (`0..n-1`)
 * - Sets `schemaVersion: 2` when `folders` is present or input was v2
 */
export function finalizeDesktopFoldersAndPlacements(desktop, { forceV2 = false } = {}) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const draft = cloneDesktopInput(desktop);
  const pages = draft.pages;
  const validPageIds = new Set(pages.map((p) => p.id));

  const folderMap = new Map();
  if (Array.isArray(draft.folders)) {
    for (const f of draft.folders) {
      if (!f || typeof f !== 'object') continue;
      const id = String(f.id || '').trim();
      if (!isValidFolderId(id) || folderMap.has(id)) continue;
      const seenSites = new Set();
      const siteIds = [];
      for (const rawSiteId of Array.isArray(f.siteIds) ? f.siteIds : []) {
        const sId = String(rawSiteId || '').trim();
        if (!isValidFolderSiteId(sId) || seenSites.has(sId)) continue;
        seenSites.add(sId);
        siteIds.push(sId);
        if (siteIds.length >= MAX_FOLDER_SITES) break;
      }
      folderMap.set(id, {
        id,
        title: sanitizeFolderTitle(f.title, DEFAULT_FOLDER_TITLE),
        siteIds,
      });
    }
  }

  const placedFolderIds = new Set();
  const nextPlacements = [];
  const usedFolderIds = new Set();

  for (const page of pages) {
    const rawPageItems = getPageOrderedPlacements(draft, page.id);
    const expandedItems = [];

    for (const item of rawPageItems) {
      if (!item || typeof item !== 'object') continue;
      if (item.kind === 'folder') {
        const fId = String(item.id || '').trim();
        if (!isValidFolderId(fId) || placedFolderIds.has(fId)) continue;
        const folderRec = folderMap.get(fId);
        if (!folderRec || folderRec.siteIds.length === 0) {
          continue;
        }
        if (folderRec.siteIds.length === 1) {
          // Auto-dissolve 1-member folder into its slot
          expandedItems.push({
            kind: 'site',
            id: folderRec.siteIds[0],
            pageId: page.id,
          });
          folderMap.delete(fId);
          continue;
        }
        if (placedFolderIds.size >= MAX_DESKTOP_FOLDERS) continue;
        placedFolderIds.add(fId);
        expandedItems.push({
          kind: 'folder',
          id: fId,
          pageId: page.id,
        });
      } else if (item.kind === 'site' || item.kind === 'widget') {
        const id = String(item.id || '').trim();
        if (!isValidFolderSiteId(id)) continue;
        expandedItems.push({
          kind: item.kind,
          id,
          pageId: page.id,
        });
      }
    }

    // Deduplicate sites within the same page (a site cannot be in two folders on the same page,
    // nor both inside a folder and at top-level on the same page).
    const pageClaimedSites = new Set();
    const cleanedFirstPass = [];

    // First pass: folders claim their member sites in order; if a folder loses sites due to earlier claim,
    // re-check its member count.
    for (const entry of expandedItems) {
      if (entry.kind === 'folder') {
        const folderRec = folderMap.get(entry.id);
        if (!folderRec) continue;
        const filteredSiteIds = folderRec.siteIds.filter((sId) => !pageClaimedSites.has(sId));
        if (filteredSiteIds.length === 0) {
          folderMap.delete(entry.id);
          continue;
        }
        if (filteredSiteIds.length === 1) {
          const singleSiteId = filteredSiteIds[0];
          pageClaimedSites.add(singleSiteId);
          folderMap.delete(entry.id);
          cleanedFirstPass.push({
            kind: 'site',
            id: singleSiteId,
            pageId: page.id,
          });
          continue;
        }
        folderRec.siteIds = filteredSiteIds;
        for (const sId of filteredSiteIds) {
          pageClaimedSites.add(sId);
        }
        usedFolderIds.add(entry.id);
        cleanedFirstPass.push(entry);
      } else {
        cleanedFirstPass.push(entry);
      }
    }

    // Second pass: filter top-level sites that are already claimed by a folder or earlier top-level site on this page
    const pageSeenKeys = new Set();
    let order = 0;
    for (const entry of cleanedFirstPass) {
      if (entry.kind === 'site') {
        if (pageClaimedSites.has(entry.id) && pageSeenKeys.has(`site:${entry.id}`)) {
          continue;
        }
        if (
          cleanedFirstPass.some(
            (other) =>
              other.kind === 'folder' &&
              folderMap.get(other.id)?.siteIds?.includes(entry.id)
          )
        ) {
          continue;
        }
        if (pageSeenKeys.has(`site:${entry.id}`)) continue;
        pageSeenKeys.add(`site:${entry.id}`);
      } else if (entry.kind === 'widget') {
        if (pageSeenKeys.has(`widget:${entry.id}`)) continue;
        pageSeenKeys.add(`widget:${entry.id}`);
      } else if (entry.kind === 'folder') {
        if (pageSeenKeys.has(`folder:${entry.id}`)) continue;
        pageSeenKeys.add(`folder:${entry.id}`);
      }

      nextPlacements.push({
        kind: entry.kind,
        id: entry.id,
        pageId: validPageIds.has(page.id) ? page.id : 'all',
        order: order++,
      });
    }
  }

  const nextFolders = [];
  for (const fId of usedFolderIds) {
    const rec = folderMap.get(fId);
    if (rec && rec.siteIds.length >= MIN_FOLDER_SITES) {
      nextFolders.push({
        id: rec.id,
        title: sanitizeFolderTitle(rec.title, DEFAULT_FOLDER_TITLE),
        siteIds: rec.siteIds.slice(0, MAX_FOLDER_SITES),
      });
    }
  }

  const shouldUseV2 =
    forceV2 || Number(draft.schemaVersion) === 2 || nextFolders.length > 0 || Array.isArray(desktop.folders);

  if (shouldUseV2) {
    return {
      schemaVersion: 2,
      pages,
      placements: nextPlacements,
      folders: nextFolders,
    };
  }

  return {
    schemaVersion: 1,
    pages,
    placements: nextPlacements,
  };
}

/**
 * Creates a new site folder when a site (`draggedSiteId`) is dropped onto the center of another site (`targetSiteId`).
 * - Target site is placed first (`[targetSiteId, draggedSiteId]`)
 * - New folder replaces `targetSiteId`'s original placement slot on `pageId`
 * - If `draggedSiteId` came from another page (`fromPageId`) or from a folder (`fromFolderId`), it is removed from its origin
 */
export function createSiteFolder(
  desktop,
  {
    pageId = 'all',
    fromPageId = pageId,
    fromFolderId = null,
    targetSiteId,
    draggedSiteId,
    folderId = null,
    title = DEFAULT_FOLDER_TITLE,
  } = {}
) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanTargetId = String(targetSiteId || '').trim();
  const cleanDraggedId = String(draggedSiteId || '').trim();
  if (
    !isValidFolderSiteId(cleanTargetId) ||
    !isValidFolderSiteId(cleanDraggedId) ||
    cleanTargetId === cleanDraggedId
  ) {
    return desktop;
  }

  const draft = cloneDesktopInput(desktop);
  const existingFolders = Array.isArray(draft.folders) ? draft.folders : [];
  if (existingFolders.length >= MAX_DESKTOP_FOLDERS) {
    return desktop;
  }

  const targetPageList = getPageOrderedPlacements(draft, pageId);
  const targetIdx = targetPageList.findIndex(
    (item) => item.kind === 'site' && item.id === cleanTargetId
  );
  if (targetIdx === -1) {
    return desktop;
  }

  const existingFolderIds = new Set(existingFolders.map((f) => f.id));
  const resolvedFolderId =
    folderId && isValidFolderId(folderId) && !existingFolderIds.has(folderId)
      ? String(folderId).trim()
      : generateFolderId(existingFolderIds);

  // If dragged site came from a folder, remove it from that source folder first
  if (fromFolderId) {
    const srcFolder = existingFolders.find((f) => f.id === fromFolderId);
    if (srcFolder && Array.isArray(srcFolder.siteIds)) {
      srcFolder.siteIds = srcFolder.siteIds.filter((sId) => sId !== cleanDraggedId);
    }
  }

  // Also remove draggedSiteId from any folder on target pageId (since a site can only be in one place per page)
  const targetPageFolderIds = new Set(
    targetPageList.filter((p) => p.kind === 'folder').map((p) => p.id)
  );
  for (const folder of existingFolders) {
    if (targetPageFolderIds.has(folder.id) && Array.isArray(folder.siteIds)) {
      folder.siteIds = folder.siteIds.filter(
        (sId) => sId !== cleanDraggedId && sId !== cleanTargetId
      );
    }
  }

  const newFolder = {
    id: resolvedFolderId,
    title: sanitizeFolderTitle(title, DEFAULT_FOLDER_TITLE),
    siteIds: [cleanTargetId, cleanDraggedId],
  };
  existingFolders.push(newFolder);

  const nextPlacements = [];
  for (const page of draft.pages) {
    const list = getPageOrderedPlacements(draft, page.id);
    for (const item of list) {
      if (page.id === pageId && item.kind === 'site' && item.id === cleanTargetId) {
        nextPlacements.push({
          kind: 'folder',
          id: resolvedFolderId,
          pageId: page.id,
          order: nextPlacements.length,
        });
        continue;
      }
      if (
        (page.id === pageId || ( page.id === fromPageId && !fromFolderId )) &&
        item.kind === 'site' &&
        item.id === cleanDraggedId
      ) {
        continue;
      }
      nextPlacements.push({
        kind: item.kind,
        id: item.id,
        pageId: page.id,
        order: nextPlacements.length,
      });
    }
  }

  draft.placements = nextPlacements;
  draft.folders = existingFolders;
  return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
}

/**
 * Adds a site (`siteId` / `draggedSiteId`) into an existing folder (`folderId`).
 */
export function addSiteToFolder(
  desktop,
  {
    folderId,
    siteId,
    draggedSiteId = siteId,
    fromPageId = null,
    fromFolderId = null,
    beforeSiteId = null,
  } = {}
) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanFolderId = String(folderId || '').trim();
  const cleanSiteId = String(draggedSiteId || siteId || '').trim();
  if (!isValidFolderId(cleanFolderId) || !isValidFolderSiteId(cleanSiteId)) {
    return desktop;
  }
  if (fromFolderId === cleanFolderId) {
    return reorderFolderSite(desktop, {
      folderId: cleanFolderId,
      siteId: cleanSiteId,
      beforeSiteId,
    });
  }

  const draft = cloneDesktopInput(desktop);
  const targetFolder = draft.folders.find((f) => f.id === cleanFolderId);
  if (!targetFolder) return desktop;
  if (
    !targetFolder.siteIds.includes(cleanSiteId) &&
    targetFolder.siteIds.length >= MAX_FOLDER_SITES
  ) {
    return desktop;
  }

  const folderPlacement = draft.placements.find(
    (p) => p && p.kind === 'folder' && p.id === cleanFolderId
  );
  const targetPageId = folderPlacement?.pageId || 'all';

  // Remove from source folder if any
  if (fromFolderId && fromFolderId !== cleanFolderId) {
    const srcFolder = draft.folders.find((f) => f.id === fromFolderId);
    if (srcFolder && Array.isArray(srcFolder.siteIds)) {
      srcFolder.siteIds = srcFolder.siteIds.filter((sId) => sId !== cleanSiteId);
    }
  }

  // Remove from any other folder on the same target page
  const samePageFolderIds = new Set(
    draft.placements
      .filter((p) => p && p.pageId === targetPageId && p.kind === 'folder' && p.id !== cleanFolderId)
      .map((p) => p.id)
  );
  for (const f of draft.folders) {
    if (samePageFolderIds.has(f.id) && Array.isArray(f.siteIds)) {
      f.siteIds = f.siteIds.filter((sId) => sId !== cleanSiteId);
    }
  }

  // Remove top-level placement of cleanSiteId on targetPageId and fromPageId
  draft.placements = draft.placements.filter((p) => {
    if (!p) return false;
    if (
      p.kind === 'site' &&
      p.id === cleanSiteId &&
      (p.pageId === targetPageId || (fromPageId && p.pageId === fromPageId && !fromFolderId))
    ) {
      return false;
    }
    return true;
  });

  const existingSiteIds = targetFolder.siteIds.filter((sId) => sId !== cleanSiteId);
  if (beforeSiteId && existingSiteIds.includes(beforeSiteId)) {
    const anchorIdx = existingSiteIds.indexOf(beforeSiteId);
    existingSiteIds.splice(anchorIdx, 0, cleanSiteId);
  } else {
    existingSiteIds.push(cleanSiteId);
  }
  targetFolder.siteIds = existingSiteIds.slice(0, MAX_FOLDER_SITES);

  return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
}

/**
 * Renames a folder with strict 1..60 trimmed plain-text validation (no control chars).
 */
export function renameSiteFolder(desktop, { folderId, title } = {}) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanFolderId = String(folderId || '').trim();
  const cleanTitle = sanitizeFolderTitle(title, '');
  if (!isValidFolderId(cleanFolderId) || !cleanTitle) {
    return desktop;
  }

  const draft = cloneDesktopInput(desktop);
  const targetFolder = draft.folders.find((f) => f.id === cleanFolderId);
  if (!targetFolder) return desktop;
  targetFolder.title = cleanTitle;

  return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
}

/**
 * Reorders a member site inside a folder using either `beforeSiteId`, `targetSiteId`, or `delta` (`-1` / `+1`).
 */
export function reorderFolderSite(
  desktop,
  {
    folderId,
    siteId,
    draggedSiteId = siteId,
    targetSiteId = null,
    beforeSiteId = undefined,
    delta = null,
  } = {}
) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanFolderId = String(folderId || '').trim();
  const cleanSiteId = String(draggedSiteId || siteId || '').trim();
  if (!isValidFolderId(cleanFolderId) || !isValidFolderSiteId(cleanSiteId)) {
    return desktop;
  }

  const draft = cloneDesktopInput(desktop);
  const folder = draft.folders.find((f) => f.id === cleanFolderId);
  if (!folder || !Array.isArray(folder.siteIds)) return desktop;

  const list = folder.siteIds.slice();
  const fromIdx = list.indexOf(cleanSiteId);
  if (fromIdx === -1) return desktop;

  if (typeof delta === 'number' && delta !== 0) {
    const toIdx = fromIdx + delta;
    if (toIdx < 0 || toIdx >= list.length) return desktop;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    folder.siteIds = list;
    return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
  }

  if (beforeSiteId !== undefined) {
    if (beforeSiteId === cleanSiteId) return desktop;
    list.splice(fromIdx, 1);
    if (beforeSiteId === null) {
      list.push(cleanSiteId);
    } else {
      const anchorIdx = list.indexOf(String(beforeSiteId));
      if (anchorIdx !== -1) {
        list.splice(anchorIdx, 0, cleanSiteId);
      } else {
        list.push(cleanSiteId);
      }
    }
    folder.siteIds = list;
    return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
  }

  if (targetSiteId && targetSiteId !== cleanSiteId) {
    const toIdx = list.indexOf(String(targetSiteId));
    if (toIdx === -1 || toIdx === fromIdx) return desktop;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    folder.siteIds = list;
    return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
  }

  return desktop;
}

/**
 * Moves a site out of `folderId` onto a desktop page (`toPageId`) at a specific before-anchor
 * `(beforeKind, beforeId)` (or right after the source folder if on the same page and no anchor is given).
 * If the source folder has only 1 remaining site, it automatically dissolves into the folder's original slot.
 */
export function moveFolderSiteToPage(
  desktop,
  {
    folderId,
    siteId,
    draggedSiteId = siteId,
    toPageId = null,
    beforeKind = undefined,
    beforeId = undefined,
    targetKind = null,
    targetId = null,
  } = {}
) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanFolderId = String(folderId || '').trim();
  const cleanSiteId = String(draggedSiteId || siteId || '').trim();
  if (!isValidFolderId(cleanFolderId) || !isValidFolderSiteId(cleanSiteId)) {
    return desktop;
  }

  const draft = cloneDesktopInput(desktop);
  const folder = draft.folders.find((f) => f.id === cleanFolderId);
  if (!folder || !Array.isArray(folder.siteIds) || !folder.siteIds.includes(cleanSiteId)) {
    return desktop;
  }

  const folderPlacement = draft.placements.find(
    (p) => p && p.kind === 'folder' && p.id === cleanFolderId
  );
  const sourcePageId = folderPlacement?.pageId || 'all';
  const resolvedToPageId =
    toPageId && draft.pages.some((p) => p.id === toPageId) ? toPageId : sourcePageId;

  // Remove site from source folder
  folder.siteIds = folder.siteIds.filter((sId) => sId !== cleanSiteId);

  // Also remove from any folder on target page if moving across pages
  if (resolvedToPageId !== sourcePageId) {
    const targetPageFolderIds = new Set(
      draft.placements
        .filter((p) => p && p.pageId === resolvedToPageId && p.kind === 'folder')
        .map((p) => p.id)
    );
    for (const f of draft.folders) {
      if (targetPageFolderIds.has(f.id) && Array.isArray(f.siteIds)) {
        f.siteIds = f.siteIds.filter((sId) => sId !== cleanSiteId);
      }
    }
  }

  const effectiveBeforeKind = beforeKind !== undefined ? beforeKind : targetKind;
  const effectiveBeforeId = beforeId !== undefined ? beforeId : targetId;

  const pagePlacements = getPageOrderedPlacements(draft, resolvedToPageId).filter(
    (p) => !(p.kind === 'site' && p.id === cleanSiteId)
  );

  const insertedPlacement = {
    kind: 'site',
    id: cleanSiteId,
    pageId: resolvedToPageId,
    order: pagePlacements.length,
  };

  if (effectiveBeforeKind && effectiveBeforeId) {
    const anchorIdx = pagePlacements.findIndex(
      (p) => p.kind === effectiveBeforeKind && p.id === effectiveBeforeId
    );
    if (anchorIdx !== -1) {
      pagePlacements.splice(anchorIdx, 0, insertedPlacement);
    } else {
      pagePlacements.push(insertedPlacement);
    }
  } else if (beforeKind === null && beforeId === null) {
    pagePlacements.push(insertedPlacement);
  } else if (resolvedToPageId === sourcePageId) {
    // Default when extracted on same page without explicit anchor: place right after the folder slot
    const folderIdx = pagePlacements.findIndex(
      (p) => p.kind === 'folder' && p.id === cleanFolderId
    );
    if (folderIdx !== -1) {
      pagePlacements.splice(folderIdx + 1, 0, insertedPlacement);
    } else {
      pagePlacements.push(insertedPlacement);
    }
  } else {
    pagePlacements.push(insertedPlacement);
  }

  const nextPlacements = [];
  for (const page of draft.pages) {
    const list =
      page.id === resolvedToPageId ? pagePlacements : getPageOrderedPlacements(draft, page.id);
    list.forEach((item, idx) => {
      nextPlacements.push({
        kind: item.kind,
        id: item.id,
        pageId: page.id,
        order: idx,
      });
    });
  }

  draft.placements = nextPlacements;
  return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
}

/**
 * Dissolves `folderId` and expands all its member `siteIds` in their original order
 * directly into the folder's placement slot on its page, without deleting any site definitions.
 */
export function dissolveSiteFolder(desktop, { folderId } = {}) {
  if (!desktop || typeof desktop !== 'object') return desktop;
  const cleanFolderId = String(folderId || '').trim();
  if (!isValidFolderId(cleanFolderId)) return desktop;

  const draft = cloneDesktopInput(desktop);
  const folderIdx = draft.folders.findIndex((f) => f.id === cleanFolderId);
  if (folderIdx === -1) return desktop;

  const folder = draft.folders[folderIdx];
  const memberSiteIds = Array.isArray(folder.siteIds) ? folder.siteIds.slice() : [];
  draft.folders.splice(folderIdx, 1);

  const nextPlacements = [];
  for (const page of draft.pages) {
    const list = getPageOrderedPlacements(draft, page.id);
    for (const item of list) {
      if (item.kind === 'folder' && item.id === cleanFolderId) {
        for (const sId of memberSiteIds) {
          nextPlacements.push({
            kind: 'site',
            id: sId,
            pageId: page.id,
            order: nextPlacements.length,
          });
        }
      } else {
        nextPlacements.push({
          kind: item.kind,
          id: item.id,
          pageId: page.id,
          order: nextPlacements.length,
        });
      }
    }
  }

  draft.placements = nextPlacements;
  return finalizeDesktopFoldersAndPlacements(draft, { forceV2: true });
}
