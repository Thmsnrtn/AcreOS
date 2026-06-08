/**
 * /api/public/parcel-check — public, no-auth parcel due-diligence read (Soren, 2026-06-06).
 *
 * The unauthenticated proof-of-the-moat surface. A stranger pastes an address
 * or APN and gets back the same free government data the product runs on every
 * parcel in a customer's buy-box: FEMA flood zone, USDA SSURGO soil, USGS
 * elevation/slope, USFWS wetlands, and Census tract context — each carrying the
 * provenance contract (source / sourceAsOf / classification / confidence).
 *
 * Why this exists (docs/internal/roadmap/_lenses/soren.md §1): the data engine
 * is the single most defensible thing we run, and it was invisible to every
 * stranger arriving from search. Rendering it publicly turns "best-in-class
 * data on a free tier" from a claim into a demonstration — the cheapest
 * acquisition channel we have.
 *
 * Architecture (thin wrapper, owns no data logic):
 *   - geocode address → lat/lng via the free Census onelineaddress geocoder
 *     (APN flows require a lat/lng the public path can't resolve without a paid
 *     parcel provider, so APN-only input returns an honest "needs coordinates"
 *     partial rather than a fabricated answer).
 *   - dataSourceBroker.lookupMultiple(..., { maxTier: "free" }) — hard-capped
 *     to the free providers. Paid/byok sources are never reachable here.
 *   - provider_cache (dataSourceCache) is the broker's own 30-day cache, so a
 *     popular parcel is a single DB read, not N upstream calls.
 *
 * Abuse limits (feedback_rate_limit_ip_keying): keyed by a client-supplied
 * session id FIRST, then the rounded parcel coordinate, and only IP as a last
 * resort — carrier NAT shares one egress IP across many phones, so a pure-IP
 * cap would 429 every other mobile visitor. A second, coarser per-IP ceiling
 * guards against a single host rotating session ids.
 *
 * Honesty contract (Wave-1 patterns): partial and empty states are first-class.
 * A category that fails or returns nothing renders as "no data" with its source
 * named — we never fabricate a value to make the page look complete.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createRateLimiter } from "./middleware/rateLimit";
import type { LookupCategory } from "./services/data-source-broker";
import { resolveParcel } from "./services/parcel/resolveParcel";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// The free-tier categories we surface publicly. Deliberately the five that
// map 1:1 to a land investor's first-pass due diligence — and all of which the
// open-data broker serves from free government sources.
const PUBLIC_CATEGORIES: LookupCategory[] = [
  "flood_zone",
  "soil",
  "elevation",
  "wetlands",
  "demographics",
];

const querySchema = z
  .object({
    // Either an address (geocoded) or raw lat/lng. APN is accepted for display
    // but cannot be resolved to coordinates on the free path.
    address: z.string().min(3).max(512).optional(),
    apn: z.string().min(2).max(128).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    // Client-supplied stable session id (NOT a credential) — the primary rate
    // limit key so carrier-NAT phones don't share one IP bucket.
    sid: z.string().min(8).max(64).optional(),
  })
  .strict();

interface GeocodeResult {
  lat: number;
  lng: number;
  matchedAddress: string;
}

/**
 * Census onelineaddress geocoder — free, no key, US coverage. Returns the
 * first match's coordinates and the canonicalized address string. Never throws
 * into the caller; returns null on any failure so the route degrades honestly.
 */
async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AcreOS Real Estate Platform" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    const lat = Number(match.coordinates.y);
    const lng = Number(match.coordinates.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, matchedAddress: match.matchedAddress ?? address };
  } catch {
    return null;
  }
}

/**
 * Map a broker LookupCategory to the provenance classification the public chip
 * renders. Authoritative government records read as authoritative; the elevation
 * point and demographics tract are modeled/estimate-grade.
 */
