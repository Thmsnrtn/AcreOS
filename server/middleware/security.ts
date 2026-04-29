import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── F-A05-1: Per-request CSP nonce ─────────────────────────────────────────
// In production, generate a unique nonce per response and embed it in the CSP.
// The nonce must also be injected into the HTML shell (see static.ts / index.html).
// In development, fall back to 'unsafe-inline'/'unsafe-eval' for HMR compatibility.
// The nonce is stored in res.locals.cspNonce for use by the static file server.

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Skip CSP for Clerk proxy — Clerk manages its own headers
  if (req.path.startsWith("/__clerk")) return next();

  // REMOVE_BEFORE_LAUNCH (Gap 1.1.G): the variant picker + prototype need
  // unpkg.com (React+Babel CDN), inline eval (Babel-in-browser), framing
  // by self, etc. Skip strict CSP for /__dev/* when bypass is active —
  // these routes are dev-only and gated on DEV_FOUNDER_BYPASS.
  if (
    process.env.DEV_FOUNDER_BYPASS === "true" &&
    req.path.startsWith("/__dev/")
  ) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Looser CSP: allow unpkg + inline eval (Babel) + same-origin framing
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; " +
        "frame-ancestors 'self'; " +
        "img-src 'self' data: blob: https:; " +
        "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' https: 'unsafe-inline';"
    );
    return next();
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), interest-cohort=()");

  // Generate a per-request nonce for inline scripts/styles.
  // Available to downstream handlers (e.g. static.ts) via res.locals.cspNonce.
  const nonce = crypto.randomBytes(16).toString("base64");
  res.locals.cspNonce = nonce;

  const scriptSrcSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "https://js.stripe.com",
    "https://api.mapbox.com",
    "https://*.clerk.accounts.dev",
    "https://challenges.cloudflare.com",
  ];

  // unsafe-eval is only needed in development (Vite HMR / source maps)
  if (process.env.NODE_ENV !== "production") {
    scriptSrcSources.push("'unsafe-eval'");
  }

  const cspDirectives = [
    "default-src 'self'",
    `script-src ${scriptSrcSources.join(" ")}`,
    // Fonts are self-hosted from /fonts/* per design-system §0.1 — no
    // runtime Google Fonts CDN. Mapbox CSS still required for tile styling.
    `style-src 'self' 'unsafe-inline' https://api.mapbox.com`,
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com https://api.mapbox.com https://events.mapbox.com https://*.clerk.accounts.dev https://*.clerk.dev wss: ws:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.clerk.accounts.dev https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // REMOVE_BEFORE_LAUNCH (Gap 1.1.G): bypass active = picker may frame
    // same-origin pages (production iframes inside picker). Default stays
    // 'none' for prod.
    process.env.DEV_FOUNDER_BYPASS === "true" ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  ];

  // Only upgrade to HTTPS in production
  if (process.env.NODE_ENV === "production") {
    cspDirectives.push("upgrade-insecure-requests");
    // Task #F-A05-2: CSP violation reporting endpoint
    cspDirectives.push("report-uri /api/csp-report");
  }

  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  next();
}

const ALLOWED_ORIGINS: (string | RegExp)[] = [];

// Only allow localhost origins in non-production environments
if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push(
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:8080",
  );
}

// Add production domain from APP_URL env var
if (process.env.APP_URL) {
  try {
    const appOrigin = new URL(process.env.APP_URL).origin;
    ALLOWED_ORIGINS.push(appOrigin);
  } catch {
    // Invalid APP_URL, skip
  }
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some((allowed) => {
      if (typeof allowed === "string") {
        return allowed === origin;
      }
      return allowed.test(origin);
    });
    
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-CSRF-Token");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  next();
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
// AI / LLM routes are intentionally slow (model inference latency, tool
// calls, etc). Keep them on a dedicated longer cap so Pax/Atlas prompts
// don't die at the 30s wall. If this gets too long we should add a
// streaming response path; until then 90s covers p95 of OpenRouter.
const AI_REQUEST_TIMEOUT_MS = 90000;

function timeoutForPath(path: string): number {
  if (path.startsWith("/api/ai/") || path.startsWith("/api/pax/") || path.startsWith("/api/atlas/")) {
    return AI_REQUEST_TIMEOUT_MS;
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

export function requestTimeout(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const timeoutMs = timeoutForPath(req.originalUrl || req.path);
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      const { logger } = require("../utils/logger");
      logger.warn("Request timeout exceeded", {
        method: req.method,
        path: req.originalUrl || req.path,
        duration: Date.now() - startTime,
        timeoutMs,
      });
      res.status(504).json({
        error: "Gateway Timeout",
        message: "Request took too long to process",
        statusCode: 504,
      });
    }
  }, timeoutMs);

  res.on("finish", () => clearTimeout(timeout));
  res.on("close", () => clearTimeout(timeout));

  next();
}

export function validateContentType(req: Request, res: Response, next: NextFunction) {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = req.headers["content-type"];

    if (req.path.includes("/webhook")) {
      return next();
    }

    // Browsers post CSP violations as application/csp-report (legacy) or
    // application/reports+json (Report-To). Let them through to the handler.
    if (req.path === "/api/csp-report") {
      return next();
    }

    if (contentType && !contentType.includes("application/json") &&
        !contentType.includes("application/x-www-form-urlencoded") &&
        !contentType.includes("multipart/form-data")) {
      return res.status(415).json({ message: "Unsupported Media Type" });
    }
  }

  next();
}

// Patterns that indicate attempted XSS or header injection in query parameters.
// Covers common vectors: script tags, event handlers, javascript: URIs, data: URIs,
// and CRLF injection (\r or \n that could split HTTP headers).
export function sanitizeQueryParams(req: Request, res: Response, next: NextFunction) {
  for (const key of Object.keys(req.query)) {
    const value = req.query[key];
    if (typeof value === "string") {
      if (
        /<script/i.test(value) ||
        /javascript\s*:/i.test(value) ||
        /vbscript\s*:/i.test(value) ||
        /data\s*:\s*text\/html/i.test(value) ||
        /on\w+\s*=/i.test(value) || // event handlers like onerror=, onclick=
        /[\r\n]/.test(value) // CRLF injection
      ) {
        return res.status(400).json({ message: "Invalid query parameter" });
      }
    }
  }
  next();
}
