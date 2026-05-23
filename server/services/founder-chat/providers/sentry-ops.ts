/**
 * Atlas Sentry read-only provider (Phase I — operations batch 1).
 *
 * Thin wrapper around the Sentry REST API for the "I broke prod" loop:
 *   - listRecentIssues({ since, severity }) — unresolved issues in window
 *   - getIssueDetails(issueId)              — title/culprit/counts/seen
 *   - getLatestEventForIssue(issueId)       — frames + tags for the
 *                                             most-recent event
 *
 * Auth: SENTRY_AUTH_TOKEN, scoped under SENTRY_ORG + SENTRY_PROJECT.
 * Missing-token degrades gracefully: helpers throw a typed
 * SentryClientError that the registered tool catches and renders as
 * `Sentry unavailable (…)` text — same shape as fly.ts.
 *
 * Read-only only. Resolve/assign/ignore mutations land in Phase I
 * batch 2 with the Tier-3 confirmation flow.
 */

import { logger } from "../../../utils/logger";

export const SENTRY_API_BASE = "https://sentry.io/api/0";

const DEFAULT_TIMEOUT_MS = 8000;

export class SentryClientError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "SentryClientError";
    this.status = status;
    this.body = body;
  }
}

function token(): string {
  const t = process.env.SENTRY_AUTH_TOKEN;
  if (!t) {
    throw new SentryClientError(
      "SENTRY_AUTH_TOKEN not configured — Sentry tools unavailable in this environment",
      503,
    );
  }
  return t;
}

function org(): string {
  const o = process.env.SENTRY_ORG;
  if (!o) {
    throw new SentryClientError(
      "SENTRY_ORG not configured — Sentry tools unavailable in this environment",
      503,
    );
  }
  return o;
}

function project(): string {
  const p = process.env.SENTRY_PROJECT;
  if (!p) {
    throw new SentryClientError(
      "SENTRY_PROJECT not configured — Sentry tools unavailable in this environment",
      503,
    );
  }
  return p;
}

async function sentryFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${SENTRY_API_BASE}${path}`;
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
      logger.warn(
        { url, status: res.status, body: text.slice(0, 200) },
        "sentry api non-ok",
      );
      throw new SentryClientError(
        `Sentry API ${res.status} on ${path}`,
        res.status,
        text,
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

export interface SentryIssueSummary {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
}

export interface SentryEventFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

export interface SentryEvent {
  id: string;
  eventID?: string;
  message?: string;
  title?: string;
  dateCreated?: string;
  platform?: string;
  tags?: Array<{ key: string; value: string }>;
  entries?: Array<{
    type: string;
    data?: {
      values?: Array<{
        type?: string;
        value?: string;
        stacktrace?: { frames?: SentryEventFrame[] };
      }>;
    };
  }>;
}

/**
 * Unresolved issues in the given stats period (`24h`, `7d`, etc).
 * Optionally filter by severity (Sentry "level": fatal/error/warning/info/debug).
 */
export async function listRecentIssues(
  since = "24h",
  severity?: string,
): Promise<SentryIssueSummary[]> {
  const queryBits = ["is:unresolved"];
  if (severity) queryBits.push(`level:${severity}`);
  const params = new URLSearchParams({
    statsPeriod: since,
    query: queryBits.join(" "),
    limit: "25",
  });
  const path = `/projects/${encodeURIComponent(org())}/${encodeURIComponent(project())}/issues/?${params.toString()}`;
  const data = await sentryFetch<SentryIssueSummary[]>(path);
  return Array.isArray(data) ? data : [];
}

export async function getIssueDetails(issueId: string): Promise<SentryIssueSummary> {
  // Touch token/org so a missing env degrades before we hit the network.
  token();
  return sentryFetch<SentryIssueSummary>(`/issues/${encodeURIComponent(issueId)}/`);
}

export async function getLatestEventForIssue(
  issueId: string,
): Promise<SentryEvent> {
  token();
  return sentryFetch<SentryEvent>(`/issues/${encodeURIComponent(issueId)}/events/latest/`);
}

// ─── Destructive operations (Phase G/H/I batch 2) ───────────────────────────

/**
 * Mark a Sentry issue resolved. Tier 2 destructive.
 */
export async function resolveIssue(
  issueId: string,
  reason: string,
): Promise<SentryIssueSummary> {
  logger.warn("[sentry-ops] resolveIssue", { metadata: { issueId, reason: reason.slice(0, 200) } });
  const updated = await sentryFetch<SentryIssueSummary>(
    `/issues/${encodeURIComponent(issueId)}/`,
    {
      method: "PUT",
      body: JSON.stringify({ status: "resolved" }),
    },
  );
  return updated;
}

/** Reopen a Sentry issue. Used by the rollback recipe. */
export async function unresolveIssue(issueId: string): Promise<SentryIssueSummary> {
  return sentryFetch<SentryIssueSummary>(
    `/issues/${encodeURIComponent(issueId)}/`,
    { method: "PUT", body: JSON.stringify({ status: "unresolved" }) },
  );
}
