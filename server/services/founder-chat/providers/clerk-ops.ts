/**
 * Atlas Clerk operational provider (Phase G/H/I batch 2).
 *
 * Thin wrapper around the Clerk Backend API at https://api.clerk.com/v1
 * using CLERK_SECRET_KEY. Mirrors the graceful-degradation pattern of
 * providers/fly.ts — missing token throws a typed ClerkOpsError so
 * callers can render a friendly fallback artifact.
 *
 * Read-only:
 *   - getUser(userId)
 *
 * Destructive (Tier 3 for suspend; Tier 2 for restore / forcePasswordReset):
 *   - suspendUser(userId, reason)        — sets `banned: true`
 *   - restoreUser(userId)                — sets `banned: false`
 *   - forcePasswordReset(userId)         — invalidates active sessions
 */

import { createHash } from "node:crypto";
import { logger } from "../../../utils/logger";

export const CLERK_API_BASE = "https://api.clerk.com/v1";
const DEFAULT_TIMEOUT_MS = 8000;

export class ClerkOpsError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "ClerkOpsError";
    this.status = status;
    this.body = body;
  }
}

export interface ClerkUserSummary {
  id: string;
  email?: string | null;
  banned?: boolean;
  locked?: boolean;
  createdAt?: number;
  lastSignInAt?: number | null;
}

function token(): string {
  const t = process.env.CLERK_SECRET_KEY;
  if (!t) {
    throw new ClerkOpsError(
      "CLERK_SECRET_KEY not configured — Clerk tools unavailable in this environment",
      503,
    );
  }
  return t;
}

async function clerkFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${CLERK_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn("[clerk-ops] api non-ok", {
        metadata: { url, status: res.status, body: text.slice(0, 200) },
      });
      throw new ClerkOpsError(`Clerk API ${res.status} on ${path}`, res.status, text);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

function summarizeUser(raw: any): ClerkUserSummary {
  const email = raw?.email_addresses?.[0]?.email_address ?? null;
  return {
    id: raw?.id,
    email,
    banned: Boolean(raw?.banned),
    locked: Boolean(raw?.locked),
    createdAt: raw?.created_at,
    lastSignInAt: raw?.last_sign_in_at ?? null,
  };
}

export async function getUser(userId: string): Promise<ClerkUserSummary> {
  const raw = await clerkFetch<any>(`/users/${encodeURIComponent(userId)}`);
  return summarizeUser(raw);
}

export async function suspendUser(userId: string, reason: string): Promise<ClerkUserSummary> {
  logger.warn("[clerk-ops] suspendUser", {
    metadata: { userId, reasonFingerprint: createHash("sha256").update(reason).digest("hex").slice(0, 12) },
  });
  const raw = await clerkFetch<any>(`/users/${encodeURIComponent(userId)}/ban`, {
    method: "POST",
  });
  return summarizeUser(raw);
}

export async function restoreUser(userId: string): Promise<ClerkUserSummary> {
  logger.warn("[clerk-ops] restoreUser", { metadata: { userId } });
  const raw = await clerkFetch<any>(`/users/${encodeURIComponent(userId)}/unban`, {
    method: "POST",
  });
  return summarizeUser(raw);
}

/**
 * Force password reset = revoke all sessions for the user. Clerk doesn't
 * expose a single endpoint, so we list active sessions and revoke each.
 */
export async function forcePasswordReset(userId: string): Promise<{ revoked: number }> {
  const sessions = await clerkFetch<any[]>(
    `/sessions?user_id=${encodeURIComponent(userId)}&status=active`,
  );
  const list = Array.isArray(sessions) ? sessions : [];
  let revoked = 0;
  for (const s of list) {
    if (!s?.id) continue;
    try {
      await clerkFetch(`/sessions/${encodeURIComponent(s.id)}/revoke`, {
        method: "POST",
      });
      revoked += 1;
    } catch (err) {
      logger.warn("[clerk-ops] session revoke failed", {
        metadata: { userId, sessionId: s.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return { revoked };
}