function classificationFor(
  category: LookupCategory,
): "authoritative" | "estimate" | "modeled" | "unknown" {
  switch (category) {
    case "flood_zone":
    case "wetlands":
    case "soil":
      return "authoritative";
    case "elevation":
      return "modeled";
    case "demographics":
      return "estimate";
    default:
      return "unknown";
  }
}

// Best-effort "as of" the data carries. The broker results stamp lastUpdated as
// fetch time, which is NOT the source's vintage — so we derive an honest
// source-vintage label per dataset rather than mislabel a fetch time as the
// authoritative date.
// source: Census ACS 5-Year 2018-2022 (the one dataset with a fixed vintage;
//         FEMA NFHL / USDA SSURGO / USGS 3DEP / USFWS NWI are continuously
//         revised, so we let the chip omit a year rather than assert a wrong one).
const SOURCE_AS_OF: Partial<Record<LookupCategory, string>> = {
  demographics: "2022", // ACS 5-Year 2018–2022
};

interface PublicCategoryResult {
  category: LookupCategory;
  available: boolean;
  data: unknown;
  source: string | null;
  sourceAsOf: string | null;
  classification: "authoritative" | "estimate" | "modeled" | "unknown";
  confidence: number | null;
  fromCache: boolean;
}

// Primary key: client session id. Fallback: rounded coordinate so a single
// session id can't sweep the whole map. IP is the floor only.
function parcelCheckKey(req: Request): string {
  const sid = (req.query.sid as string | undefined) ?? "";
  if (sid.length >= 8) return `parcelcheck:sid:${sid}`;
  const lat = req.query.lat as string | undefined;
  const lng = req.query.lng as string | undefined;
  if (lat && lng) return `parcelcheck:geo:${Number(lat).toFixed(2)}:${Number(lng).toFixed(2)}`;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `parcelcheck:ip:${ip}`;
}

// 20 lookups / minute / session — generous for a human exploring a few parcels,
// tight on a scraper. Cache makes repeats nearly free regardless.
const sessionLimiter = createRateLimiter(
  { maxRequests: 20, windowMs: 60 * 1000 },
  parcelCheckKey,
);

// Coarser per-IP ceiling: 120 / 10 min. Catches a host rotating session ids
// without punishing a single shared-NAT phone (which the session key already
// isolates). Pure-IP is acceptable HERE only as a secondary backstop.
const ipCeiling = createRateLimiter(
  { maxRequests: 120, windowMs: 10 * 60 * 1000 },
  (req: Request) => `parcelcheck:ipceil:${req.ip || req.socket.remoteAddress || "unknown"}`,
);

/**
 * Resolve coordinates from the parsed query, mirroring the non-streaming path.
 * Returns either coordinates (+ optional matchedAddress) or an honest unresolved
 * reason the caller can emit verbatim. Never throws — degrades honestly.
 */
async function resolveCoordinates(
  parsed: z.infer<typeof querySchema>,
): Promise<
  | { ok: true; lat: number; lng: number; matchedAddress: string | null }
  | { ok: false; reason: string; message: string; query: Record<string, unknown> }
> {
  const { address, apn, lat: rawLat, lng: rawLng } = parsed;

  if (!address && rawLat === undefined && rawLng === undefined) {
    if (apn) {
      return {
        ok: false,
        reason: "apn_needs_coordinates",
        message:
          "Looking up by parcel number (APN) needs the parcel's location, which paid providers supply. Paste the property address instead, or sign up to run APN lookups inside your buy-box.",
        query: { apn },
      };
    }
    return {
      ok: false,
      reason: "missing_input",
      message: "Provide an address or coordinates.",
      query: {},
    };
  }

  let lat = rawLat;
  let lng = rawLng;
  let matchedAddress: string | null = null;

  if ((lat === undefined || lng === undefined) && address) {
    const geo = await geocodeAddress(address);
    if (!geo) {
      return {
        ok: false,
        reason: "address_not_found",
        message:
          "Could not locate that address in the Census geocoder. Try a more complete street address, or paste coordinates.",
        query: { address },
      };
    }
    lat = geo.lat;
    lng = geo.lng;
    matchedAddress = geo.matchedAddress;
  }

  if (lat === undefined || lng === undefined) {
    return {
      ok: false,
      reason: "coordinates_unresolved",
      message: "Could not resolve coordinates.",
      query: {},
    };
  }

  return { ok: true, lat, lng, matchedAddress };
}

