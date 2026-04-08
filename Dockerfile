# syntax=docker/dockerfile:1

# ---- build stage -----------------------------------------------------------
# better-sqlite3 is a native addon that ships prebuilt binaries for musl x64 and
# arm64 and loads them at runtime. npm would still run an implicit
# `node-gyp rebuild` because the package contains binding.gyp, which needs a
# compiler this image does not have, so install scripts are skipped. Nothing
# the image uses needs one: only the dev-only esbuild and fsevents declare one.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY index.ts ./
COPY src ./src
RUN npm run build

# Reinstall with production dependencies only.
RUN npm ci --omit=dev --ignore-scripts

# ---- runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# `node` (uid 1000) ships with the base image. The database directory is owned
# by it so the process never needs to write anywhere root owns.
RUN mkdir -p /data && chown node:node /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node fixtures ./fixtures

USER node

ENV PORT=3000
ENV DB_PATH=/data/fankave.db
EXPOSE 3000

# The health endpoint probes SQLite, so a failing probe means a genuinely
# unusable container rather than just a live process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
