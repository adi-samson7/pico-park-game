# syntax=docker/dockerfile:1
#
# Pico Co-op: one image, one port.
# The Node server serves the game (WebSocket), the room-code lookup, a
# /health endpoint and the built client.
#
#   docker build -t pico-coop .
#   docker run --rm -p 2567:2567 pico-coop      ->  http://localhost:2567

# ---------- 1. build the client ----------
FROM node:22-bookworm-slim AS client-build
WORKDIR /build/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./

# Leave empty to use the page's own origin (the normal case). Set it only if
# the game server is hosted on a different domain than the client.
ARG VITE_SERVER_URL=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL

RUN npm run build


# ---------- 2. compile the server ----------
FROM node:22-bookworm-slim AS server-build
WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src

RUN npm run build


# ---------- 3. production dependencies only ----------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev


# ---------- 4. runtime ----------
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=2567 \
    CLIENT_DIST=/app/public \
    DATA_DIR=/app/data

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=server-build /build/server/dist ./dist
COPY --from=client-build /build/client/dist ./public
COPY server/package.json ./

# The leaderboard is kept in a file here. The server does not run as root, so the
# folder must be writable by it. Mount a volume on it to keep the times across
# redeploys (without one they start again with every new container).
RUN mkdir -p /app/data && chown node:node /app/data

VOLUME ["/app/data"]

# Don't run as root.
USER node

EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
