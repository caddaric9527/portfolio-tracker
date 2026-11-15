#!/usr/bin/env bash
# 本文件由 DeepSeek v4.1 FLASH 模型编写
# 全新设备一键部署   用法：sudo bash deploy.sh
# 流程：检查密码配置 → 构建镜像 → 启动容器 → 等就绪 → 自检
set -u

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 运行：sudo bash deploy.sh"
  exit 1
fi

cd "$(dirname "$0")" || exit 1

read_env() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'
}

PORT=$(read_env HOST_PORT); PORT=${PORT:-8888}
AUTH_PASSWORD=$(read_env AUTH_PASSWORD)
AUTH_DAYS=$(read_env AUTH_DAYS); AUTH_DAYS=${AUTH_DAYS:-30}

echo "=========================================="
echo " 投资组合收益统计 · 全新部署"
echo " 目录：$(pwd)"
echo " 端口：${PORT}"
echo "=========================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 docker，请先安装 Docker（飞牛：应用中心 → Docker；群晖：套件中心 → Container Manager）。"
  exit 1
fi

# ---- 访问密码：未设置则自动生成 ----
if [ -z "$AUTH_PASSWORD" ]; then
  if command -v openssl >/dev/null 2>&1; then
    AUTH_PASSWORD=$(openssl rand -hex 8)
  else
    AUTH_PASSWORD=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 16)
  fi
  if grep -q '^AUTH_PASSWORD=' .env 2>/dev/null; then
    sed -i "s|^AUTH_PASSWORD=.*|AUTH_PASSWORD=${AUTH_PASSWORD}|" .env
  else
    printf '\nAUTH_PASSWORD=%s\n' "$AUTH_PASSWORD" >> .env
  fi
  GENERATED=1
else
  GENERATED=0
fi

if [ -f data/portfolio.db ]; then
  echo "提示：本目录已存在数据库 data/portfolio.db，本次部署会沿用它（不会删除）。"
  echo "      如需彻底空库重来，先执行：mv data data.old"
  echo
fi

echo "[1/3] 构建并启动（首次需拉取 node:22-bookworm-slim，约 1~3 分钟）..."
if ! docker compose up -d --build; then
  echo "构建或启动失败，请把上面的日志发出来。"
  exit 1
fi

echo "[2/3] 等待服务就绪..."
READY=0
for i in $(seq 1 60); do
  if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

echo "[3/3] 部署结果"
docker compose ps

echo
if [ "$READY" -eq 1 ]; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "✅ 部署完成，浏览器访问：http://${IP:-<本机IP>}:${PORT}"
  echo "   首次打开请按 Ctrl+F5 强制刷新一次。"
else
  echo "⚠ 120 秒内健康检查未通过，最近日志："
  docker compose logs --tail=30
fi

echo
echo "=========================================="
if [ "$GENERATED" -eq 1 ]; then
  echo " 🔑 已自动生成访问密码，请立刻记下："
  echo
  echo "        ${AUTH_PASSWORD}"
  echo
  echo "    已写入 $(pwd)/.env ，可随时改成自己好记的密码。"
else
  echo " 🔑 访问密码：沿用 .env 中已设置的 AUTH_PASSWORD"
fi
echo "    登录有效期：${AUTH_DAYS} 天"
echo "=========================================="

echo
echo "================ 自检 ================"
bash ./check-deploy.sh
