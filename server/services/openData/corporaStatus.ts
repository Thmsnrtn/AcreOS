/**
 * Tier-2 corpora status — never overstates (founder ruling 2026-07-28 #10).
 *
 * getCorporaStatus() is the ONE honest answer to "what open-data corpora do
 * we own?": it reads the manifest (shared/openData/corporaManifest.ts), the
 * OPEN_DATA_BUCKET_* env keys and the upload RECEIPTS, and reports per corpus:
 *
 *  - "not_provisioned"                     — no object storage configured
 *    (reason is the verbatim STORAGE_NOT_PROVISIONED sentinel);
 *  - "storage_configured_pipeline_pending" — the four bucket keys are set but
 *    no upload receipt exists for this corpus, so nothing has been ingested;
 *  - "ingested"                            — the bucket is configured AND at
 *    least one receipt shows bytes the bucket itself confirmed (HEAD after
 *    PUT, byte count + SHA-256). W2 shipped the first ingestion code (the
 *    Tennessee parcel-fact pipeline); a receipt is the only path to this state.
 *
 * This file also carries the one-shot founder decision card asking the
 * founder to provision the storage — the seed rides the established
 * seedFounderDecisionCards.ts boot hook with the same marker/fail-open
 * discipline as evaluationHorizonCards.ts.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { platformSettings } from "@shared/schema";
import {
  OPEN_DATA_BUCKET_ENV_KEYS,
  STORAGE_NOT_PROVISIONED,
  TIER2_CORPORA,
  type CorpusIngestStatus,
} from "@shared/openData/corporaManifest";
import { decisionsInboxService } from "../decisionsInbox";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

export interface CorpusStatusReport {
  key: string;
  ingestStatus: CorpusIngestStatus;
  reason: string;
}

/**
 * Honest reason when the bucket keys ARE set: storage exists, but the
 * pipeline does not — so still nothing is ingested.
 */
export const PIPELINE_PENDING_REASON =
  "object storage configured — no upload receipt for this corpus yet, nothing has been ingested" as const;

/** One confirmed upload (an entry of county_discovery_queue.owned_artifacts). */
export interface CorpusUploadReceipt {
  corpusKey: string;
  objectKey: string;
  bytes: number;
  sha256: string;
}

/** A receipt counts only if it names real bytes with a real digest. */
export function isValidReceipt(r: CorpusUploadReceipt): boolean {
  return r.bytes > 0 && /^[0-9a-f]{64}$/.test(r.sha256) && r.objectKey.length > 0;
}

/** All four OPEN_DATA_BUCKET_* keys must be non-empty for storage to count. */
export function isBucketConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return OPEN_DATA_BUCKET_ENV_KEYS.every((k) => (env[k] ?? "").trim().length > 0);
}

/**
 * Per-corpus status, never overstated. Pure function of manifest + env +
 * receipts — no I/O, nothing to drift. A receipt without configured storage
 * does not count (the bucket it names is not one this deploy can reach).
 */
export function getCorporaStatus(
  env: Record<string, string | undefined> = process.env,
  receipts: readonly CorpusUploadReceipt[] = [],
): CorpusStatusReport[] {
  const configured = isBucketConfigured(env);
  return TIER2_CORPORA.map((corpus) => {
    if (!configured) {
      return { key: corpus.key, ingestStatus: "not_provisioned" as const, reason: STORAGE_NOT_PROVISIONED };
    }
    const mine = receipts.filter((r) => r.corpusKey === corpus.key && isValidReceipt(r));
    if (mine.length > 0) {
      const bytes = mine.reduce((n, r) => n + r.bytes, 0);
      return {
        key: corpus.key,
        ingestStatus: "ingested" as const,
        reason: `${mine.length} object(s), ${bytes} bytes confirmed by the bucket`,
      };
    }
    return { key: corpus.key, ingestStatus: "storage_configured_pipeline_pending" as const, reason: PIPELINE_PENDING_REASON };
  });
}

