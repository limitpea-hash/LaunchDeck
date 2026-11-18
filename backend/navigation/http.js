import { HttpError } from '../validation.js';
import { defaultWidgetState } from '../features/widgets.js';
import { validateNavigationImportRequest } from './schema.js';
import { mergeNavigationBackup } from './merge.js';

// The existing portal and feature tables share one database/transaction.
export function createNavigationRoutes({ db, readBody, json }) {
  const readPortal = db.prepare('SELECT revision, payload FROM portal_state WHERE id = 1');
  const readFeature = db.prepare('SELECT revision, payload FROM feature_documents WHERE key = ?');
  const updatePortal = db.prepare('UPDATE portal_state SET revision = revision + 1, payload = ?, updated_at = ? WHERE id = 1');
  const saveFeature = db.prepare(`INSERT INTO feature_documents (key, revision, payload, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`);
  return async (req, res, url) => {
    if (!['/api/navigation/browser-data', '/api/navigation/import'].includes(url.pathname)) return false;
    if (url.search) throw new HttpError(400, '导航接口不接受查询参数');
    if (url.pathname.endsWith('/browser-data')) {
      if (req.method !== 'GET') throw new HttpError(405, '请求方法不支持');
      const row = readFeature.get('navigation-browser-data');
      json(res, 200, row ? JSON.parse(row.payload) : { restoreId: null, data: null }); return true;
    }
    if (req.method !== 'POST') throw new HttpError(405, '请求方法不支持');
    const input = validateNavigationImportRequest(await readBody(req, 2 * 1024 * 1024));
    let result;
    db.exec('BEGIN IMMEDIATE');
    try {
      const portal = readPortal.get(), widgets = readFeature.get('widgets');
      const portalRevision = portal?.revision ?? 0, widgetRevision = widgets?.revision ?? 0;
      if (input.portalRevision !== portalRevision || input.widgetRevision !== widgetRevision) throw new HttpError(409, '其他页面已更新数据，请刷新并重新预览备份');
      const merged = mergeNavigationBackup(input.backup, portal ? JSON.parse(portal.payload) : null,
        widgets ? JSON.parse(widgets.payload) : defaultWidgetState());
      const time = new Date().toISOString(), restoreId = crypto.randomUUID();
      updatePortal.run(JSON.stringify(merged.portal), time);
      saveFeature.run('widgets', widgetRevision + 1, JSON.stringify(merged.widgets), time);
      const previous = readFeature.get('navigation-browser-data');
      saveFeature.run('navigation-browser-data', (previous?.revision ?? 0) + 1,
        JSON.stringify({ restoreId, data: merged.browserData }), time);
      db.exec('COMMIT');
      result = { success: true, restoreId, browserData: merged.browserData,
        revisions: { portal: portalRevision + 1, widgets: widgetRevision + 1 } };
    } catch (error) {
      db.exec('ROLLBACK');
      if (error.status) throw error;
      console.error('Navigation transaction failed:', error.code || error.name);
      throw new HttpError(503, '导航恢复未写入，请保留备份并重试');
    }
    json(res, 200, result); return true;
  };
}
