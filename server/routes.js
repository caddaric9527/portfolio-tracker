/* 本文件由 DeepSeek v4.1 FLASH 模型编写 */
import { Router } from 'express';
import { db, getSettings, setSettings } from './db.js';
import { fetchFx, fxToCny } from './fx.js';

export const api = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const requireStr = (v, label, { max = 120 } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) throw Object.assign(new Error(`${label}不能为空`), { status: 400 });
  if (s.length > max) throw Object.assign(new Error(`${label}过长`), { status: 400 });
  return s;
};
const requireNum = (v, label, { min = 0 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw Object.assign(new Error(`${label}须为不小于 ${min} 的数字`), { status: 400 });
  return n;
};
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''));
const thisMonth = () => new Date().toLocaleDateString('sv-SE').slice(0, 7); // 本地时区 YYYY-MM
const CURRENCIES = ['USD', 'CNY', 'HKD'];

const getPortfolio = (id) => db.prepare('SELECT * FROM portfolios WHERE id = ?').get(id);

/* ---------------- 健康检查（供 Docker HEALTHCHECK 使用） ---------------- */

api.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, service: 'portfolio-tracker', db: 'ok', uptime: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'portfolio-tracker', db: 'error', error: e.message });
  }
});

/* ---------------- 组合 CRUD ---------------- */

api.get('/portfolios', wrap(async (_req, res) => {
  res.json(db.prepare('SELECT * FROM portfolios ORDER BY sort_order, id').all());
}));

api.post('/portfolios', wrap(async (req, res) => {
  const b = req.body || {};
  const info = db
    .prepare('INSERT INTO portfolios (name, allocation, dca_plan, currency, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      requireStr(b.name, '组合名称', { max: 60 }),
      String(b.allocation || '').slice(0, 200),
      String(b.dcaPlan || '').slice(0, 200),
      CURRENCIES.includes(b.currency) ? b.currency : 'USD',
      num(b.sortOrder) || 0,
      new Date().toISOString(),
    );
  res.status(201).json(getPortfolio(info.lastInsertRowid));
}));

api.patch('/portfolios/:id', wrap(async (req, res) => {
  const p = getPortfolio(Number(req.params.id));
  if (!p) throw Object.assign(new Error('组合不存在'), { status: 404 });
  const b = req.body || {};
  db.prepare('UPDATE portfolios SET name=?, allocation=?, dca_plan=?, currency=?, sort_order=? WHERE id=?').run(
    b.name === undefined ? p.name : requireStr(b.name, '组合名称', { max: 60 }),
    b.allocation === undefined ? p.allocation : String(b.allocation || '').slice(0, 200),
    b.dcaPlan === undefined ? p.dca_plan : String(b.dcaPlan || '').slice(0, 200),
    b.currency === undefined ? p.currency : (CURRENCIES.includes(b.currency) ? b.currency : p.currency),
    b.sortOrder === undefined ? p.sort_order : (num(b.sortOrder) || 0),
    p.id,
  );
  res.json(getPortfolio(p.id));
}));

api.delete('/portfolios/:id', wrap(async (req, res) => {
  const p = getPortfolio(Number(req.params.id));
  if (!p) throw Object.assign(new Error('组合不存在'), { status: 404 });
  db.transaction(() => {
    db.prepare('DELETE FROM month_records WHERE portfolio_id = ?').run(p.id);
    db.prepare('DELETE FROM portfolios WHERE id = ?').run(p.id);
  })();
  res.json({ ok: true });
}));

/* ---------------- 月度记录 ---------------- */

api.get('/records', wrap(async (req, res) => {
  const pid = Number(req.query.portfolioId);
  const rows = pid
    ? db.prepare('SELECT * FROM month_records WHERE portfolio_id = ? ORDER BY month').all(pid)
    : db.prepare('SELECT * FROM month_records ORDER BY month, portfolio_id').all();
  res.json(rows);
}));

