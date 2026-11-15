# API 说明

所有接口都在 `/api` 下，返回 JSON。除 `/api/health` 与认证相关接口外，**全部需要登录**，未登录返回 `401 {"error":"未登录或登录已过期","login":"/login"}`。

## 目录

- [认证](#认证)
- [健康检查](#健康检查)
- [组合](#组合)
- [月度记录](#月度记录)
- [汇总](#汇总)
- [设置](#设置)
- [备份导入导出](#备份导入导出)
- [错误约定](#错误约定)

---

## 认证

### `GET /api/session`

查询当前登录状态，登录页用它决定是否跳转。

```json
{ "authRequired": true, "authed": false, "days": 30 }
```

### `POST /api/login`

```bash
curl -c jar.txt -X POST http://127.0.0.1:8080/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-password"}'
```

成功：`200 {"ok":true,"days":30}`，同时下发 `pf_sid` Cookie（HttpOnly、SameSite=Lax）。

失败分两种：

| 状态码 | 场景 | 响应 |
|---|---|---|
| 401 | 密码错 | `{"error":"密码错误，还可尝试 N 次"}` |
| 429 | 该 IP 已被锁 | `{"error":"尝试次数过多，请 N 分钟后再试"}` |

同一 IP 连续失败 5 次 → 锁定 10 分钟。

### `POST /api/logout`

清 Cookie，返回 `{"ok":true}`。

未配置 `AUTH_PASSWORD` 时认证整体关闭，`/api/login` 直接返回 `{"ok":true,"authRequired":false}`。

---

## 健康检查

### `GET /api/health`（免登录）

供 Docker `HEALTHCHECK` 使用，顺带验证数据库可读。

```json
{ "ok": true, "service": "portfolio-tracker", "db": "ok", "uptime": 128 }
```

数据库异常时返回 `503 {"ok":false,...}`。

---

## 组合

### `GET /api/portfolios`

```json
[
  {
    "id": 1,
    "name": "组合一：核心指数",
    "allocation": "50% 宽基ETF + 50% 科技ETF",
    "dca_plan": "每月 10 日定投 300 美元",
    "currency": "USD",
    "sort_order": 0,
    "created_at": "2026-11-15T04:05:00.000Z"
  }
]
```

### `POST /api/portfolios`

```json
{ "name": "组合一：核心指数", "allocation": "50% 宽基ETF + 50% 科技ETF",
  "dcaPlan": "每月 10 日定投 300 美元", "currency": "USD", "sortOrder": 0 }
```

- `name` 必填，≤ 60 字符
- `allocation` / `dcaPlan` 截断到 200 字符
- `currency` 只接受 `USD` / `CNY` / `HKD`，非法值回落 `USD`

返回 `201` + 新建对象。

### `PATCH /api/portfolios/:id`

只传要改的字段，未传字段保持原值。返回更新后的对象；id 不存在返回 `404`。

### `DELETE /api/portfolios/:id`

在事务里先删该组合全部月度记录，再删组合本身。返回 `{"ok":true}`。

> 前端对删除操作要求手输「确认」，API 层不做二次确认 —— 这是有意的：接口保持幂等单纯，误操作防护放在交互层。

---

## 月度记录

### `GET /api/records?portfolioId=1`

不传 `portfolioId` 返回全部记录（按月份、组合排序）。

```json
[{ "id": 12, "portfolio_id": 1, "month": "2026-11",
   "invested": 2700, "value": 2860, "note": "", "created_at": "..." }]
```

### `POST /api/records`（upsert）

```json
{ "portfolioId": 1, "month": "2026-11", "invested": 2700, "value": 2860, "note": "" }
```

| 字段 | 规则 |
|---|---|
| `portfolioId` | 必填，且组合必须存在，否则 `400 请先选择组合` |
| `month` | 必须匹配 `YYYY-MM`（01–12）；不传则用当前月；格式非法直接 `400`，**不会静默回退** |
| `invested` / `value` | 必填，有限数字且 ≥ 0 |

同一 `(portfolio_id, month)` 再次提交会覆盖 `invested` / `value` / `note`（`ON CONFLICT DO UPDATE`），返回 `201 {"ok":true,"id":N,"upserted":true}`。

### `DELETE /api/records/:id`

删除单条记录，汇总与走势下次请求时重新计算。返回 `{"ok":true}`。

---

## 汇总

### `GET /api/overview?force=1`

一次性返回汇总、组合明细、月度趋势，前端只调这一个接口就能渲染整页。

```json
{
  "fx": { "toCny": { "USD": 7.1, "HKD": 0.92, "CNY": 1 } },
  "summaryCurrency": "CNY",
  "summary": {
    "currency": "CNY", "portfolioCount": 3, "recordedPortfolios": 3,
    "currentMonth": "2026-11",
    "invested": 54765.61, "value": 56081.06, "gain": 1315.45,
    "returnPct": 2.4, "monthPnl": 336.97, "monthInvested": 5006.91
  },
  "portfolios": [
    { "id": 1, "name": "组合一：核心指数", "currency": "USD",
      "latest": { "month": "2026-11", "invested": 2700, "value": 2860,
                  "gain": 160, "returnPct": 5.93, "monthInvested": 300, "monthPnl": 50 },
      "recordCount": 8,
      "history": [ /* 逐月明细，含上面四个派生字段 */ ] }
  ],
  "trend": [
    { "month": "2026-04", "invested": 21000, "value": 21300, "gain": 300, "returnPct": 1.43 }
  ]
}
```

`force=1` 跳过汇率缓存重新抓取。

**汇总币种判定**：所有组合同币种 → 用该币种；否则折 `CNY`。趋势里每个月的各组合金额按当期汇率折算后相加。

---

## 设置

### `GET /api/settings`

```json
{ "fx_usd_cny": "7.10", "fx_hkd_cny": "0.92", "fx_source": "auto" }
```

### `PATCH /api/settings`

白名单字段，仅接受 `fx_usd_cny` / `fx_hkd_cny` / `fx_source`。`fx_source=manual` 时用手填汇率，`auto` 时用 open.er-api.com 抓取结果。

---

## 备份导入导出

### `GET /api/export`

```json
{ "version": 2, "exportedAt": "2026-11-15T04:10:00.000Z",
  "portfolios": [ ... ], "records": [ ... ] }
```

### `POST /api/import`

```json
{ "mode": "merge", "data": { "portfolios": [...], "records": [...] } }
```

- `mode`：`merge`（默认，追加）或 `replace`（先清空全部记录与组合）
- `data` 可以是对象，也可以是 JSON 字符串（直接贴文件内容也能导入）
- 导入时组合 id 会重映射，`records.portfolio_id` 自动跟着改
- 返回 `{"ok":true,"mode":"merge","portfolios":3,"records":24}`

字段名兼容 `dcaPlan` / `dca_plan`、`sortOrder` / `sort_order` 两种写法。

---

## 错误约定

- 业务错误统一 `{"error":"中文提示"}`，HTTP 状态码 `400` / `401` / `404` / `429` / `503`
- 参数校验失败是 `400`，不会返回 200 带 `ok:false`
- 未捕获异常落 `500`，服务端打 `[error]` 日志，响应只给通用文案
