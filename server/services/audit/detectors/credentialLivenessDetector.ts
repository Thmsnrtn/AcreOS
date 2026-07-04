// ============================================================================
// server/services/audit/detectors/credentialLivenessDetector.ts
// ----------------------------------------------------------------------------
// TESS (reliability) — vendor credential LIVENESS watchdog.
//
// Born from the 2026-07-04 secrets audit: FOUR configured credentials were
// silently dead (AWS SES key deleted in IAM, Anthropic 401, OpenAI 401,
// SendGrid 401) while every readiness surface reported them "live" — because
// readiness only checks env-var PRESENCE. A key that exists but no longer
// authenticates is invisible until the first real send/charge fails.
//
// This detector re-authenticates each configured vendor against its FREE
// read-only endpoint once per domain-audit sweep (daily). Rules:
//   - key ABSENT  → no finding (that's a config choice; integrationReadiness
//                   already reports dark integrations)
//   - key present + auth OK → no finding
//   - key present + auth FAILS → finding (critical for revenue/auth/wedge
//                   vendors, warn for fallback-only vendors)
//   - probe network error → warn (transient blips age out via staleFindings)
//
// No secret value is ever logged — vendor names and HTTP statuses only.
// Endpoints are all free auth checks; nothing here spends money.
// ============================================================================

import type { DomainDetector, FindingInput } from "../domainAudit";

const CITED =
  "Ops doctrine: a configured credential that no longer authenticates must page at cause-time — presence checks lie, and the first symptom otherwise is a failed customer send/charge.";

export type ProbeFetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

interface VendorCheck {
  vendor: string;
  /** Stable dedupe suffix. */
  key: string;
  severity: "warn" | "critical";
  /** Why this severity — included in the finding detail. */
  impact: string;
  /** Env var(s); first present one is used. Undefined return = not configured. */
  envVar: () => string | undefined;
  /** Build the free auth-check request. */
  request: (envName: string) => { url: string; init: RequestInit };
}

const first = (...names: string[]) =>
  names.find((n) => typeof process.env[n] === "string" && (process.env[n] as string).length > 0);

const basic = (user: string, pass = "") =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

export const VENDOR_CHECKS: VendorCheck[] = [
  {
    vendor: "Stripe", key: "stripe", severity: "critical",
    impact: "checkout, subscriptions, and dunning are all down",
    envVar: () => first("STRIPE_SECRET_KEY"),
    request: () => ({ url: "https://api.stripe.com/v1/balance", init: { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } } }),
  },
  {
    vendor: "Lob (direct mail)", key: "lob", severity: "critical",
    impact: "the wedge — no mailer can ship",
    envVar: () => first("LOB_LIVE_API_KEY", "LOB_TEST_API_KEY", "LOB_API_KEY"),
    request: (n) => ({ url: "https://api.lob.com/v1/addresses?limit=1", init: { headers: { Authorization: basic(process.env[n] as string) } } }),
  },
  {
    vendor: "OpenRouter (primary AI)", key: "openrouter", severity: "critical",
    impact: "Pax and every AI surface route through OpenRouter first",
    envVar: () => first("AI_INTEGRATIONS_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"),
    request: (n) => ({ url: "https://openrouter.ai/api/v1/key", init: { headers: { Authorization: `Bearer ${process.env[n]}` } } }),
  },
  {
    vendor: "Clerk (auth)", key: "clerk", severity: "critical",
    impact: "sign-in/identity API calls fail",
    envVar: () => first("CLERK_SECRET_KEY"),
    request: () => ({ url: "https://api.clerk.com/v1/users?limit=1", init: { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } } }),
  },
  {
    vendor: "Anthropic (direct)", key: "anthropic", severity: "warn",
    impact: "direct-Anthropic side paths (constitutional checker, SCP evolution) fail; primary AI still routes via OpenRouter",
    envVar: () => first("ANTHROPIC_API_KEY"),
    request: () => ({ url: "https://api.anthropic.com/v1/models", init: { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" } } }),
  },
  {
    vendor: "OpenAI (fallback)", key: "openai", severity: "warn",
    impact: "AI fallback path unavailable when OpenRouter degrades",
    envVar: () => first("AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY"),
    request: (n) => ({ url: "https://api.openai.com/v1/models", init: { headers: { Authorization: `Bearer ${process.env[n]}` } } }),
  },
  {
    vendor: "SendGrid", key: "sendgrid", severity: "warn",
    impact: "org custom-domain registration + SendGrid webhooks fail (platform email rides SES)",
    envVar: () => first("SENDGRID_API_KEY"),
    request: () => ({ url: "https://api.sendgrid.com/v3/scopes", init: { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` } } }),
  },
  {
    vendor: "Twilio (SMS)", key: "twilio", severity: "critical",
    impact: "SMS — the dominant seller-reply channel — is down",
    envVar: () => (first("TWILIO_ACCOUNT_SID") && first("TWILIO_AUTH_TOKEN") ? "TWILIO_ACCOUNT_SID" : undefined),
    request: () => ({
      url: `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}.json`,
      init: { headers: { Authorization: basic(process.env.TWILIO_ACCOUNT_SID as string, process.env.TWILIO_AUTH_TOKEN as string) } },
    }),
  },
  {
    vendor: "Mapbox (maps)", key: "mapbox", severity: "warn",
    impact: "map tiles + geocoding degrade to the honest 'map unavailable' state",
    envVar: () => first("VITE_MAPBOX_ACCESS_TOKEN", "VITE_MAPBOX_TOKEN", "MAPBOX_TOKEN", "MAPBOX_PUBLIC_TOKEN"),
    request: (n) => ({ url: `https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(process.env[n] as string)}`, init: {} }),
  },
];

const defaultFetch: ProbeFetch = async (url, init) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(t);
  }
};

export function buildCredentialLivenessDetector(fetchFn: ProbeFetch = defaultFetch): DomainDetector {
  return {
    id: "credential_liveness",
    domain: "reliability",
    async run(): Promise<FindingInput[]> {
      const findings: FindingInput[] = [];
      for (const check of VENDOR_CHECKS) {
        const envName = check.envVar();
        if (!envName) continue; // not configured — integrationReadiness's turf

        try {
          const { url, init } = check.request(envName);
          const res = await fetchFn(url, init);
          if (!res.ok) {
            findings.push({
              domain: "reliability",
              detector: "credential_liveness",
              severity: check.severity,
              title: `${check.vendor} credential is DEAD (HTTP ${res.status})`,
              detail: `${envName} is set but the vendor rejects it (HTTP ${res.status}). Impact: ${check.impact}. Rotate the key at the vendor and update Fly secrets.`,
              citedReason: CITED,
              dedupeKey: `dead:${check.key}`,
              metadata: { status: res.status, envVar: envName },
            });
          }
        } catch (err) {
          findings.push({
            domain: "reliability",
            detector: "credential_liveness",
            severity: "warn",
            title: `${check.vendor} liveness probe errored`,
            detail: `Auth check could not complete: ${(err as Error).message.slice(0, 120)}. Transient network blips age out; a persistent error means the watchdog is blind for this vendor.`,
            citedReason: CITED,
            dedupeKey: `probe_error:${check.key}`,
          });
        }
      }
      return findings;
    },
  };
}

export const credentialLivenessDetector: DomainDetector = buildCredentialLivenessDetector();
