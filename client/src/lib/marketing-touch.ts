/**
 * Marketing-touch client emitter (Soren, 2026-06-06).
 *
 * The browser side of the acquisition event substrate
 * (docs/internal/marketing-os/03-analytics.md §2 + §4). Manages a 1st-party
 * `anonymous_id` cookie and POSTs every pre-signup marketing/lifecycle
 * touchpoint to /api/marketing/touch, where it lands in the canonical
 * `marketing_touch` Postgres table we own.
 *
 * This is the DURABLE substrate. lib/analytics.ts (PostHog) still fires in
 * parallel for the rented dashboard layer — but PostHog can be blocked by
 * extensions and its data leaves our infra, so this owns the raw record.
 *
 * Design:
 *   - Single typed emitter: emitMarketingTouch({ surface, eventType, … }).
 *   - anonymous_id: a 1st-party cookie (365d) so the chain persists across
 *     visits AND survives the auth handshake. The same id is later POSTed to
 *     /api/me/acquisition-utm so the server JOINs the chain → the new account.
 *   - UTM enrichment: folds in the session's captured UTM snapshot (from
 *     lib/acquisition-utm) so every touch carries attribution.
 *   - Fire-and-forget: uses navigator.sendBeacon when available (survives
 *     page unload), falls back to fetch+keepalive. NEVER throws — a failed
 *     analytics beacon must not break the page.
 */

import { readPendingUtm } from "./acquisition-utm";

const ANON_COOKIE = "acreos_anon_id";
const ANON_MAX_AGE_DAYS = 365;

export type MarketingTouchEventType =
  | "page_view"
  | "cta_click"
  | "funnel_step"
  | "email_open"
  | "email_click";

export interface MarketingTouchInput {
  /** 'landing' | 'landing:cta' | 'learn:land-flipping:texas' | 'signup:started' | … */
  surface: string;
  eventType?: MarketingTouchEventType;
  /** marketing_artifact id when the surface is a tracked artifact. */
  sourceArtifactId?: string;
  /** Event-specific extras: { step, durationMs, ctaId, … }. */
  payload?: Record<string, unknown>;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeDays: number): void {
  if (typeof document === "undefined") return;
  const maxAge = maxAgeDays * 24 * 60 * 60;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

function newAnonId(): string {
  // crypto.randomUUID where available; fall back to a timestamp+random id.
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "");
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Return the stable 1st-party anonymous id, minting + persisting one on first
 * call. Exposed so the post-signup flush can send it to the server's
 * marketing_touch backfill (see App.tsx + acquisition-utm flush).
 */
export function getAnonymousId(): string {
  const existing = readCookie(ANON_COOKIE);
  if (existing && existing.length >= 8) return existing;
  const fresh = newAnonId();
  writeCookie(ANON_COOKIE, fresh, ANON_MAX_AGE_DAYS);
  return fresh;
}

function deviceType(): "mobile" | "tablet" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|PlayBook|Silk/.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Emit a marketing touch to the owned substrate. Best-effort, never throws.
 * Folds in the session's captured UTM + the current landing path so every
 * touch carries attribution.
 */
export function emitMarketingTouch(input: MarketingTouchInput): void {
  if (typeof window === "undefined") return;
  try {
    const utm = readPendingUtm();
    const body = {
      anonymousId: getAnonymousId(),
      surface: input.surface,
      eventType: input.eventType ?? "page_view",
      sourceArtifactId: input.sourceArtifactId,
      landingPath: window.location.pathname + window.location.search,
      deviceType: deviceType(),
      referrer: utm?.referrer,
      utm_source: utm?.utm_source,
      utm_medium: utm?.utm_medium,
      utm_campaign: utm?.utm_campaign,
      utm_term: utm?.utm_term,
      utm_content: utm?.utm_content,
      payload: input.payload,
    };
    // Drop undefined keys so the strict server schema doesn't reject them.
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) clean[k] = v;
    }
    const json = JSON.stringify(clean);

    // sendBeacon survives page unload (e.g. a CTA click that navigates away).
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([json], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/marketing/touch", blob);
      if (ok) return;
    }
    // Fallback: keepalive fetch so an in-flight beacon survives navigation.
    // unchecked-mutation: marketing touch beacon. Nothing in the UI claims it was recorded.
    void fetch("/api/marketing/touch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
      credentials: "include",
    }).catch(() => {
      /* best-effort — analytics must never break the app */
    });
  } catch {
    /* best-effort — never throw from a telemetry emit */
  }
}
