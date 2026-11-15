/* 本文件由 DeepSeek v4.1 FLASH 模型编写 */
import { db, getSettings } from './db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

let fxCache = { rates: null, at: 0 };

export async function fetchFx(force = false) {
  const TTL = 6 * 3600 * 1000;
  if (!force && fxCache.rates && Date.now() - fxCache.at < TTL) return fxCache.rates;
  const s = getSettings();
  const manual = { USD: Number(s.fx_usd_cny) || 7.1, HKD: Number(s.fx_hkd_cny) || 0.92, CNY: 1 };
  if (s.fx_source === 'manual') return manual;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== 'success' || !data.rates?.CNY) throw new Error('汇率接口异常');
    const rates = { USD: 1, CNY: Number(data.rates.CNY), HKD: Number(data.rates.HKD) || manual.HKD };
    fxCache = { rates, at: Date.now() };
    return rates;
  } catch {
    return manual;
  }
}

// currency -> CNY 乘数
export function fxToCny(rates, currency) {
  if (currency === 'CNY') return 1;
  const perUsd = rates[currency];
  if (!perUsd) return 1;
  return (Number(rates.CNY) || 1) / perUsd || 1;
}