// 同一组合同一月份重复提交 → 覆盖更新
api.post('/records', wrap(async (req, res) => {
  const b = req.body || {};
  const pid = Number(b.portfolioId);
  const pf = getPortfolio(pid);
  if (!pf) throw Object.assign(new Error('请先选择组合'), { status: 400 });
  const month = b.month ? (isMonth(b.month) ? b.month : (() => { throw Object.assign(new Error(`月份格式须为 YYYY-MM，收到：${b.month}`), { status: 400 }); })()) : thisMonth();
  const invested = requireNum(b.invested, '投入本金');
  const value = requireNum(b.value, '当前市值');
  const note = String(b.note || '').slice(0, 200);
  const info = db
    .prepare(`INSERT INTO month_records (portfolio_id, month, invested, value, note, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(portfolio_id, month) DO UPDATE SET invested=excluded.invested, value=excluded.value, note=excluded.note`)
    .run(pid, month, invested, value, note, new Date().toISOString());
  res.status(201).json({ ok: true, id: info.lastInsertRowid, upserted: true });
}));

api.delete('/records/:id', wrap(async (req, res) => {
  const r = db.prepare('SELECT id FROM month_records WHERE id = ?').get(Number(req.params.id));
  if (!r) throw Object.assign(new Error('记录不存在'), { status: 404 });
  db.prepare('DELETE FROM month_records WHERE id = ?').run(r.id);
  res.json({ ok: true });
}));

/* ---------------- 汇总计算 ---------------- */

function enrich(records) {
  let prev = null;
  return records.map((r) => {
    const gain = r.value - r.invested;
    const returnPct = r.invested > 0 ? round((gain / r.invested) * 100, 2) : null;
    const monthInvested = prev ? r.invested - prev.invested : r.invested;
    const monthPnl = prev ? (r.value - prev.value) - monthInvested : gain;
    prev = r;
    return { ...r, gain: round(gain, 2), returnPct, monthInvested: round(monthInvested, 2), monthPnl: round(monthPnl, 2) };
  });
}

api.get('/overview', wrap(async (req, res) => {
  const force = req.query.force === '1';
  const fx = await fetchFx(force);
  const portfolios = db.prepare('SELECT * FROM portfolios ORDER BY sort_order, id').all();
  const allRecords = db.prepare('SELECT * FROM month_records ORDER BY portfolio_id, month').all();

  const items = [];
  for (const pf of portfolios) {
    const records = enrich(allRecords.filter((r) => r.portfolio_id === pf.id));
    const latest = records[records.length - 1] || null;
    items.push({
      ...pf,
      latest,
      recordCount: records.length,
      history: records,
    });
  }

  // 汇总币种：组合全是同一种币就用它，否则折人民币
  const currencies = [...new Set(portfolios.map((p) => p.currency))];
  const summaryCurrency = currencies.length === 1 ? currencies[0] : 'CNY';
  const toSum = (cur) => (summaryCurrency === 'CNY' ? fxToCny(fx, cur) : cur === summaryCurrency ? 1 : fxToCny(fx, cur));

  // 月度趋势（各组合按汇总币种相加）
  const byMonth = new Map();
  for (const it of items) {
    const rate = toSum(it.currency);
    for (const r of it.history) {
      const m = byMonth.get(r.month) || { month: r.month, invested: 0, value: 0 };
      m.invested += r.invested * rate;
      m.value += r.value * rate;
      byMonth.set(r.month, m);
    }
  }
  const trend = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      ...m,
      invested: round(m.invested, 2),
      value: round(m.value, 2),
      gain: round(m.value - m.invested, 2),
      returnPct: m.invested > 0 ? round(((m.value - m.invested) / m.invested) * 100, 2) : null,
    }));

  const latestMonth = trend.length ? trend[trend.length - 1] : null;
  const prevTrend = trend.length > 1 ? trend[trend.length - 2] : null;
  const summary = {
    currency: summaryCurrency,
    portfolioCount: portfolios.length,
    recordedPortfolios: items.filter((i) => i.latest).length,
    currentMonth: thisMonth(),
    invested: latestMonth ? latestMonth.invested : 0,
    value: latestMonth ? latestMonth.value : 0,
    gain: latestMonth ? latestMonth.gain : 0,
    returnPct: latestMonth ? latestMonth.returnPct : null,
    monthPnl: latestMonth && prevTrend ? round((latestMonth.value - prevTrend.value) - (latestMonth.invested - prevTrend.invested), 2) : latestMonth ? latestMonth.gain : 0,
    monthInvested: latestMonth && prevTrend ? round(latestMonth.invested - prevTrend.invested, 2) : latestMonth ? latestMonth.invested : 0,
  };

  res.json({
    fx: { toCny: { USD: round(fxToCny(fx, 'USD'), 4), HKD: round(fxToCny(fx, 'HKD'), 4), CNY: 1 } },
    summaryCurrency,
    summary,
    portfolios: items,
    trend,
  });
}));

