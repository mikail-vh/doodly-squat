# Storage is SQLite through Node's built-in driver, so there is nothing native
# to compile and the runtime image stays a plain node:alpine.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STASH_DB_PATH=/data/stash.db

RUN addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs \
 && mkdir -p /data \
 && chown nextjs:nodejs /data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
# A fresh named volume at /data inherits this ownership, so the database file
# is writable without running as root.
VOLUME ["/data"]
CMD ["node", "server.js"]
