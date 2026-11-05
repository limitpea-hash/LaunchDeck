import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../validation.js';

export function createFeatureStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS feature_documents (
    key TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const select = db.prepare('SELECT revision, payload, updated_at FROM feature_documents WHERE key = ?');
  const save = db.prepare(`INSERT INTO feature_documents (key, revision, payload, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`);
  const countDevices = db.prepare("SELECT COUNT(*) AS count FROM feature_documents WHERE key LIKE 'device:%'");

  function read(key, defaults) {
    const row = select.get(key);
    return row ? { revision: row.revision, state: JSON.parse(row.payload), updatedAt: row.updated_at }
      : { revision: 0, state: defaults(), updatedAt: null };
  }
  return {
    read,
    patch(key, defaults, patch, ifMatch, validate, validateState = () => {}) {
      if (!/^"\d+"$/.test(ifMatch || '')) throw new HttpError(428, '需要通过 If-Match 提交当前数据版本');
      validate(patch);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = read(key, defaults);
        if (ifMatch !== `"${previous.revision}"`) throw new HttpError(409, '数据已在其他页面更新，请重新读取后处理冲突');
        if (key.startsWith('device:') && previous.revision === 0 && countDevices.get().count >= 500) throw new HttpError(503, '设备设置存储已达上限');
        const state = { ...previous.state, ...patch };
        validateState(state, previous.state);
        save.run(key, previous.revision + 1, JSON.stringify(state), new Date().toISOString());
        const result = read(key, defaults);
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

export function deviceKey(req, res) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('agy_device='));
  let token = cookie?.slice('agy_device='.length);
  if (!/^[a-f0-9]{64}$/.test(token || '')) {
    token = randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie', `agy_device=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000${req.socket.encrypted ? '; Secure' : ''}`);
  }
  return `device:${createHash('sha256').update(token).digest('hex')}`;
}
