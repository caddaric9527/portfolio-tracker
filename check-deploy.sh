#!/usr/bin/env bash
# 本文件由 DeepSeek v4.1 FLASH 模型编写
# 部署自检脚本   用法：sudo bash check-deploy.sh
# 逐项检查「磁盘源码 → 容器状态 → 镜像内文件 → 端口返回 → 认证有效性 → 数据」

cd "$(dirname "$0")" || exit 1

read_env() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'
}

PORT=$(read_env HOST_PORT); PORT=${PORT:-8888}
AUTH_PASSWORD=$(read_env AUTH_PASSWORD)
BASE="http://127.0.0.1:${PORT}"
JAR=$(mktemp 2>/dev/null || echo "/tmp/pf-cookie.$$")

PASS=0
FAIL=0
ok()  { echo "  [OK]   $1"; PASS=$((PASS + 1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

echo "=========================================="
echo " 1. 磁盘上的源码"
echo "=========================================="
if grep -q "投资组合收益统计" public/app.js 2>/dev/null; then
  ok "public/app.js 为新版（含新标题）"
else
  bad "public/app.js 是旧版 —— 压缩包没解压到当前目录？"
fi

if grep -q "no-cache" server/index.js 2>/dev/null; then
  ok "server/index.js 为新版（no-cache）"
else
  bad "server/index.js 是旧版"
fi

if [ -f server/auth.js ] && grep -q "requireAuthApi" server/index.js 2>/dev/null; then
  ok "密码认证模块已就位"
else
  bad "缺少密码认证模块（server/auth.js 或 index.js 未接入）"
fi

echo
echo "=========================================="
echo " 2. 容器状态"
echo "=========================================="
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx portfolio; then
  ok "容器 portfolio 运行中"
  docker ps --filter name=^portfolio$ --format '         {{.Status}} | {{.Ports}}'
else
  bad "容器 portfolio 未运行（看 docker compose ps -a 与 docker compose logs）"
fi

echo
echo "=========================================="
echo " 3. 镜像内实际文件"
echo "=========================================="
if docker exec portfolio grep -q "投资组合收益统计" /app/public/app.js 2>/dev/null; then
  ok "镜像内已含新前端"
else
  bad "镜像内仍是旧前端 —— 镜像没真正重建"
fi

if docker exec portfolio test -f /app/server/auth.js 2>/dev/null; then
  ok "镜像内已含认证模块"
else
  bad "镜像内没有 auth.js —— 镜像没重建"
fi

echo
echo "=========================================="
echo " 4. 端口 ${PORT} 返回"
echo "=========================================="
if curl -s --max-time 5 "${BASE}/api/health" | grep -q '"ok":true'; then
  ok "健康检查正常（未登录也可用，供 Docker 探活）"
else
  bad "健康检查异常"
fi

if curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${BASE}/login" | grep -q 200; then
  ok "登录页可访问"
else
  bad "登录页打不开"
fi

echo
echo "=========================================="
echo " 5. 认证是否真的生效"
echo "=========================================="
CODE_API=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${BASE}/api/overview")
if [ "$CODE_API" = "401" ]; then
  ok "未登录访问接口被拒绝（401）"
elif [ "$CODE_API" = "200" ]; then
  bad "未登录就能拿到数据 —— 密码认证未生效（检查 AUTH_PASSWORD 是否为空）"
else
  bad "未登录访问接口返回 ${CODE_API}，预期 401"
fi

CODE_PAGE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Accept: text/html' "${BASE}/")
if [ "$CODE_PAGE" = "302" ] || [ "$CODE_PAGE" = "401" ]; then
  ok "未登录访问首页被拦截（${CODE_PAGE}）"
else
  bad "未登录可直接打开首页（${CODE_PAGE}）"
fi

if [ -z "$AUTH_PASSWORD" ]; then
  echo "         未设置 AUTH_PASSWORD，密码认证处于关闭状态，建议在 .env 中设置"
else
  LOGIN=$(curl -s --max-time 5 -c "$JAR" -X POST "${BASE}/api/login" \
    -H 'Content-Type: application/json' -d "{\"password\":\"${AUTH_PASSWORD}\"}")
  if echo "$LOGIN" | grep -q '"ok":true'; then
    ok "用 .env 中的密码可正常登录"
    if curl -s --max-time 5 -b "$JAR" "${BASE}/app.js" | grep -q "投资组合收益统计"; then
      ok "登录后可读取受保护的页面资源"
    else
      bad "登录后仍读不到页面资源"
    fi
  else
    bad "登录失败：$(echo "$LOGIN" | head -c 120)"
  fi
  rm -f "$JAR"
fi

echo
echo "=========================================="
echo " 6. 数据文件"
echo "=========================================="
if [ -f data/portfolio.db ]; then
  echo "         $(ls -l data/portfolio.db | awk '{print $5" 字节  修改于 "$6" "$7" "$8}')"
else
  echo "         data/portfolio.db 不存在（首次启动会自动创建）"
fi

echo
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
  echo " 全部通过（$PASS 项）。浏览器打开 http://<飞牛IP>:${PORT}"
else
  echo " 有 $FAIL 项未通过（通过 $PASS 项），按上面 [FAIL] 的位置处理。"
fi
echo "=========================================="
