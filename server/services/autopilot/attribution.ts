/**
 * Founder Autopilot — attribution (close the last mile, Batch D).
 *
 * At signup-flush, the witnessed marketing_touch chain for the new account is
 * scanned for a reference to a published autopilot artifact. If a touch carries
 * `utm_content=art_<id>` or landed on `/field-notes/<slug>` that resolves to a
 * REAL marketing_artifacts row, a signup conversion is recorded. This keys off
 * the witnessed touch evidence, never the racy `acquisitionUtm` user blob.
 *
 * Discipline (locked by the audit):
 *  - It is a LOWER BOUND. A missing row is absent evidence, never a "failure".
 *  - It is FOUNDER-DASHBOARD ONLY in T0 — never fed to outcomeOf / the learning
 *    loop (that needs a real holdout, deferred).
 *  - A `utm_content` hint is only honored if it resolves to a real artifact row
 *    (an unverified hint can't fabricate a conversion).
 *
 * parseArtifactRef is pure → testable; the rest is best-effort DB glue that
 * never throws into the signup flow.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { marketingTouch, marketingArtifacts, autopilotConversions } from "@shared/schema";
import { logger } from "../../utils/logger";

export interface ArtifactRef {
  byId?: number;
  bySlug?: string;
}

/**
 * Extract an artifact reference from a single touch's utm_content + landing
 * path. Pure + total. Returns {} when neither references an autopilot artifact.
 */
export function parseArtifactRef(utmContent: string | null, landingPath: string | null): ArtifactRef {
  const ref: ArtifactRef = {};
  if (utmContent) {
    const m = /^art_(\d+)$/.exec(utmContent.trim());
    if (m) ref.byId = Number(m[1]);
  }
  if (!ref.byId && landingPath) {
    const m = /^\/field-notes\/([a-z0-9-]+)\/?$/i.exec(landingPath.trim());
    if (m) ref.bySlug = m[1];
  }
  return ref;
}

/**
 * Attribute a signup to a published artifact off the touch chain. Best-effort;
 * never throws. Dedup'd by the unique (artifact, anon, event) index.
 */
export async function attributeSignup(
  anonymousId: string,
  organizationId: number | null,
): Promise<{ attributed: boolean; artifactId?: number }> {
  try {
    if (!anonymousId) return { attributed: false };
    const touches = await db
      .select({ utmContent: marketingTouch.utmContent, landingPath: marketingTouch.landingPath })
      .from(marketingTouch)
      .where(eq(marketingTouch.anonymousId, anonymousId))
      .limit(200);

    const ids: number[] = [];
    const slugs: string[] = [];
    for (const t of touches) {
      const ref = parseArtifactRef(t.utmContent, t.landingPath);
      if (ref.byId) ids.push(ref.byId);
      if (ref.bySlug) slugs.push(ref.bySlug);
    }
    if (ids.length === 0 && slugs.length === 0) return { attributed: false };

    // Resolve the hint to a REAL artifact row (an unverified hint can't fabricate).
    let artifact: { id: number; playId: string | null } | undefined;
    if (ids.length > 0) {
      [artifact] = await db
        .select({ id: marketingArtifacts.id, playId: marketingArtifacts.playId })
        .from(marketingArtifacts)
        .where(inArray(marketingArtifacts.id, ids))
        .limit(1);
    }
    if (!artifact && slugs.length > 0) {
      [artifact] = await db
        .select({ id: marketingArtifacts.id, playId: marketingArtifacts.playId })
        .from(marketingArtifacts)
        .where(inArray(marketingArtifacts.slug, slugs))
        .limit(1);
    }
    if (!artifact) return { attributed: false };

    await db
      .insert(autopilotConversions)
      .values({ artifactId: artifact.id, playId: artifact.playId, anonId: anonymousId, organizationId, event: "signup" })
      .onConflictDoNothing();
    logger.info("[autopilot/attribution] signup attributed to artifact", { artifactId: artifact.id });
    return { attributed: true, artifactId: artifact.id };
  } catch (err) {
    logger.warn("[autopilot/attribution] attributeSignup failed", err instanceof Error ? err : undefined);
    return { attributed: false };
  }
}

export interface ConversionSummary {
  totalSignups: number;
  byPlay: Array<{ playId: string; signups: number }>;
}

/** Conversions rolled up for the founder dashboard. Never throws. */
export async function getConversionSummary(): Promise<ConversionSummary> {
  try {
    const rows = await db
      .select({ playId: autopilotConversions.playId })
      .from(autopilotConversions)
      .where(eq(autopilotConversions.event, "signup"));
    const byPlayMap = new Map<string, number>();
    for (const r of rows) {
      const key = r.playId ?? "unknown";
      byPlayMap.set(key, (byPlayMap.get(key) ?? 0) + 1);
    }
    return {
      totalSignups: rows.length,
      byPlay: [...byPlayMap.entries()].map(([playId, signups]) => ({ playId, signups })).sort((a, b) => b.signups - a.signups),
    };
  } catch {
    return { totalSignups: 0, byPlay: [] };
  }
}