/* ---------------- 设置 / 备份 ---------------- */

api.get('/settings', wrap(async (_req, res) => {
  const s = getSettings();
  res.json({ fx_usd_cny: s.fx_usd_cny, fx_hkd_cny: s.fx_hkd_cny, fx_source: s.fx_source });
}));

api.patch('/settings', wrap(async (req, res) => {
  res.json(setSettings(req.body || {}));
}));

api.get('/export', wrap(async (_req, res) => {
  res.json({
    version: 2,
    exportedAt: new Date().toISOString(),
    portfolios: db.prepare('SELECT * FROM portfolios ORDER BY id').all(),
    records: db.prepare('SELECT * FROM month_records ORDER BY portfolio_id, month').all(),
  });
}));

api.post('/import', wrap(async (req, res) => {
  const b = req.body || {};
  const data = typeof b.data === 'string' ? JSON.parse(b.data) : b.data || b;
  if (!Array.isArray(data.portfolios) || !Array.isArray(data.records)) {
    throw Object.assign(new Error('备份格式不正确：缺少 portfolios 或 records'), { status: 400 });
  }
  const mode = b.mode === 'replace' ? 'replace' : 'merge';
  const insPf = db.prepare('INSERT INTO portfolios (name, allocation, dca_plan, currency, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insRec = db.prepare('INSERT INTO month_records (portfolio_id, month, invested, value, note, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  let pfCount = 0;
  let recCount = 0;
  db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM month_records').run();
      db.prepare('DELETE FROM portfolios').run();
    }
    const idMap = new Map();
    for (const p of data.portfolios) {
      const info = insPf.run(
        requireStr(p.name, '组合名称', { max: 60 }),
        String(p.allocation ?? p.allocation_detail ?? '').slice(0, 200),
        String(p.dca_plan ?? p.dcaPlan ?? '').slice(0, 200),
        CURRENCIES.includes(p.currency) ? p.currency : 'USD',
        num(p.sort_order ?? p.sortOrder) || 0,
        p.created_at || new Date().toISOString(),
      );
      idMap.set(Number(p.id), Number(info.lastInsertRowid));
      pfCount += 1;
    }
    for (const r of data.records) {
      const pid = idMap.get(Number(r.portfolio_id)) ?? Number(r.portfolio_id);
      if (!getPortfolio(pid)) continue;
      insRec.run(
        pid,
        isMonth(r.month) ? r.month : String(r.month || '').slice(0, 7),
        requireNum(r.invested, '投入本金'),
        requireNum(r.value, '当前市值'),
        String(r.note || '').slice(0, 200),
        r.created_at || new Date().toISOString(),
      );
      recCount += 1;
    }
  })();
  res.json({ ok: true, mode, portfolios: pfCount, records: recCount });
}));
