import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultWidgetState } from '../features/widgets.js';
import { defaultDeviceSettings } from '../features/settings.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function exportWebData({ databasePath = resolve(root, 'backend/data/portal.sqlite'), output } = {}) {
  const destination = resolve(root, output || `backend/extension/dist/agy-web-backup-${Date.now()}.json`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let backup;
  try {
    const portal = db.prepare('SELECT payload FROM portal_state WHERE id = 1').get();
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feature_documents'").get();
    const widgets = table ? db.prepare("SELECT payload FROM feature_documents WHERE key = 'widgets'").get() : null;
    backup = { format: 'agy-new-tab', version: 1, exportedAt: new Date().toISOString(),
      portal: portal ? JSON.parse(portal.payload) : null, widgets: widgets ? JSON.parse(widgets.payload) : defaultWidgetState(), device: defaultDeviceSettings() };
  } finally { db.close(); }
  // Private backups stay outside the extension package and never overwrite another file.
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(await exportWebData({ output: process.argv[2] })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
