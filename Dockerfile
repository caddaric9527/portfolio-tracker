# 本文件由 DeepSeek v4.1 FLASH 模型编写
FROM node:22-bookworm-slim

# better-sqlite3 优先使用预编译包，保留编译工具作为兜底
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
# 有 lock 时走可复现安装；个别情况下 lock 与 package.json 不同步则回退到 install
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
RUN npm cache clean --force

COPY server ./server
COPY public ./public

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
