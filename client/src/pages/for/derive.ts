/**
 * Pure derivation for the /for/<vertical> marketing pages (G1.3).
 *
 * Everything the page renders is computed here from the two live registries
 * (shared/business-types.ts + client/src/lib/onboarding-verticals.ts) — pure
 * data + pure functions, no React, no DOM — so
 * tests/unit/forVerticalRoutes.test.ts can pin the derivation against the
 * live registry under vitest's node environment, exactly the
 * landingVerticalTiers.test.ts discipline: derived, never a snapshot.
 *
 * D-4: all 15 registered verticals are CORE. No maturity/beta treatment is
 * produced here; `maturity` is carried through verbatim from the registry so
 * the honesty pin ("no copy contradicts the registry maturity") stays
 * checkable, but the page renders no badge from it.
 */

import { VERTICAL_ONBOARDING } from "@/lib/onboarding-verticals";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
  type BusinessTypeId,
  type VerticalMaturity,
} from "@shared/business-types";
import { forVerticalPath, slugToBusinessTypeId } from "@shared/seo/public-routes";

// ───────────────────────────────────────────────────────────────────────────
// Display names for registry ids.
//
// Overrides are the REAL product labels, verbatim from the surfaces that ship
// them (client/src/components/layout-sidebar.tsx) — never invented. Ids with
// no override fall back to a mechanical kebab→sentence humanizer, so a new
// registry id renders legibly without touching this file.
// ───────────────────────────────────────────────────────────────────────────

export const SPOTLIGHT_MODULE_LABELS: Record<string, string> = {
  "ccr-templates": "CC&R templates",
  "dodd-frank": "Dodd-Frank checker",
  "regulatory-intel": "State rules",
  "wholesaler-state-rules": "Assignment legality",
  "investor-analytics": "Analytics",
  "earnest-money": "Earnest money",
  "double-close": "Double-close",
  "skip-tracing": "Skip Tracing",
  "ai-hub": "Pax",
  money: "Finance",
  maps: "Map",
};

export const INTEGRATION_LABELS: Record<string, string> = {
  county_gis: "County GIS",
  regrid: "Regrid",
  usda_nass: "USDA NASS",
  stripe: "Stripe",
  lob: "Lob",
  attom: "ATTOM",
  tax_identity: "Tax identity (1099)",
};

/** kebab/snake id → sentence-case words ("rent-roll" → "Rent roll"). */
export function humanizeRegistryId(id: string): string {
  const words = id.split(/[-_]/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function spotlightModuleLabel(id: string): string {
  return SPOTLIGHT_MODULE_LABELS[id] ?? humanizeRegistryId(id);
}

export function integrationLabel(id: string): string {
  return INTEGRATION_LABELS[id] ?? humanizeRegistryId(id);
}

// ───────────────────────────────────────────────────────────────────────────
// Derivation
// ───────────────────────────────────────────────────────────────────────────

export interface ForPageContent {
  id: BusinessTypeId;
  slug: string;
  path: string;
  /** Registry label, verbatim (test-pinned). */
  label: string;
  /** Registry maturity — carried for the honesty pin, never rendered as a badge (D-4). */
  maturity: VerticalMaturity;
  shortDescription: string;
  /** "land flippers" — headline audience words derived from the slug. */
  headlineAudience: string;
  /** The vertical's own pipeline vocabulary (VERTICAL_ONBOARDING.noun). */
  noun: string;
  /** Where onboarding finishes for this vertical — the real first surface. */
  finishCta: string;
  finishBlurb: string;
  spotlights: Array<{ id: string; label: string }>;
  integrations: Array<{ id: string; label: string }>;
  /** Every other vertical's /for page, for internal linking. */
  others: Array<{ id: BusinessTypeId; label: string; path: string }>;
}

export function deriveForPage(slug: string): ForPageContent | null {
  const id = slugToBusinessTypeId(slug);
  if (!id) return null;
  const meta = BUSINESS_TYPES[id];
  const onboarding = VERTICAL_ONBOARDING[id];
  return {
    id,
    slug,
    path: forVerticalPath(id),
    label: meta.label,
    maturity: meta.maturity,
    shortDescription: meta.shortDescription,
    headlineAudience: slug.split("-").join(" "),
    noun: onboarding.noun,
    finishCta: onboarding.finish.cta,
    finishBlurb: onboarding.finish.blurb,
    spotlights: meta.spotlightModules.map((m) => ({ id: m, label: spotlightModuleLabel(m) })),
    integrations: meta.integrations.map((i) => ({ id: i, label: integrationLabel(i) })),
    others: BUSINESS_TYPE_IDS.filter((o) => o !== id).map((o) => ({
      id: o,
      label: BUSINESS_TYPES[o].label,
      path: forVerticalPath(o),
    })),
  };
}
