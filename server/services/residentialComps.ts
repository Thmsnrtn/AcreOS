/**
 * Residential comps / valuation seam — wave V3 of founder ruling #11
 * (the fix_and_flip demotion root cause, founder decision 2026-07-11).
 *
 * ROOT CAUSE: BUSINESS_TYPE_TO_INVESTOR_TYPE maps fix_and_flip (and the
 * whole landlord family) to "land", so flip customers were served LAND
 * comps / land AVM / land due-diligence under house labels.
 *
 * CONSTITUTIONAL CONSTRAINT (CLAUDE.md DO-NOT-DO,
 * `data.no-residential-comps-pre-trigger`): no residential-comps data PLANE
 * before its revenue trigger. This module is deliberately NOT a plane — no
 * bulk ingest, no dedicated vendors, no new tables. It is a thin routing
 * seam over the EXISTING provider registry that:
 *
 *   1. Restricts comps/valuation candidates to residential-capable
 *      providers — today exactly ATTOM (`RESIDENTIAL_CAPABLE_PROVIDERS`).
 *      Verified against providers-init: the only other comps/valuation
 *      provider is Regrid (starter tier, sorted BEFORE pro-tier ATTOM by
 *      the registry's tier ladder), and Regrid's "comps"/"valuation"
 *      delegate to the land-parcel services (comps.ts radius search /
 *      lookupParcelByCoordinates) — i.e. LAND data. The free tier registers
 *      NO comps/valuation provider at all. Without the restriction, a
 *      residential subject would silently get land comps.
 *   2. Degrades HONESTLY when no ATTOM key exists (platform env or the
 *      org's BYOK "attom" channel): an explicit unavailable state with the
 *      real fix path — never a land comp presented as a house comp, never
 *      an invented value.
 *   3. Keeps Lena's rails intact: ATTOM is pay-per-call
 *      (minMonthlyCommitCents 0, passes the 2%-of-MRR procurement gate);
 *      the registry itself meters credits (comps 20¢ / valuation 10¢ via
 *      comps_lookup / valuation_lookup) and BYOK-served lookups bypass the
 *      pool exactly as R1d designed.
 *
 * The effective registry tier passed here is "pro" ONLY because ATTOM is
 * registered pro-tier and access to residential data is governed by the
 * key + per-lookup credit metering, not the subscription ladder; the
 * allowlist means no other provider can leak in through the raised tier.
 */

import { providerRegistry } from "./providers/provider-registry";
import { attomProvider } from "./providers/attom-provider";
import { getConnectedDataProviders } from "./byok/dataByok";
import type { DataCategory, LookupInput, LookupResult } from "./providers/types";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

/** The only registered providers whose comps/valuation are house data. */
export const RESIDENTIAL_CAPABLE_PROVIDERS: readonly string[] = ["attom"];

// Settings path verified against the live client (2026-07-29): the ATTOM
// connect button lives in the connectors hub at /settings/byok — page title
// "Your provider keys", group "Property data" (client/src/pages/settings/
// byok.tsx). There is no "Settings → Connections" surface.
export const RESIDENTIAL_COMPS_UNAVAILABLE_MESSAGE =
  "Residential comps require an ATTOM connection — add a platform key or bring your own in Settings → Your provider keys (Property data → ATTOM Data).";
export const RESIDENTIAL_VALUATION_UNAVAILABLE_MESSAGE =
  "Residential valuation requires an ATTOM connection — add a platform key or bring your own in Settings → Your provider keys (Property data → ATTOM Data).";

export type ResidentialSubject =
  | { kind: "coordinates"; latitude: number; longitude: number }
  | { kind: "address"; street: string; city: string; state: string; zip: string };

export type ResidentialLookupOutcome =
  /** ATTOM answered — `result` is the registry LookupResult (provenance intact). */
  | { status: "ok"; result: LookupResult; byok: boolean }
  /**
   * Structurally unavailable — no ATTOM key (platform or BYOK), or the
   * platform-billed cost exceeds the org's credit balance. `message` is the
   * customer-facing text; render it verbatim. NEVER substitute land data.
   */
  | {
      status: "unavailable";
      reason: "attom_not_connected" | "insufficient_credits";
      message: string;
    }
  /** ATTOM was reachable in principle but the lookup produced nothing. */
  | { status: "no_data"; message: string };

/**
 * Read the org's onboarding-declared businessType
 * (organizations.onboardingData.businessType — same read contextProfile
 * uses). Null when unset/unknown; callers treat null as non-residential.
 */
