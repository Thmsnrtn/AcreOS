# ──────────────────────────────────────────────
# AcreOS — Multi-stage production Dockerfile
# ──────────────────────────────────────────────

# --- Stage 1: build ---
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# --- Stage 2: production ---
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json* yarn.lock* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# bcrypt needs native bindings — rebuild in the runner stage
RUN npm rebuild bcrypt

# Copy build artefacts from builder
COPY --from=builder /app/dist ./dist

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health/cached').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.cjs"]
