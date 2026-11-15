/* 本文件由 DeepSeek v4.1 FLASH 模型编写 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { authRouter, requireAuthApi, requireAuthPage, authStatus } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8080;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// 登录页：不受保护，且不依赖 public/ 下的其他资源
app.get(['/login', '/login.html'], (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// 公开的鉴权接口：/api/login、/api/logout、/api/session
app.use('/api', authRouter);

// 业务接口需登录；/api/health 例外（Docker HEALTHCHECK 要用）
app.use(
  '/api',
  (req, res, next) => (req.path === '/health' ? next() : requireAuthApi(req, res, next)),
  api,
);

// 静态资源不设强缓存：每次带 ETag 回源校验，命中则 304。
// 之前用 maxAge:'1h' 会导致改完前端后，浏览器最长 1 小时仍显示旧页面。
app.use(
  requireAuthPage,
  express.static(PUBLIC_DIR, {
    etag: true,
    lastModified: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  const a = authStatus();
  console.log(`投资组合月度收益统计已启动: http://0.0.0.0:${PORT}`);
  if (a.enabled) {
    console.log(`密码认证已开启，登录有效期 ${a.days} 天`);
  } else {
    console.warn('警告：未设置 AUTH_PASSWORD，网站处于无密码状态，任何能访问该端口的人都能看到数据');
  }
});
