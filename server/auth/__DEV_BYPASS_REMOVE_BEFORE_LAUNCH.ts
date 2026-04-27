/**
 * ⚠️  DEVELOPMENT-ONLY FOUNDER AUTHENTICATION BYPASS  ⚠️
 *
 * THIS FILE MUST BE DELETED at Gap 1.1.G (or before public launch — whichever first).
 * Removal protocol: docs/exhaustive-completion/REMOVE-BEFORE-LAUNCH.md
 *
 * Purpose: enables Claude Code to perform visual verification of auth-gated
 * surfaces during pre-launch development. The platform is not yet live with
 * real customers, so this bypass cannot impact users.
 *
 * Two activation modes:
 *   1. HEADER  — `X-Dev-Founder-Bypass: <secret>` (per-request; for Playwright captures)
 *   2. COOKIE  — `?dev_bypass=<secret>` query param mints a signed HttpOnly cookie
 *      with 1-hour TTL, then redirects to strip the param. Subsequent requests
 *      use the cookie automatically (for picker iframes — must be same-origin).
 *
 * Safety locks:
 *   - Inert unless DEV_FOUNDER_BYPASS=true AND DEV_FOUNDER_BYPASS_SECRET set
 *   - Refuses to start (process.exit FATAL) if NODE_ENV=production AND the
 *     `.launched` marker file exists at repo root
 *   - Every successful bypass logged to dev-bypass-audit.log (gitignored)
 *   - Constant-time secret comparison (defense in depth — even though leaks
 *     would already require server access)
 */

import type { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BYPASS_ENABLED = process.env.DEV_FOUNDER_BYPASS === 'true';
const BYPASS_SECRET = process.env.DEV_FOUNDER_BYPASS_SECRET ?? '';
const FOUNDER_USER_ID = process.env.DEV_FOUNDER_USER_ID ?? '';

const COOKIE_NAME = '__dev_founder_bypass';
const COOKIE_TTL_MS = 60 * 60 * 1000; // 1 hour

const LAUNCH_MARKER = path.join(process.cwd(), '.launched');
const BYPASS_LOG = path.join(process.cwd(), 'dev-bypass-audit.log');

if (BYPASS_ENABLED && process.env.NODE_ENV === 'production' && fs.existsSync(LAUNCH_MARKER)) {
  // eslint-disable-next-line no-console
  console.error(
    'FATAL: DEV_FOUNDER_BYPASS is active in launched production. ' +
    'Remove the env var or delete .launched before this app starts.'
  );
  process.exit(1);
}

if (BYPASS_ENABLED && BYPASS_SECRET && FOUNDER_USER_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    '[DEV BYPASS] Active. Header X-Dev-Founder-Bypass and cookie path enabled. ' +
    'Must be removed at Gap 1.1.G.'
  );
} else if (BYPASS_ENABLED) {
  // eslint-disable-next-line no-console
  console.warn(
    '[DEV BYPASS] DEV_FOUNDER_BYPASS=true but secret/user-id not set — bypass will not activate.'
  );
}

let auditWarned = false;
function appendAudit(req: Request, mode: 'header' | 'cookie' | 'cookie-mint') {
  try {
    const ua = (req.headers['user-agent'] ?? '').toString().slice(0, 80);
    const ip = (req.ip ?? 'unknown').toString();
    const entry = `${new Date().toISOString()} ${mode} ${req.method} ${req.path} ip=${ip} ua=${ua}\n`;
    fs.appendFileSync(BYPASS_LOG, entry);
  } catch (err: unknown) {
    // Never let audit-log failure break the request — but surface the error
    // once so we know if logging is silently broken.
    if (!auditWarned) {
      auditWarned = true;
      // eslint-disable-next-line no-console
      console.error('[DEV BYPASS] audit-log write failed:', (err as Error)?.message ?? err);
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', BYPASS_SECRET).update(payload).digest('hex');
}

function mintCookieValue(): string {
  const data = JSON.stringify({
    sub: FOUNDER_USER_ID,
    iat: Date.now(),
    exp: Date.now() + COOKIE_TTL_MS,
  });
  const payload = Buffer.from(data).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyCookieValue(value: string): { valid: boolean; sub?: string } {
  if (!value) return { valid: false };
  const parts = value.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payload, sig] = parts;
  if (!constantTimeEqual(sig, sign(payload))) return { valid: false };
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.exp !== 'number' || Date.now() > data.exp) return { valid: false };
    if (typeof data.sub !== 'string' || !data.sub) return { valid: false };
    return { valid: true, sub: data.sub };
  } catch {
    return { valid: false };
  }
}

function injectFounderAuth(req: Request, userId: string) {
  // clerkMiddleware defines req.auth via Object.defineProperty, often as a
  // getter. Use defineProperty to ensure our value wins for downstream
  // middleware (hydrateUser reads req.auth.userId).
  Object.defineProperty(req, 'auth', {
    value: { userId },
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function devFounderBypass(req: Request, res: Response, next: NextFunction) {
  if (!BYPASS_ENABLED || !BYPASS_SECRET || !FOUNDER_USER_ID) return next();

  // Mode 1: Header (Playwright captures)
  const headerProvided = req.headers['x-dev-founder-bypass'];
  if (typeof headerProvided === 'string' && headerProvided.length > 0) {
    if (constantTimeEqual(headerProvided, BYPASS_SECRET)) {
      appendAudit(req, 'header');
      injectFounderAuth(req, FOUNDER_USER_ID);
    }
    return next();
  }

  // Mode 2a: Query-param mint (picker iframe entry point)
  const queryProvided = typeof req.query.dev_bypass === 'string' ? req.query.dev_bypass : '';
  if (queryProvided) {
    if (constantTimeEqual(queryProvided, BYPASS_SECRET)) {
      appendAudit(req, 'cookie-mint');
      const cookieAttrs = [
        `${COOKIE_NAME}=${mintCookieValue()}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(COOKIE_TTL_MS / 1000)}`,
      ];
      if (process.env.NODE_ENV === 'production') cookieAttrs.push('Secure');
      res.setHeader('Set-Cookie', cookieAttrs.join('; '));

      // Redirect to same path with the dev_bypass param stripped
      const url = new URL(req.originalUrl, 'http://placeholder');
      url.searchParams.delete('dev_bypass');
      const target = url.pathname + (url.search ? url.search : '');
      return res.redirect(302, target);
    }
    // Wrong secret — silent fall-through to normal auth (no audit)
    return next();
  }

  // Mode 2b: Cookie verification (subsequent picker requests)
  const cookieHeader = req.headers.cookie ?? '';
  const cookieMatch = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(cookieHeader);
  if (cookieMatch) {
    const result = verifyCookieValue(cookieMatch[1]);
    if (result.valid && result.sub) {
      appendAudit(req, 'cookie');
      injectFounderAuth(req, result.sub);
    }
  }

  return next();
}

export function isBypassActive(): boolean {
  return BYPASS_ENABLED && Boolean(BYPASS_SECRET) && Boolean(FOUNDER_USER_ID);
}