// ── One-shot founder decision card: provision the storage ────────────────

const MARKER_KEY = "open_data_corpora_2026_07.decision_card_seeded";

const CARD = {
  subject: "Own the open-data corpora — provision object storage (~$10–30/mo)",
  analysis:
    "You approved owning the Tier-2 public-domain corpora (aerial imagery, 1 m terrain, " +
    "lidar, statewide parcels, land cover, PLSS sections, boundaries, addresses, public " +
    "lands, water, building footprints — ruling #10, woven into Wave 3). Owning them buys " +
    "three things: change detection over time (decades of land-cover and imagery history " +
    "no live endpoint serves), faster lookups (our own copy beats a federal server round " +
    "trip), and independence from federal endpoint uptime (no-SLA government services stop " +
    "being a single point of failure). The cost is roughly $10–30 a month of object storage " +
    "at full corpus scale — any S3-compatible store works; the program research recommends " +
    "Cloudflare R2 because egress there is far cheaper than S3. Nothing ingests until you " +
    "act: the storage account and its keys are money and a vendor, so they stay in your " +
    "hands — you create the bucket and set the four OPEN_DATA_BUCKET_* keys yourself. " +
    "Today every corpus honestly reports not_provisioned, and even after you set the keys " +
    "the ingestion pipeline is a follow-up build you'll see in a PR before anything runs.",
  recommendedAction: "open_data_corpora_provision_now_r2",
  recommendedActionLabel: "Decide: provision object storage for the corpora",
  options: [
    {
      key: "provision_now_r2",
      label: "Provision now on Cloudflare R2 (recommended — cheapest egress)",
    },
    { key: "provision_now_s3", label: "Provision now on AWS S3" },
    { key: "hold", label: "Hold — keep the scaffold dormant for now" },
  ],
} as const;

/**
 * Seed the corpora-provisioning card exactly once. Same contract as
 * seedEvaluationHorizonCards: marker-guarded (an answered card is never
 * re-asked), marker written only after the insert succeeds (mid-seed failure
 * retries next boot), never throws (boot-safe). actionPayload is null via
 * createDirectDecisionCard — answering records a ruling; the founder
 * provisions the bucket and keys manually (money/vendor = founder's hands).
 */
export async function seedOpenDataCorporaDecisionCard(): Promise<
  "seeded" | "already_seeded" | "failed"
> {
  try {
    const existing = await db
      .select({ id: platformSettings.id })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.scope, "global"),
          isNull(platformSettings.scopeRef),
          eq(platformSettings.key, MARKER_KEY),
        ),
      )
      .limit(1);
    if (existing.length > 0) return "already_seeded";

    await decisionsInboxService.createDirectDecisionCard({
      itemType: "feature_request_flagged",
      riskLevel: "medium",
      urgencyScore: 35,
      sophieAnalysis: CARD.analysis,
      recommendedAction: CARD.recommendedAction,
      recommendedActionLabel: CARD.recommendedActionLabel,
      subject: CARD.subject,
      options: [...CARD.options],
    });

    await db.insert(platformSettings).values({
      key: MARKER_KEY,
      scope: "global",
      scopeRef: null,
      value: { seededAt: clock.now().toISOString(), cards: 1 },
      defaultValue: {},
      category: "cost",
      description:
        "One-shot marker: 2026-07 open-data corpora founder decision card seeded (provision object storage for Tier-2 bulk corpora, ruling #10).",
      lastChangedBy: "open-data-corpora-seed",
      lastChangedAt: clock.now(),
    });
    logger.info(
      "[corporaStatus] seeded 1 founder decision card (2026-07 open-data corpora provisioning)",
    );
    return "seeded";
  } catch (err) {
    logger.error(
      "[corporaStatus] decision-card seed failed — will retry next boot (marker not written)",
      err instanceof Error ? err : undefined,
    );
    return "failed";
  }
}
