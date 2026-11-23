import { HttpError } from '../validation.js';
import { validateCurrencyPair } from './currencies.js';
import { check, record, string } from './schema.js';

export const IMPORTED_CARD_SIZES = Object.freeze(['single', 'compact', 'square']);
export const IMPORTED_CARD_LEGACY_SIZES = Object.freeze({ wide: 'square' });

const MAX_PACKAGE_BYTES = 16 * 1024;
const CARD_FIELDS = ['type', 'title', 'icon', 'palette', 'layout'];
const TEMPLATE_FIELDS = Object.freeze({ text: ['text'], clock: [], weather: [], currency: ['base', 'quote'] });

export function validateImportedCard(card) {
  const type = card?.type;
  check(typeof type === 'string' && Object.hasOwn(TEMPLATE_FIELDS, type), '组件模板不受支持');
  record(card, [...CARD_FIELDS, ...TEMPLATE_FIELDS[type]], '自定义组件');
  string(card.title, 60, '组件标题');
  check(['note', 'clock', 'cloud', 'currency', 'sparkles'].includes(card.icon), '请选择内置图标');
  check(['indigo', 'teal', 'amber', 'slate', 'rose'].includes(card.palette), '请选择内置配色');
  check(['stacked', 'split'].includes(card.layout), '组件卡面布局不受支持');
  if (type === 'text') string(card.text, 240, '组件文字');
  if (type === 'currency') validateCurrencyPair({ base: card.base, quote: card.quote });
  return card;
}

export async function readWidgetPackage(file) {
  check(file instanceof Blob && file.size > 0 && file.size <= MAX_PACKAGE_BYTES,
    '组件包应为不超过 16 KiB 的 JSON 文件');
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
  } catch {
    throw new HttpError(400, '组件包必须是 UTF-8 JSON 格式');
  }
  record(data, ['format', 'version', 'card', 'size'], '组件包');
  check(data.format === 'launchdeck-widget' && data.version === 1, '组件包格式或版本不受支持');
  const size = typeof data.size === 'string' && Object.hasOwn(IMPORTED_CARD_LEGACY_SIZES, data.size)
    ? IMPORTED_CARD_LEGACY_SIZES[data.size] : data.size;
  check(IMPORTED_CARD_SIZES.includes(size), '组件尺寸不受支持');
  return { size, config: validateImportedCard(data.card) };
}
