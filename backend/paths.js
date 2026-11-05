import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const backendRoot = fileURLToPath(new URL('./', import.meta.url));
export const projectRoot = resolve(backendRoot, '..');

// Prefer the separated frontend. Keep the current page available during migration.
export function resolveFrontendRoot() {
  if (process.env.FRONTEND_DIR) return resolve(projectRoot, process.env.FRONTEND_DIR);
  const frontendRoot = resolve(projectRoot, 'frontend');
  return existsSync(resolve(frontendRoot, 'index.html')) ? frontendRoot : projectRoot;
}
