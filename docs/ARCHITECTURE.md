# 架构说明

一句话：**Express 单进程 + SQLite 单文件 + 原生前端**，所有派生指标在请求时计算，不落冗余表。

## 请求链路

```
浏览器
  │
  ├─ GET /login ────────────────► 直出 login.html（不经过静态目录，无需登录）
  │
  ├─ /api/login|logout|session ─► authRouter（公开）
  │
  ├─ /api/*（其余） ────────────► requireAuthApi ──► 业务路由 routes.js
  │                                    │
  │                                    └─ /api/health 例外放行（Docker 健康检查）
  │
  └─ 其他静态资源 ──────────────► requireAuthPage ──► express.static(public/)
                                        │
                                        └─ 未登录：Accept 含 text/html → 302 /login
                                                   否则 401 text/plain
```

顺序是硬约束，改中间件位置很容易踩坑：

1. `express.json({limit:'4mb'})` —— 导入备份可能有几 MB
2. `GET /login` 直出，避免登录页依赖静态目录
3. `app.use('/api', authRouter)` —— 登录接口必须先于守卫
4. `app.use('/api', 守卫, api)` —— 守卫内部对 `/health` 放行
5. `requireAuthPage` + `express.static` —— 顺序不能反，反了静态资源就裸奔
6. 错误兜底 `(err, req, res, next)` —— 必须四个参数，否则不被识别为错误中间件

## 数据模型

```sql
portfolios
  id  name  allocation  dca_plan  currency  sort_order  created_at

month_records
  id  portfolio_id → portfolios.id (ON DELETE CASCADE)
  month  invested  value  note  created_at
  UNIQUE(portfolio_id, month)     ← upsert 的支点

settings（key-value）
  fx_usd_cny  fx_hkd_cny  fx_source
```

设计取舍：

- **只有原始快照，没有派生列**。`gain` / `returnPct` / `monthPnl` 全部在 `enrich()` 里按时间序列推算，改了任意一条历史记录，整条曲线自动跟着变，不需要回填
- **`UNIQUE(portfolio_id, month)`** 让「同月重复录入」变成 SQL 层的一次 `ON CONFLICT DO UPDATE`，前端不用先查再判断
- **金额用 `REAL`**，展示前统一 `toFixed(2)`。个人记账量级下浮点误差可忽略，换来的是 SQL 里能直接 `SUM`
- **`journal_mode = WAL`**：读写并发更稳，代价是产生 `-shm` / `-wal` 两个附属文件 —— 备份时要一起处理

## 计算链路

```
month_records（原始）
      │  enrich()：按 month 升序，逐条算 gain / returnPct / monthInvested / monthPnl
      ▼
每个组合的 history ──► latest（取最后一条）
      │
      │  按汇总币种折算（同币种直通，跨币种 fxToCny）
      ▼
trend（按月把各组合相加）
      │
      ▼
summary（取 trend 最后一条 + 倒数第二条算本月盈亏）
```

三个容易算错的地方，代码里都显式处理了：

1. **首月没有上月**：`monthInvested = invested`（不是 0），`monthPnl = gain`（不是 0）
2. **本月盈亏 ≠ 收益差**：要先扣掉本月新投入的钱，否则定投月会虚假亏损
3. **本金为 0**：`returnPct` 返回 `null`，前端显示 `—` 而不是 `0%`

## 认证设计

无状态令牌，服务端不存 session：

```
payload = base64url({ exp: 时间戳, n: 随机数 })
token   = payload + "." + HMAC-SHA256(payload, secret)
```

- `secret` 首次启动生成 32 字节，写入 `data/.auth-secret`（0600）。容器重建、镜像升级都不影响登录态；想强制全员下线就删这个文件
- 校验时先比长度再 `timingSafeEqual`，避免长度差异带来的时序泄漏
- 密码本身不进数据库，只在环境变量里；比对用的是两边 SHA-256 摘要的 `timingSafeEqual`
- 限流是进程内 `Map`，重启即清空 —— 单实例部署够用，也便于「被锁了就重启解锁」这种应急操作

## 前端结构

`public/app.js` 是唯一脚本，无构建、无依赖，按职责分几段：

| 区块 | 职责 |
|---|---|
| `api()` | 统一 fetch 封装，401 直接 `location.replace('/login')` |
| `renderSummary / renderPortfolios / renderTrend / renderDetail` | 四个渲染函数，数据都来自一次 `/api/overview` |
| `buildTrendChart / buildSparkline` | 手写 SVG，坐标映射在外层算好再拼字符串 |
| `buildShareCanvas` | 1080 × 1308 Canvas 手绘分享图，复用同一套配色常量 |
| `confirmTyping()` | 六处敏感操作的「输入确认」弹窗 |
| 表单提交 | 全部走 `submit` 事件 + `preventDefault`，成功后 `reload()` 重取 overview |

渲染策略是「全量重绘」而不是 diff：数据量是几十条记录，重绘成本远低于维护 diff 逻辑的复杂度。

## 缓存策略

| 资源 | 策略 | 原因 |
|---|---|---|
| `public/*` 静态资源 | `Cache-Control: no-cache` + ETag | 早期用过 `maxAge: 1h`，结果改完前端一小时看不到变化，踩过坑 |
| `index.html` 引用 | `?v=YYYYMMDD` 版本号 | 双保险，强制刷新引用 |
| 汇率 | 内存缓存 6 小时，`?force=1` 可绕过 | 外部接口有速率限制，且日内波动对月报无意义 |

## 部署拓扑

```
NAS（飞牛 fnOS / 群晖）
└── docker compose
    └── portfolio (node:22-bookworm-slim)
        ├── 8080 ← 宿主机 ${HOST_PORT:-8888}
        └── /app/data (bind mount) ← ./data/portfolio.db + .auth-secret
```

镜像里只 `COPY server/ public/`，`data/` 由 volume 挂载。所以：

- 改前端或后端 → **都必须** `docker compose up -d --build` 重建镜像；`restart` 只是重启进程，容器内仍是镜像里的旧文件
- 若希望改前端后免重建，可在 compose 里加一行 `- ./public:/app/public:ro` 把目录挂进去，此时改完 `restart` 即可（宿主目录必须完整，否则页面会 404）
- 备份 → 拷 `./data/` 目录

`HEALTHCHECK` 每 60 秒打一次 `/api/health`，连续 3 次失败标记 unhealthy，配合 `restart: unless-stopped` 能自动拉起被 OOM 掉的进程。
