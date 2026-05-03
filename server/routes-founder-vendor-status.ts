/**
 * Founder Vendor Status API
 *
 * Aggregates the public Statuspage feeds of our critical vendors
 * (Stripe, Twilio, SendGrid, Clerk) into a single tile on /founder-home.
 *
 * Philosophy: when something breaks, the founder's first question is
 * "is this them or us?" — the vendor-status tile answers that in one
 * glance without leaving the home page.
 *
 * Endpoint:
 *   GET /api/founder/vendor-status — aggregated current state
 *
 * Caching: 60s in-process. The vendor Statuspage feeds are cheap, but
 * polling them per page-load on every founder visit would be wasteful
 * (and racy under WS reconnect storms).
 */

import { Router, type Request, type Response } from "express";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

const router = Router();

type VendorIndicator = "none" | "minor" | "major" | "critical" | "maintenance" | "unknown";

interface VendorState {
  name: string;
  slug: string;
  indicator: VendorIndicator;
  description: string;
  url: string;
  fetchedAt: string;
  ok: boolean;
}

interface VendorStatusResponse {
  vendors: VendorState[];
  overall: "ok" | "incident" | "degraded" | "unknown";
  generatedAt: string;
  cachedFor: number;
}

interface StatuspageResponse {
  status?: { indicator?: string; description?: string };
}

interface VendorConfig {
  name: string;
  slug: string;
  url: string;     // Statuspage v2 status.json endpoint
  publicUrl: string; // Human-readable status page URL
}

const VENDORS: VendorConfig[] = [
  {
    name: "Stripe",
    slug: "stripe",
    url: "https://www.stripestatus.com/api/v2/status.json",
    publicUrl: "https://status.stripe.com",
  },
  {
    name: "Twilio",
    slug: "twilio",
    url: "https://status.twilio.com/api/v2/status.json",
    publicUrl: "https://status.twilio.com",
  },
  {
    name: "SendGrid",
    slug: "sendgrid",
    url: "https://status.sendgrid.com/api/v2/status.json",
    publicUrl: "https://status.sendgrid.com",
  },
  {
    name: "Clerk",
    slug: "clerk",
    url: "https://status.clerk.com/api/v2/status.json",
    publicUrl: "https://status.clerk.com",
  },
];

const CACHE_TTL_MS = 60_000;

let cached: { data: VendorStatusResponse; expiresAt: number } | null = null;

function normalizeIndicator(raw: string | undefined): VendorIndicator {
  if (!raw) return "unknown";
  const v = raw.toLowerCase();
  if (v === "none") return "none";
  if (v === "minor") return "minor";
  if (v === "major") return "major";
  if (v === "critical") return "critical";
  if (v === "maintenance") return "maintenance";
  return "unknown";
}

async function fetchVendor(v: VendorConfig): Promise<VendorState> {
  const fetchedAt = new Date().toISOString();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(v.url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) {
      return {
        name: v.name,
        slug: v.slug,
        indicator: "unknown",
        description: `Status page returned ${r.status}`,
        url: v.publicUrl,
        fetchedAt,
        ok: false,
      };
    }
    const json = (await r.json()) as StatuspageResponse;
    const indicator = normalizeIndicator(json.status?.indicator);
    return {
      name: v.name,
      slug: v.slug,
      indicator,
      description: json.status?.description ?? "Unknown",
      url: v.publicUrl,
      fetchedAt,
      ok: indicator === "none" || indicator === "maintenance",
    };
  } catch (err) {
    logger.warn("vendor-status: fetch failed", { vendor: v.slug, err: err instanceof Error ? err.message : String(err) });
    return {
      name: v.name,
      slug: v.slug,
      indicator: "unknown",
      description: "Could not reach status feed",
      url: v.publicUrl,
      fetchedAt,
      ok: false,
    };
  }
}

function rollupOverall(states: VendorState[]): VendorStatusResponse["overall"] {
  if (states.some((s) => s.indicator === "critical" || s.indicator === "major")) return "incident";
  if (states.some((s) => s.indicator === "minor" || s.indicator === "maintenance")) return "degraded";
  if (states.every((s) => s.indicator === "none")) return "ok";
  return "unknown";
}

export async function getVendorStatus(): Promise<VendorStatusResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  const results = await Promise.all(VENDORS.map(fetchVendor));
  const data: VendorStatusResponse = {
    vendors: results,
    overall: rollupOverall(results),
    generatedAt: new Date().toISOString(),
    cachedFor: Math.floor(CACHE_TTL_MS / 1000),
  };
  cached = { data, expiresAt: now + CACHE_TTL_MS };
  return data;
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await getVendorStatus();
    res.json(data);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Test-only hook: allow unit tests to clear the cache between runs.
export function _resetVendorStatusCacheForTests(): void {
  cached = null;
}

export default router;
