/* 本文件由 DeepSeek v4.1 FLASH 模型编写 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

/* ============ 配置 ============ */
const COOKIE = 'pf_sid';
const DAYS = Math.max(1, Math.min(365, Number(process.env.AUTH_DAYS) || 30));
const PASSWORD = String(process.env.AUTH_PASSWORD ?? '');
export const authEnabled = PASSWORD.length > 0;

const MAX_FAIL = 5;                 // 同一 IP 连续失败次数上限
const FAIL_WINDOW_MS = 10 * 60e3;   // 10 分钟内
const LOCK_MS = 10 * 60e3;          // 触发后锁定 10 分钟

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

/* ============ 签名密钥（持久化，容器重建不掉线） ============ */
let secretCache = null;
function getSecret() {
  if (secretCache) return secretCache;
  const file = path.join(DATA_DIR, '.auth-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) { secretCache = s; return s; }
  } catch { /* 不存在则生成 */ }
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
  } catch (e) {
    console.warn('[auth] 密钥无法落盘，重启后需重新登录:', e.message);
  }
  secretCache = s;
  return s;
}

/* ============ 令牌 ============ */
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function makeToken() {
  const payload = b64u(JSON.stringify({
    exp: Date.now() + DAYS * 864e5,
    n: crypto.randomBytes(8).toString('hex'),
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(res, value, maxAgeSec) {
  const bits = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  res.setHeader('Set-Cookie', bits.join('; '));
}

/* ============ 密码比对（定长摘要，避免时序泄漏） ============ */
function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ============ 登录失败限流 ============ */
const fails = new Map(); // ip -> { count, first, until }

function blockedFor(ip) {
  const rec = fails.get(ip);
  if (!rec) return 0;
  if (rec.until && rec.until > Date.now()) return Math.ceil((rec.until - Date.now()) / 1000);
  if (rec.until && rec.until <= Date.now()) fails.delete(ip);
  return 0;
}

function recordFail(ip) {
  const now = Date.now();
  const rec = fails.get(ip) || { count: 0, first: now, until: 0 };
  if (now - rec.first > FAIL_WINDOW_MS) { rec.count = 0; rec.first = now; }
  rec.count += 1;
  if (rec.count >= MAX_FAIL) rec.until = now + LOCK_MS;
  fails.set(ip, rec);
  return rec;
}

/* ============ 公开路由：login / logout / session ============ */
export const authRouter = Router();

authRouter.get('/session', (req, res) => {
  res.json({
    authRequired: authEnabled,
    authed: !authEnabled || verifyToken(readCookie(req, COOKIE)),
    days: DAYS,
  });
});

authRouter.post('/login', (req, res) => {
  if (!authEnabled) return res.json({ ok: true, authRequired: false });

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const wait = blockedFor(ip);
  if (wait > 0) {
    return res.status(429).json({ error: `尝试次数过多，请 ${Math.ceil(wait / 60)} 分钟后再试` });
  }

  const pw = String(req.body?.password ?? '');
  if (!passwordMatches(pw)) {
    const rec = recordFail(ip);
    const left = Math.max(0, MAX_FAIL - rec.count);
    return res.status(401).json({
      error: left > 0 ? `密码错误，还可尝试 ${left} 次` : '尝试次数过多，已锁定 10 分钟',
    });
  }

  fails.delete(ip);
  setCookie(res, makeToken(), DAYS * 86400);
  res.json({ ok: true, days: DAYS });
});

authRouter.post('/logout', (_req, res) => {
  setCookie(res, '', 0);
  res.json({ ok: true });
});

/* ============ 中间件 ============ */
const isAuthed = (req) => !authEnabled || verifyToken(readCookie(req, COOKIE));

/** 保护 /api 下的业务接口 */
export function requireAuthApi(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: '未登录或登录已过期', login: '/login' });
}

/** 保护静态资源与页面 */
export function requireAuthPage(req, res, next) {
  if (isAuthed(req)) return next();
  const wantsHtml = String(req.headers.accept || '').includes('text/html');
  if (wantsHtml && (req.method === 'GET' || req.method === 'HEAD')) {
    return res.redirect(302, '/login');
  }
  res.status(401).type('text/plain').send('unauthorized');
}

export function authStatus() {
  return { enabled: authEnabled, days: DAYS };
}
