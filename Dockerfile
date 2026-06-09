# syntax = docker/dockerfile:1

# ──────────────────────────────────────────────
# AcreOS — Multi-stage production Dockerfile
# ──────────────────────────────────────────────

ARG NODE_VERSION=22.21.1
# Deploy-time git SHA. Flows into VITE_GIT_SHA so (1) vite bakes it into the
# client bundle at build and (2) the runtime server reports it at /api/version
# and injects it into window.__ENV__. The version-check self-heal compares the
# two — when a new deploy changes the SHA, every open tab reloads itself onto
# the new build with no manual cache clearing. Defaults to "unknown" for local
# builds that don't pass it.
ARG GIT_SHA=unknown
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

WORKDIR /app
ENV NODE_ENV="production"

# --- Build stage ---
FROM base AS build

# Re-declare to bring the global ARG into this stage's scope, then expose it
# as VITE_GIT_SHA so `vite build` bakes it into the client bundle.
ARG GIT_SHA
ENV VITE_GIT_SHA=${GIT_SHA}

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

COPY package-lock.json package.json ./
RUN npm ci --include=dev --legacy-peer-deps

COPY . .
RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

# --- Production stage ---
FROM base

# Re-declare so the runtime server (process.env.VITE_GIT_SHA) reports the same
# SHA the client bundle was built with — /api/version and window.__ENV__.
ARG GIT_SHA
ENV VITE_GIT_SHA=${GIT_SHA}

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
# Runtime-only heap cap for the Node server (Fly machine sizing). This ENV is
# declared in the final production stage, which does NOT run `npm run build`
# (that happens in the `build` stage above, with no NODE_OPTIONS set), so it
# never throttles the build tooling — only the `node dist/index.cjs` CMD.
ENV NODE_OPTIONS="--max-old-space-size=3584"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health/cached').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

# Task #132: Run as non-root user for container security
# node:slim ships with a built-in "node" user (uid 1000)
USER node

CMD ["node", "dist/index.cjs"]
