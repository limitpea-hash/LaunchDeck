FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend

RUN mkdir -p /data /app/backend/data \
  && chown node:node /data /app/backend/data

ENV NODE_ENV=production \
    PORT=3000 \
    LISTEN_HOST=0.0.0.0 \
    DATABASE_PATH=/data/portal.sqlite \
    TRUST_PROXY=false

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "backend/index.js"]