/**
 * Map a single broker ResolvedCategory into the public response shape, applying
 * the public honesty overrides (SOURCE_AS_OF, classificationFor) verbatim — so
 * the streaming tile and the batch tile are byte-identical for the same source.
 */
function toPublicResult(
  category: LookupCategory,
  r:
    | {
        available: boolean;
        data: unknown;
        source: string | null;
        fromCache: boolean;
      }
    | undefined,
): PublicCategoryResult {
  const ok = !!r && r.available && r.data != null;
  return {
    category,
    available: ok,
    data: ok ? r!.data : null,
    source: ok ? r!.source : null,
    sourceAsOf: SOURCE_AS_OF[category] ?? null,
    classification: classificationFor(category),
    confidence: null,
    fromCache: ok ? r!.fromCache : false,
  };
}

/**
 * GET /api/public/parcel-check/stream — the streaming variant (Krieger, the
 * boldest UX bet). Emits each free source's result over Server-Sent Events AS
 * IT RESOLVES, rather than all-then-return, so the customer WATCHES the
 * diligence pull happen source-by-named-source — the felt embodiment of the
 * honest-data thesis on the exact surface a stranger hits pre-signup.
 *
 * Wire protocol (named SSE events, JSON data):
 *   event: meta       — { coordinates, matchedAddress, categories: [...] }   (once, first)
 *   event: source     — a PublicCategoryResult, one per category as it resolves
 *   event: done       — { successCount, failureCount, lookupTimeMs }         (once, last)
 *   event: unresolved — { reason, message, query }  (terminal, replaces meta+source+done)
 *   event: error      — { message }                  (terminal, on internal failure)
 *
 * Semantics are identical to the batch endpoint: same resolveParcel spine, same
 * cache/circuit/provenance, same free-tier cap, same honesty overrides. The only
 * difference is WHEN each tile arrives. A source that misses streams an honest
 * "not available" tile (available:false), never a fabricated value.
 *
 * Each category is resolved through its own resolveParcel call. enrichAll already
 * runs categories sequentially against a shared spine, so per-category resolution
 * preserves the exact same cache + circuit + provenance behavior while letting us
 * flush each result the instant it lands.
 */
router.get("/stream", ipCeiling, sessionLimiter, async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return Errors.validationFailed(res, parsed.error.issues);
  }

  // SSE headers. `X-Accel-Buffering: no` defeats nginx/proxy buffering so each
  // event flushes immediately. We never compress this stream.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Flush headers so the browser opens the EventSource before the first source.
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // If the client disconnects mid-pull, stop resolving further sources.
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    const coords = await resolveCoordinates(parsed.data);
    if (!coords.ok) {
      send("unresolved", {
        reason: coords.reason,
        message: coords.message,
        query: coords.query,
      });
      return res.end();
    }

    send("meta", {
      coordinates: { lat: coords.lat, lng: coords.lng },
      matchedAddress: coords.matchedAddress,
      categories: PUBLIC_CATEGORIES,
    });

    const started = Date.now();
    let successCount = 0;
    let failureCount = 0;

    for (const category of PUBLIC_CATEGORIES) {
      if (aborted || res.writableEnded) break;
      try {
        // One category per resolveParcel call — same spine, same cache/circuit,
        // flushed the instant it lands. A failing category degrades to an
        // honest empty tile rather than aborting the whole stream.
        const resolved = await resolveParcel(
          { type: "coordinates", latitude: coords.lat, longitude: coords.lng },
          { categories: [category], orgTier: "free", maxTier: "free" },
        );
        const result = toPublicResult(category, resolved.results[category]);
        if (result.available) successCount += 1;
        else failureCount += 1;
        send("source", result);
      } catch (error) {
        logger.warn("[public-parcel-check] stream source failed", {
          category,
          error: error instanceof Error ? error.message : String(error),
        });
        failureCount += 1;
        // Honest: a source that throws streams an unavailable tile, never a fake.
        send("source", toPublicResult(category, undefined));
      }
    }

    if (!aborted && !res.writableEnded) {
      send("done", {
        successCount,
        failureCount,
        lookupTimeMs: Date.now() - started,
      });
    }
    return res.end();
  } catch (error) {
    logger.error("[public-parcel-check] stream failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.writableEnded) {
      send("error", {
        message: "Something went wrong running that check. Try again in a moment.",
      });
      return res.end();
    }
  }
});

