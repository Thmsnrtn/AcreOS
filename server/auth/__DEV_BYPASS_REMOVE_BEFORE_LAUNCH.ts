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
 * Three activation modes:
 *   1. HEADER  — `X-Dev-Founder-Bypass: <secret>` (per-request; for API calls)
 *      Injects req.auth.userId server-side. Backend-only — does NOT sign the
 *      user into Clerk's React client. Useful for raw API tests.
 *   2. COOKIE  — `?dev_bypass=<secret>` mints a signed HttpOnly cookie (1hr TTL)
 *      and redirects to strip the param. Backend-only as well — same caveat
 *      as the header path.
 *   3. SIGNIN  — `?dev_signin=<secret>` calls Clerk's Backend API to create a
 *      one-time sign-in token for the founder, then redirects to
 *      `<path>?__clerk_ticket=<token>`. Clerk's React client redeems the ticket
 *      into a real Clerk session and sets the `__session` cookie. After this,
 *      the SPA renders authenticated UI normally. Used for visual capture
 *      (1.1.B) and picker iframes (1.1.D). Requires `CLERK_SECRET_KEY` env var.
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
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

const BYPASS_ENABLED = process.env.DEV_FOUNDER_BYPASS === 'true';
const BYPASS_SECRET = process.env.DEV_FOUNDER_BYPASS_SECRET ?? '';
const FOUNDER_USER_ID = process.env.DEV_FOUNDER_USER_ID ?? '';

const COOKIE_NAME = '__dev_founder_bypass';
const COOKIE_TTL_MS = 60 * 60 * 1000; // 1 hour

const LAUNCH_MARKER = path.join(process.cwd(), '.launched');
// Use os.tmpdir() so the audit log is writable regardless of process uid.
// In containers /app is often root-owned while node runs as uid 1000 — /tmp
// (or os.tmpdir()) is always writable. To inspect on Fly:
//   fly ssh console -a acreos -C 'cat /tmp/dev-bypass-audit.log'
const BYPASS_LOG = path.join(os.tmpdir(), 'dev-bypass-audit.log');

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
function appendAudit(req: Request, mode: 'header' | 'cookie' | 'cookie-mint' | 'signin-ticket' | 'signin-ticket-failed') {
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

async function createClerkSignInTicket(userId: string): Promise<string | null> {
  const clerkSecret = process.env.CLERK_SECRET_KEY;
  if (!clerkSecret) return null;
  try {
    const resp = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clerkSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
    });
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.error('[DEV BYPASS] Clerk sign-in token failed:', resp.status, (await resp.text()).slice(0, 200));
      return null;
    }
    const data = (await resp.json()) as { token?: string };
    return typeof data.token === 'string' ? data.token : null;
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('[DEV BYPASS] Clerk sign-in token threw:', (err as Error)?.message ?? err);
    return null;
  }
}

export function devFounderBypass(req: Request, res: Response, next: NextFunction) {
  if (!BYPASS_ENABLED || !BYPASS_SECRET || !FOUNDER_USER_ID) return next();

  // Mode 1: Header (per-request server-side founder identity for API calls)
  const headerProvided = req.headers['x-dev-founder-bypass'];
  if (typeof headerProvided === 'string' && headerProvided.length > 0) {
    if (constantTimeEqual(headerProvided, BYPASS_SECRET)) {
      appendAudit(req, 'header');
      injectFounderAuth(req, FOUNDER_USER_ID);
    }
    return next();
  }

  // Mode 3: Signin ticket — call Clerk Backend API, redirect with ticket so
  // the SPA's Clerk client can redeem it into a real session. This is what
  // makes the SPA show authenticated UI for visual capture / picker iframes.
  const signinProvided = typeof req.query.dev_signin === 'string' ? req.query.dev_signin : '';
  if (signinProvided) {
    if (!constantTimeEqual(signinProvided, BYPASS_SECRET)) return next();
    // Async branch — return a promise (express handles thrown errors via next)
    void (async () => {
      const token = await createClerkSignInTicket(FOUNDER_USER_ID);
      if (!token) {
        appendAudit(req, 'signin-ticket-failed');
        return next();
      }
      appendAudit(req, 'signin-ticket');
      // Clerk only redeems __clerk_ticket on a page that mounts the <SignIn>
      // component (here: /auth). Redirect to /auth with the ticket and a
      // redirect_url that points to the originally-requested path. After
      // redemption, Clerk navigates to redirect_url with a real session.
      const original = new URL(req.originalUrl, 'http://placeholder');
      original.searchParams.delete('dev_signin');
      const redirectUrl = original.pathname + (original.search || '');
      const authUrl = new URL('/auth', 'http://placeholder');
      authUrl.searchParams.set('__clerk_ticket', token);
      authUrl.searchParams.set('redirect_url', redirectUrl);
      res.redirect(302, authUrl.pathname + authUrl.search);
    })();
    return;
  }

  // Mode 2a: Query-param mint (legacy picker iframe entry — backend identity only)
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

      const url = new URL(req.originalUrl, 'http://placeholder');
      url.searchParams.delete('dev_bypass');
      const target = url.pathname + (url.search ? url.search : '');
      return res.redirect(302, target);
    }
    return next();
  }

  // Mode 2b: Bypass cookie verification (legacy)
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
