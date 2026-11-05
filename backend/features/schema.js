import { HttpError } from '../validation.js';

export function check(condition, message) {
  if (!condition) throw new HttpError(400, message);
}

export function record(value, keys, name) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${name}必须是对象`);
  check(Object.keys(value).every(key => keys.includes(key)), `${name}包含未知字段`);
  return value;
}

export function string(value, max, name, allowEmpty = false) {
  check(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0), `${name}格式不正确`);
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), `${name}包含控制字符`);
  return value;
}

export function integer(value, min, max, name) {
  check(Number.isInteger(value) && value >= min && value <= max, `${name}必须是 ${min}–${max} 的整数`);
  return value;
}

export function identifier(value) {
  check(typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value), 'ID 格式不正确');
  return value;
}

export function timeZone(value) {
  string(value, 80, '时区');
  // Accept named time zones, not raw offsets masquerading as time zones.
  check(value === 'UTC' || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value), '请使用 IANA 时区，例如 Asia/Shanghai');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); }
  catch { throw new HttpError(400, '时区不存在'); }
  return value;
}

export function coordinates(value, extraKeys = []) {
  record(value, ['latitude', 'longitude', ...extraKeys], '坐标');
  check(typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90, '纬度必须为 -90–90 的数字');
  check(typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180, '经度必须为 -180–180 的数字');
  return value;
}

export function dateOnly(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '日期必须为 YYYY-MM-DD');
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  check(Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value, '日期不存在');
}
