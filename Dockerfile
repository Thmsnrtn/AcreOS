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

# --- gh CLI build stage ---
# gh IS required at runtime in the prod image: server/services/
# evolutionPrGenerator.ts opens PRs via `gh pr list` / `gh pr create` from
# the Fly machine (Rosy River C3), and server/routes-agent-prereqs.ts
# health-checks `gh auth status`. So it can't be dropped from the final
# stage — but the apt package (cli.github.com stable, v2.93.0) is compiled
# with Go 1.26.3, whose stdlib carries CVE-2026-42504 (HIGH) +
# CVE-2026-42507 / CVE-2026-27145 (MEDIUM) — all fixed in Go 1.26.4. No
# upstream gh release has been rebuilt against 1.26.4 yet (v2.93.0 shipped
# 2026-05-27), so we compile the SAME pinned gh release from source with
# the patched toolchain. CGO_ENABLED=0 → static binary, no extra runtime
# deps in the final stage. Bump GH_VERSION when upstream ships a release
# built on a patched Go and this stage collapses to a version pin.
# (Known residual: in-toto-golang v0.9.0 is vendored by gh upstream —
# GHSA-pmwq-pjrm-6p5r, MEDIUM, below the image scan's CRITICAL/HIGH gate;
# clears when gh bumps the dep.)
FROM golang:1.26.4-bookworm AS gh-build
ARG GH_VERSION=v2.93.0
RUN CGO_ENABLED=0 go install github.com/cli/cli/v2/cmd/gh@${GH_VERSION}

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

# Chromium for puppeteer-core (browser automation features) + git for
# Rosy River C3 — the evolution pipeline pushes branches and opens PRs from
# this machine, which needs git + gh + GH_TOKEN (or `gh auth login`) at
# runtime. node:slim ships with neither. gh itself comes from the gh-build
# stage above (compiled against the patched Go toolchain — see that stage's
# comment), NOT from the cli.github.com apt repo, so the keyring/repo
# bootstrap (and its gnupg dependency) is gone.
# `apt-get upgrade` first: node:slim base tags lag Debian security updates
# (e.g. openssl/libssl3 and chromium HIGH CVEs flagged by the Trivy image
# gate), so we pull the current patch level at build time rather than
# shipping whatever the base image froze.
RUN apt-get update -qq && \
    apt-get upgrade -y -qq && \
    apt-get install --no-install-recommends -y chromium chromium-sandbox git curl ca-certificates && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY --from=gh-build /go/bin/gh /usr/bin/gh

# The npm CLI bundled with the node base image vendors its own copies of
# tar/minimatch/glob/picomatch, which routinely trail their CVE fixes and
# trip the HIGH gate in the Trivy image scan. Refreshing npm itself pulls
# the patched vendored tree. Runtime app deps are unaffected (installed in
# the build stage from package-lock.json).
RUN npm install -g npm@latest && npm cache clean --force

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
