/**
 * Brand profile service — the load-bearing artifact for the CMO ad engine.
 *
 * Every script, voice generation, asset selection, quality score, and banned-
 * phrase check reads from `brand_profiles`. The single most important table
 * in the CMO stack.
 *
 * v1 has exactly one row (AcreOS). The schema and helpers are written so a
 * second brand would be a new row, not a refactor — but no multi-tenant
 * abstraction layer is introduced yet (KISS).
 *
 * Seeding is idempotent: `seedAcreosBrandProfile()` creates a missing row
 * and is called on server boot. Founders edit the profile via
 * `/api/founder/cmo/brand-profile` (server/routes-cmo.ts).
 */

import { db } from "../../db";
import { brandProfiles, cmoBudget, type BrandProfile } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { ACREOS_VOICE_POOL } from "./voicePool";
import { clock } from "../../utils/clock";

const ACREOS_SLUG = "acreos";

/**
 * Seed the canonical AcreOS brand profile without overwriting founder edits. Pulled from
 * client/src/pages/landing/copy.ts and the existing TEMPLATE_CONTEXT
 * in adCreativeService.ts so the brand voice stays unified across the
 * landing page and the ad engine.
 *
 * Banned phrases include both compliance-driven items (real-estate ad rules)
 * and voice-driven items (no first-person, no Thomas, no guru language).
 * The list compounds over time as the founder rejects variants with notes.
 */
export async function seedAcreosBrandProfile(): Promise<BrandProfile> {
  const existing = await db.query.brandProfiles.findFirst({
    where: eq(brandProfiles.slug, ACREOS_SLUG),
  });
  if (existing) return existing;

  const profileData = {
    slug: ACREOS_SLUG,
    displayName: "AcreOS",
    oneLiner: "The operating system for property investors — deepest in land",
    audiencePrimary:
      "Solo and small-team property investors doing 1-10 deals per month — land flippers, note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, buy-and-hold landlords. They hate spreadsheet chaos and 20-hour manual comps research.",
    audienceSecondary:
      "Newer property investors who got burned by old-school courses, want a serious operating system, and don't trust generic CRMs to understand their workflow.",
    toneDescriptors: [
      "direct",
      "mechanics-first",
      "third-person",
      "technical-but-accessible",
      "skeptical-of-guru-energy",
      "respects-the-reader",
    ],
    usps: [
      "Research parcels, organize deals, prepare offers, and manage seller-financed notes in one workspace",
      "Pax helps investigate records and prepare work inside AcreOS",
      "Core land workflows, with additional property strategies at varying stages of readiness",
      "Prepares offers and deal documents for review and provider handoff",
      "Action trails and receipts for supported workflows",
      "Published self-service plans with pricing and included allowances",
    ],
    bannedPhrases: [
      // Voice
      "passive income",
      "financial freedom",
      "game-changer",
      "real estate professional",
      "real-estate operator",
      "operator",
      "Thomas",
      "I built this",
      "Built by an investor",
      "thomas@acreos.io",
      // Compliance (real-estate advertising rules)
      "guaranteed returns",
      "risk-free",
      "make $X in Y days",
      "no money down",
      "double your money",
    ],
    complianceRules: [
      {
        name: "no_guaranteed_returns",
        pattern: "(guaranteed|risk-free|no-risk|no risk).*(return|profit|income|yield)",
        reason: "Real-estate advertising compliance — no return guarantees without disclaimer.",
      },
      {
        name: "no_income_claims_without_disclaimer",
        pattern: "(make|earn|get) \\$[0-9,]+ (in|per|a) (day|week|month|year)",
        reason: "Specific income claims require a results-not-typical disclaimer.",
      },
    ],
    brandKit: {
      // Fieldstone identity (2026-10-18). Seed default for a NEW profile only —
      // an existing (possibly founder-edited) profile row is never rewritten.
      primaryColor: "#123B32",   // forest
      secondaryColor: "#192C28", // ink
      accentColor: "#B79A5B",    // brass
      logoPath: "/images/acreos-mark.svg",
      fonts: {
        display: "Fraunces", // serif on landing
        body: "Inter",       // sans body
      },
    },
    voice: {
      provider: "elevenlabs" as const,
      // Curated pool of ElevenLabs preset voices — no founder clone. The
      // script generator picks one per script (biased by archetype) so the
      // ad library has tonal variety without sounding inconsistent. See
      // server/services/cmo/voicePool.ts for the curated list.
      pool: ACREOS_VOICE_POOL,
      // Legacy fields kept for jsonb shape compatibility — the renderer reads
      // voiceId from cmo_scripts.voice_id, not from the brand profile.
      voiceId: null,
      stability: 0.55,
      similarityBoost: 0.75,
      sampleScripts: [
        "Review available parcel records and their sources before making an offer.",
        "Organize land leads and use Pax to prepare research and work for review.",
        "Track seller-financed notes and inspect payment and servicing receipts.",
      ],
    },
    funnelStages: {
      cold: {
        hookStyle: "problem_specific",
        ctaLabel: "Start free trial",
        ctaUrl: "https://acreos.io/auth?mode=register&utm_source=ads&utm_medium=cmo&utm_campaign=cold",
      },
      warm: {
        hookStyle: "feature_proof",
        ctaLabel: "See the 60-second demo",
        ctaUrl: "https://acreos.io/?utm_source=ads&utm_medium=cmo&utm_campaign=warm#how",
      },
      retargeting: {
        hookStyle: "objection_handle",
        ctaLabel: "Start free trial",
        ctaUrl: "https://acreos.io/auth?mode=register&utm_source=ads&utm_medium=cmo&utm_campaign=retargeting",
      },
    },
    founderVoiceSamples: [
      "Find or import parcel records, review the available evidence, prepare offers and outreach, and track land deals with clear approvals.",
      "Define the buy-box, prepare the work and review the evidence. The investor makes the decision.",
      "Prepare replies for review. Queuing work does not confirm that a message was sent.",
    ],
    referenceAds: [],
    autoGenerationEnabled: false,
  };

  const [created] = await db
    .insert(brandProfiles)
    .values(profileData)
    .returning();
  logger.info(`[cmo] brand profile '${ACREOS_SLUG}' created (id=${created.id})`);

  // Seed default budget alongside the brand profile so the agent has a
  // budget envelope to respect from day one.
  await db
    .insert(cmoBudget)
    .values({ brandProfileId: created.id })
    .onConflictDoNothing();

  return created;
}

export async function getAcreosBrandProfile(): Promise<BrandProfile | null> {
  const profile = await db.query.brandProfiles.findFirst({
    where: eq(brandProfiles.slug, ACREOS_SLUG),
  });
  return profile ?? null;
}

export async function getBrandProfileBySlug(slug: string): Promise<BrandProfile | null> {
  const profile = await db.query.brandProfiles.findFirst({
    where: eq(brandProfiles.slug, slug),
  });
  return profile ?? null;
}

export async function updateBrandProfile(
  id: number,
  updates: Partial<typeof brandProfiles.$inferInsert>,
): Promise<BrandProfile> {
  const [updated] = await db
    .update(brandProfiles)
    .set({ ...updates, updatedAt: clock.now() })
    .where(eq(brandProfiles.id, id))
    .returning();
  return updated;
}
