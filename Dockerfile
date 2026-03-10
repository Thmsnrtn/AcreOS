# syntax = docker/dockerfile:1

# ──────────────────────────────────────────────
# AcreOS — Multi-stage production Dockerfile
# ──────────────────────────────────────────────

ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

WORKDIR /app
ENV NODE_ENV="production"

# --- Build stage ---
FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

COPY package-lock.json package.json ./
# --audit fails the build if npm finds known vulnerabilities in the dependency tree
RUN npm ci --include=dev --audit

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# --- Production stage ---
FROM base

# Chromium for puppeteer-core (browser automation features)
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y chromium chromium-sandbox && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY --from=build /app /app

EXPOSE 5000

ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health/cached').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

# Task #132: Run as non-root user for container security
# node:slim ships with a built-in "node" user (uid 1000)
USER node

CMD ["node", "dist/index.cjs"]
