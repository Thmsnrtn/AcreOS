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
RUN npm ci --include=dev --legacy-peer-deps

COPY . .
RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

# --- Production stage ---
FROM base

# Chromium for puppeteer-core (browser automation features) +
# gh CLI + git for Rosy River C3 — the evolution pipeline opens PRs via `gh`
# from this machine, which requires both packages and GH_TOKEN (or
# `gh auth login`) at runtime. node:slim ships without either.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y chromium chromium-sandbox git curl ca-certificates gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update -qq && \
    apt-get install --no-install-recommends -y gh && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY --from=build /app /app

EXPOSE 5000

ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
ENV NODE_OPTIONS="--max-old-space-size=3584"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health/cached').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

# Task #132: Run as non-root user for container security
# node:slim ships with a built-in "node" user (uid 1000)
USER node

CMD ["node", "dist/index.cjs"]