export async function getOrgBusinessType(organizationId: number): Promise<string | null> {
  try {
    const [row] = await db
      .select({ onboardingData: organizations.onboardingData })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const bt = (row?.onboardingData as { businessType?: unknown } | null)?.businessType;
    return typeof bt === "string" && bt.length > 0 ? bt : null;
  } catch (err) {
    logger.warn("[residentialComps] businessType read failed — treating as non-residential", {
      source: "residentialComps",
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

function toLookupInput(subject: ResidentialSubject): LookupInput {
  return subject.kind === "coordinates"
    ? { type: "coordinates", latitude: subject.latitude, longitude: subject.longitude }
    : { type: "address", street: subject.street, city: subject.city, state: subject.state, zip: subject.zip };
}

async function residentialLookup(
  organizationId: number,
  subject: ResidentialSubject,
  category: Extract<DataCategory, "comps" | "valuation">,
): Promise<ResidentialLookupOutcome> {
  const unavailableMessage =
    category === "comps"
      ? RESIDENTIAL_COMPS_UNAVAILABLE_MESSAGE
      : RESIDENTIAL_VALUATION_UNAVAILABLE_MESSAGE;

  // Availability: the org's own ATTOM key (BYOK channel "attom") or the
  // platform ATTOM_API_KEY. getConnectedDataProviders degrades internally to
  // an empty set on failure (never breaks the lookup).
  const byok = (await getConnectedDataProviders(organizationId)).has("attom");
  const platformKeyed = await attomProvider.isConfigured().catch(() => false);

  if (!byok && !platformKeyed) {
    return { status: "unavailable", reason: "attom_not_connected", message: unavailableMessage };
  }

  // Affordability honesty: a platform-billed ATTOM lookup debits the org
  // credit pool (comps 20¢ / valuation 10¢). The registry would silently
  // skip an unaffordable provider and return null; surface the real reason
  // instead. BYOK lookups cost the platform nothing and always pass.
  const costCents = attomProvider.costPerLookupCents(category);
  let creditBalance = 0;
  if (!byok) {
    const { creditService } = await import("./credits");
    creditBalance = await creditService.getBalance(organizationId).catch(() => 0);
    if (creditBalance < costCents) {
      return {
        status: "unavailable",
        reason: "insufficient_credits",
        message: `Residential ${category === "comps" ? "comps" : "valuation"} lookups cost ${costCents}¢ each and your credit balance can't cover one — top up credits, or bring your own ATTOM key in Settings → Your provider keys (Property data → ATTOM Data).`,
      };
    }
  }

  const result = await providerRegistry.lookup(
    category,
    toLookupInput(subject),
    // "pro" is the ATTOM registration tier, not a subscription check — see
    // module header. The allowlist below is what keeps this residential-only.
    "pro",
    creditBalance,
    organizationId,
    { allowProviders: RESIDENTIAL_CAPABLE_PROVIDERS },
  );

  if (!result) {
    return {
      status: "no_data",
      message:
        category === "comps"
          ? "ATTOM returned no residential comparables for this property."
          : "ATTOM returned no residential valuation for this property.",
    };
  }

  return { status: "ok", result, byok };
}

/**
 * Residential comps for an org's subject property. Registry-routed
 * (cache/circuit/credit contract), restricted to residential-capable
 * providers. See ResidentialLookupOutcome for the honest degradation states.
 */
export async function getResidentialComps(
  organizationId: number,
  subject: ResidentialSubject,
): Promise<ResidentialLookupOutcome> {
  return residentialLookup(organizationId, subject, "comps");
}

/**
 * Residential AVM (ATTOM attomavm) for an org's subject property. Same
 * contract as getResidentialComps.
 */
export async function getResidentialValuation(
  organizationId: number,
  subject: ResidentialSubject,
): Promise<ResidentialLookupOutcome> {
  return residentialLookup(organizationId, subject, "valuation");
}

// ─── Defensive extraction of ATTOM payloads ─────────────────────────────────
//
// ATTOM propertyapi responses carry a `property` array (the same convention
// attom-provider.ts itself parses for owner_info/structure). These helpers
// pull ONLY fields that are actually present — absent fields stay null,
// never defaulted. Refuse-not-fabricate: an empty array / null return means
// "no data", and callers must render that honestly.

export interface ResidentialComp {
  address: string | null;
  city: string | null;
  state: string | null;
  salePrice: number | null;
  saleDate: string | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  lotAcres: number | null;
  distanceMiles: number | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Parse ATTOM sale/comparables data into normalized residential comps. */
export function extractResidentialComps(data: unknown): ResidentialComp[] {
  const props = (data as { property?: unknown[] } | null | undefined)?.property;
  if (!Array.isArray(props)) return [];

  const out: ResidentialComp[] = [];
  for (const raw of props) {
    const p = raw as Record<string, any>;
    const comp: ResidentialComp = {
      address: str(p?.address?.oneLine) ?? str(p?.address?.line1),
      city: str(p?.address?.locality),
      state: str(p?.address?.countrySubd),
      salePrice: num(p?.sale?.amount?.saleAmt ?? p?.sale?.amount?.saleamt),
      saleDate: str(p?.sale?.salesearchdate) ?? str(p?.sale?.saleTransDate) ?? str(p?.sale?.amount?.salerecdate),
      sqft: num(p?.building?.size?.livingSize ?? p?.building?.size?.livingsize),
      bedrooms: num(p?.building?.rooms?.beds),
      bathrooms: num(p?.building?.rooms?.bathsFull ?? p?.building?.rooms?.bathstotal),
      lotAcres: num(p?.lot?.lotSize1 ?? p?.lot?.lotsize1),
      distanceMiles: num(p?.location?.distance),
      latitude: num(p?.location?.latitude),
      longitude: num(p?.location?.longitude),
      propertyType: str(p?.summary?.propType) ?? str(p?.summary?.proptype),
    };
    // A comp with neither an address nor a sale price carries nothing a
    // customer can verify — drop it rather than render an empty husk.
    if (comp.address !== null || comp.salePrice !== null) out.push(comp);
  }
  return out;
}

export interface ResidentialAvm {
  value: number;
  low: number | null;
  high: number | null;
  /** ATTOM AVM confidence score (0–100) when provided. */
  score: number | null;
  asOf: string | null;
}

/** Parse ATTOM attomavm/detail data. Null when no usable value exists. */
export function extractResidentialAvm(data: unknown): ResidentialAvm | null {
  const prop = (data as { property?: unknown[] } | null | undefined)?.property?.[0] as
    | Record<string, any>
    | undefined;
  const amount = prop?.avm?.amount;
  const value = num(amount?.value);
  if (value === null || value <= 0) return null;
  return {
    value,
    low: num(amount?.low),
    high: num(amount?.high),
    score: num(amount?.scr),
    asOf: str(prop?.avm?.eventDate),
  };
}
