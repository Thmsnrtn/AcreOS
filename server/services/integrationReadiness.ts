/**
 * Integration readiness summary.
 *
 * Three customer-critical integrations are gated off purely for lack of
 * credentials: AWS SES (transactional + campaign email), Stripe (billing /
 * checkout), and Mapbox (map + reverse-geocode). Each works the instant the
 * founder sets the backing secret on Fly, and degrades honestly when absent.
 *
 * This module logs ONE structured summary at startup so the founder can see,
 * at a glance, which integrations are LIVE vs DARK.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SECURITY ([[feedback-credential-value-handling]]):
 *   Presence is detected via `!!process.env.X` ONLY. No secret VALUE is ever
 *   read into a string, logged, hashed, or returned. The summary reports the
 *   env-var NAMES that are missing — never their contents.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../utils/logger";

export interface IntegrationReadiness {
  /** Stable machine name, e.g. "aws_ses". */
  key: string;
  /** Human label, e.g. "AWS SES (email)". */
  label: string;
  /** True when every required env var for this integration is present. */
  live: boolean;
  /** What customers can/can't do while this integration is dark. */
  whenDark: string;
  /** Names (never values) of the env vars that are missing. */
  missingVars: string[];
  /** Names of optional/alias env vars (any one satisfies the requirement). */
  satisfiedBy?: string;
}

/**
 * Returns true iff every supplied env-var name is present and non-empty.
 * Reads presence ONLY — never the value.
 */
function presence(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

/**
 * Compute readiness for every customer-critical integration. Pure + side-effect
 * free so it can be unit-tested and reused by a future readiness endpoint.
 */
export function computeIntegrationReadiness(): IntegrationReadiness[] {
  const results: IntegrationReadiness[] = [];

  // ── AWS SES — transactional + campaign email ──────────────────────────────
  // Mirrors getPlatformCredentials() in emailService.ts: access key + secret +
  // from-email are required; region falls back to us-east-1 so it is optional.
  {
    const required = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SES_FROM_EMAIL"];
    const missingVars = required.filter((n) => !presence(n));
    results.push({
      key: "aws_ses",
      label: "AWS SES (email)",
      live: missingVars.length === 0,
      missingVars,
      whenDark:
        "transactional + campaign emails (signup confirmation, password reset, outreach) will not send",
    });
  }

  // ── Stripe — billing / checkout ───────────────────────────────────────────
  // STRIPE_SECRET_KEY is the gate for any Stripe API call. Per-tier price IDs
  // (STRIPE_PRICE_*) are reported separately by tier-pricing's checkout guard;
  // here we report the top-level billing on/off only.
  {
    const required = ["STRIPE_SECRET_KEY"];
    const missingVars = required.filter((n) => !presence(n));
    results.push({
      key: "stripe",
      label: "Stripe (billing)",
      live: missingVars.length === 0,
      missingVars,
      whenDark: "checkout, subscriptions, and seat purchases are disabled — no plan can be bought",
    });
  }

  // ── Mapbox — maps + reverse geocode ───────────────────────────────────────
  // Either token name satisfies the requirement; the client reads the
  // canonical VITE_MAPBOX_ACCESS_TOKEN, the server geocode proxy also accepts
  // VITE_MAPBOX_TOKEN + a server-only MAPBOX_TOKEN.
  {
    const tokenNames = ["VITE_MAPBOX_ACCESS_TOKEN", "VITE_MAPBOX_TOKEN", "MAPBOX_TOKEN"];
    const present = tokenNames.find((n) => presence(n));
    results.push({
      key: "mapbox",
      label: "Mapbox (maps)",
      live: Boolean(present),
      missingVars: present ? [] : tokenNames,
      satisfiedBy: present,
      whenDark:
        "the map surface shows an honest 'map unavailable' state and field reverse-geocoding returns 503",
    });
  }

  return results;
}

/**
 * Log a single structured summary of which customer-critical integrations are
 * LIVE vs DARK. Call once at startup. Never logs secret values — only NAMES.
 */
export function logIntegrationReadiness(): void {
  const readiness = computeIntegrationReadiness();
  const live = readiness.filter((r) => r.live).map((r) => r.label);
  const dark = readiness.filter((r) => !r.live);

  logger.info(
    `[integrations] Customer-critical readiness — LIVE: ${live.length ? live.join(", ") : "none"}` +
      ` · DARK: ${dark.length ? dark.map((r) => r.label).join(", ") : "none"}`,
    {
      source: "integration-readiness",
      metadata: {
        __pii_safe: true,
        live: readiness.filter((r) => r.live).map((r) => r.key),
        dark: dark.map((r) => ({
          key: r.key,
          // NAMES only — never values.
          missingEnvVars: r.missingVars,
          impact: r.whenDark,
        })),
      },
    },
  );

  // A clearly actionable WARN per dark integration so the founder sees exactly
  // which secret name to set — by NAME, never value.
  for (const r of dark) {
    logger.warn(
      `[integrations] ${r.label} is DARK — ${r.whenDark}. Set one of: ${r.missingVars.join(", ")} to activate.`,
      { source: "integration-readiness", metadata: { __pii_safe: true } },
    );
  }
}
