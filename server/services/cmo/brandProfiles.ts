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
 * Seeding is idempotent: `seedAcreosBrandProfile()` upserts the canonical row
 * and is called on server boot. Founders edit the profile via
 * `/api/founder/cmo/brand-profile` (server/routes-cmo.ts).
 */

import { db } from "../../db";
import { brandProfiles, cmoBudget, type BrandProfile } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { ACREOS_VOICE_POOL } from "./voicePool";

const ACREOS_SLUG = "acreos";

/**
 * Seed (or update) the canonical AcreOS brand profile. Pulled from
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
      "Pulls comps in 30 seconds, not 30 minutes",
      "Pax (AI ops partner) drafts replies, scores leads, and services notes overnight",
      "Multi-vertical: land, notes, fix-and-flip, wholesale, subdivide, tax-delinquent, buy-and-hold",
      "Built-in offer composer, e-sign, escrow handoff — no DocuSign needed",
      "Audit log on every agent action — what, when, why, what data it used",
      "Transparent pricing on the page, no contact-us wall",
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
      primaryColor: "#A04428",   // brand orange (homestead palette)
      secondaryColor: "#1F1810", // ink
      accentColor: "#B8842E",
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
        "AcreOS pulls comps in thirty seconds for any APN. The same workflow that used to take an evening on PropStream.",
        "Three hundred leads in your spreadsheet. None of them ranked. Pax scores every one overnight and surfaces the four worth your morning call.",
        "Your note serviced. Receipt sent. Late notice queued. You touched nothing.",
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
      "Pull lists, run comps, send mail, draft replies, and track every deal through closing. Whether you flip land, buy notes, rehab houses, wholesale contracts, subdivide, or buy-and-hold — AcreOS does the busy work so the operator only handles judgment calls.",
      "Three steps. Most happens on its own. Define the buy-box. AcreOS does the busy work. Operator makes the calls.",
      "Replies drafted within sixty seconds of an inbound message, queued for review before send.",
    ],
    referenceAds: [],
    autoGenerationEnabled: false,
  };

  if (existing) {
    const [updated] = await db
      .update(brandProfiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(eq(brandProfiles.id, existing.id))
      .returning();
    logger.info(`[cmo] brand profile '${ACREOS_SLUG}' updated (id=${updated.id})`);
    return updated;
  }

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
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(brandProfiles.id, id))
    .returning();
  return updated;
}
