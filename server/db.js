/* 本文件由 DeepSeek v4.1 FLASH 模型编写 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'portfolio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS portfolios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  allocation  TEXT DEFAULT '',
  dca_plan    TEXT DEFAULT '',
  currency    TEXT NOT NULL DEFAULT 'USD',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS month_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id  INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,
  invested      REAL NOT NULL,
  value         REAL NOT NULL,
  note          TEXT DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE(portfolio_id, month)
);
CREATE INDEX IF NOT EXISTS idx_rec_portfolio ON month_records(portfolio_id);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);
`);

const DEFAULT_SETTINGS = {
  fx_usd_cny: '7.10',
  fx_hkd_cny: '0.92',
  fx_source: 'auto', // auto = open.er-api.com，manual = 用上面手填的
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export const getSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

export const setSettings = (patch) => {
  const upd = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k in DEFAULT_SETTINGS) upd.run(k, String(v));
    }
  });
  tx(patch);
  return getSettings();
};

export { DATA_DIR };