router.get("/", ipCeiling, sessionLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { address, apn, lat: rawLat, lng: rawLng } = parsed.data;

    if (!address && rawLat === undefined && rawLng === undefined) {
      // APN-only (no coordinates) — honest partial. Resolving an APN to a
      // point requires a paid parcel provider we don't expose on the free
      // path, so we say so instead of guessing.
      if (apn) {
        return res.json({
          resolved: false,
          reason: "apn_needs_coordinates",
          message:
            "Looking up by parcel number (APN) needs the parcel's location, which paid providers supply. Paste the property address instead, or sign up to run APN lookups inside your buy-box.",
          query: { apn },
          results: [],
        });
      }
      return Errors.badRequest(res, "Provide an address or coordinates");
    }

    // Resolve coordinates: explicit lat/lng wins; otherwise geocode the address.
    let lat = rawLat;
    let lng = rawLng;
    let matchedAddress: string | null = null;

    if ((lat === undefined || lng === undefined) && address) {
      const geo = await geocodeAddress(address);
      if (!geo) {
        return res.json({
          resolved: false,
          reason: "address_not_found",
          message:
            "Could not locate that address in the Census geocoder. Try a more complete street address, or paste coordinates.",
          query: { address },
          results: [],
        });
      }
      lat = geo.lat;
      lng = geo.lng;
      matchedAddress = geo.matchedAddress;
    }

    if (lat === undefined || lng === undefined) {
      return Errors.badRequest(res, "Could not resolve coordinates");
    }

    // Free-tier ONLY, through the unified parcel spine. resolveParcel delegates
    // to the provider registry (its cache / circuit / provenance) as the primary
    // path and the broker only for categories the registry doesn't yet cover —
    // so this public widget now shares ONE cache + circuit story with every
    // other door. maxTier:"free" keeps paid/byok sources unreachable, identical
    // to the prior broker contract. The public honesty overrides below
    // (SOURCE_AS_OF, classificationFor) are preserved verbatim, so the response
    // shape and values are unchanged.
    const resolved = await resolveParcel(
      { type: "coordinates", latitude: lat, longitude: lng },
      {
        categories: PUBLIC_CATEGORIES,
        orgTier: "free",
        maxTier: "free",
      },
    );

    const results: PublicCategoryResult[] = PUBLIC_CATEGORIES.map((category) => {
      const r = resolved.results[category];
      const ok = !!r && r.available && r.data != null;
      return {
        category,
        available: ok,
        data: ok ? r.data : null,
        source: ok ? r.source : null,
        sourceAsOf: SOURCE_AS_OF[category] ?? null,
        classification: classificationFor(category),
        confidence: null,
        fromCache: ok ? r.fromCache : false,
      };
    });

    return res.json({
      resolved: true,
      coordinates: { lat, lng },
      matchedAddress,
      results,
      meta: {
        lookupTimeMs: resolved.meta.lookupTimeMs,
        successCount: resolved.meta.successCount,
        failureCount: resolved.meta.failureCount,
      },
    });
  } catch (error) {
    logger.error("[public-parcel-check] lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

export default router;
