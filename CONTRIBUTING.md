# 贡献指南

感谢愿意一起改这个东西。它是个人项目，代码量不大，规则也就几条。

## 环境

```bash
nvm use            # .nvmrc → Node 22
npm install
AUTH_PASSWORD=dev PORT=8080 npm run dev
```

只用 `npm start` / `npm run dev`，没有构建步骤 —— 改完 `public/` 里的文件刷新浏览器就能看到。

## 目录约定

| 目录 | 放什么 |
|---|---|
| `server/` | 路由、数据库、认证、汇率。加接口请写在 `routes.js`，别再开新文件除非职责明显不同 |
| `public/` | 页面、样式、脚本。不引第三方库，不引 CDN |
| `docs/` | 文档与截图。改接口请同步 `docs/API.md` |

## 代码风格

- 2 空格缩进，LF 换行（`.editorconfig` 已配，编辑器一般会自动遵守）
- 后端 ESM，前端 IIFE + 原生 DOM，不引入框架
- 金额计算统一走 `num()` / `round()` 工具，别在业务里裸算浮点再展示
- 用户输入进 HTML 前必须过 `esc()`
- SQL 一律 `prepare` + 参数绑定，不拼字符串

## 提交前自查

```bash
for f in server/*.js public/app.js; do node --check "$f"; done   # 语法
bash -n deploy.sh check-deploy.sh                                 # 脚本语法
```

CI 还会跑一遍冒烟测试：启动服务 → 健康检查 → 未登录 401 → 登录 → 写入 → 同月覆盖 → 非法月份 400 → 汇总数值。本地想复现可以直接看 `.github/workflows/ci.yml`。

## PR

- 一个 PR 只做一件事，别把重构和功能混在一起
- 说明动机（为什么改）而不只是动作（改了什么）
- 涉及界面变化请附截图，涉及计算口径变化请给出前后对比数字
- 数据库结构有变动的话，必须保持老库能直接升级（`CREATE TABLE IF NOT EXISTS` + 兼容读写，不做破坏性迁移）

## 不打算做的

- 接行情源自动更新市值（定位是「记录你自己确认过的快照」）
- 多用户 / 权限体系（自托管单用户工具）
- 引入前端框架或构建工具（零依赖是刻意选择）
