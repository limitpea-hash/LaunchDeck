import { check, record } from './schema.js';

export const CURRENCIES = Object.freeze({
  CNY: '人民币', USD: '美元', EUR: '欧元', JPY: '日元', HKD: '港元', GBP: '英镑',
  AUD: '澳元', CAD: '加拿大元', SGD: '新加坡元', KRW: '韩元', CHF: '瑞士法郎', TWD: '新台币',
});

export const EXCHANGE_RATE_ORIGIN = 'https://api.frankfurter.dev';

export function validateCurrencyPair(value) {
  record(value, ['base', 'quote'], '币对');
  for (const currency of [value.base, value.quote]) {
    check(typeof currency === 'string' && Object.hasOwn(CURRENCIES, currency), '请选择支持的币种');
  }
  return { base: value.base, quote: value.quote };
}
