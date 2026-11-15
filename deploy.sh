#!/usr/bin/env bash
# 本文件由 DeepSeek v4.1 FLASH 模型编写
# 全新安装脚本   用法：sudo bash deploy.sh [--wipe | --keep-data]
#
# 定位：本脚本只负责「在一台干净的设备上从零装好」。
# 它不会把旧版本迁移过来，也不会覆盖已有数据库 —— 检测到已有部署时直接退出，
# 由你显式选择：
#   --wipe       现有数据先改名备份，然后当全新设备重装
#   --keep-data  保留现有数据，只按当前代码重建镜像（等同「更新」）
set -u

usage() {
  cat <<'EOF'
用法：
  sudo bash deploy.sh               全新安装（要求目录内无 data/、无 portfolio 容器）
  sudo bash deploy.sh --wipe        清空重装（现有 data/ 会改名备份为 data.bak.<时间戳>）
  sudo bash deploy.sh --keep-data   保留数据重建（升级/改代码时用）
  sudo bash deploy.sh --help        显示本帮助
EOF
}

MODE=fresh
for arg in "$@"; do
  case "$arg" in
    --wipe) MODE=wipe ;;
    --keep-data) MODE=keep ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg"; echo; usage; exit 1 ;;
  esac
done

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
echo " 投资组合收益统计 · 全新安装"
echo " 目录：$(pwd)"
echo " 端口：${PORT}"
case "$MODE" in
  fresh) echo " 模式：全新安装（空库启动）" ;;
  wipe)  echo " 模式：清空重装（旧库改名备份）" ;;
  keep)  echo " 模式：保留数据重建" ;;
esac
echo "=========================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 docker，请先安装 Docker（飞牛：应用中心 → Docker；群晖：套件中心 → Container Manager）。"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未检测到 docker compose 插件，请先安装 docker-compose-plugin。"
  exit 1
fi

# ---- 已有部署检测：全新安装必须从空环境开始 ----
EXISTING_DB=0
[ -f data/portfolio.db ] && EXISTING_DB=1
EXISTING_CT=0
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'portfolio'; then
  EXISTING_CT=1
fi

if [ "$MODE" = "fresh" ] && { [ "$EXISTING_DB" -eq 1 ] || [ "$EXISTING_CT" -eq 1 ]; }; then
  echo
  echo "检测到本机已有部署，deploy.sh 不会替你覆盖现有数据。"
  echo "  data/portfolio.db    $([ "$EXISTING_DB" -eq 1 ] && echo 存在 || echo 不存在)"
  echo "  容器 portfolio       $([ "$EXISTING_CT" -eq 1 ] && echo 存在 || echo 不存在)"
  echo
  echo "请显式选择一种："
  echo "  1) 全新安装：现有数据库先备份再清空"
  echo "       sudo bash deploy.sh --wipe"
  echo "  2) 只更新代码：保留现有数据重建镜像"
  echo "       sudo bash deploy.sh --keep-data"
  echo "  3) 先自己备份，再回来执行上面的命令"
  echo "       sudo cp -a data data.bak.\$(date +%Y%m%d%H%M)"
  echo
  exit 1
fi

# ---- 清空重装：旧库改名，不删除 ----
if [ "$MODE" = "wipe" ]; then
  docker compose down --remove-orphans >/dev/null 2>&1 || true
  if [ -d data ]; then
    BAK="data.bak.$(date +%Y%m%d%H%M%S)"
    if mv data "$BAK"; then
      echo "旧数据已备份到：$(pwd)/${BAK}"
      echo "确认新装没问题后可以自行删除它。"
    else
      echo "旧数据改名失败，已中止（未做任何删除）。"
      exit 1
    fi
  fi
fi

# ---- 访问密码：未设置则自动生成 ----
GENERATED=0
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
fi

echo
echo "[1/3] 构建镜像并启动（首次需拉取 node:22-bookworm-slim，约 1~3 分钟）..."
if ! docker compose up -d --build; then
  echo "构建或启动失败，请把上面的日志发出来。"
  exit 1
fi

echo "[2/3] 等待服务就绪..."
READY=0
for _ in $(seq 1 60); do
  if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

echo "[3/3] 安装结果"
docker compose ps

echo
if [ "$READY" -eq 1 ]; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "✅ 安装完成，浏览器访问：http://${IP:-<本机IP>}:${PORT}"
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
if [ "$MODE" != "keep" ]; then
  echo "    数据库：全新空库 $(pwd)/data/portfolio.db（登录后先建组合）"
fi
echo "=========================================="

echo
echo "================ 自检 ================"
bash ./check-deploy.sh
