/**
 * Syndication channel model (founder decision D7, 2026-07-11).
 *
 * Backs the /syndication customer page (listing-syndication.tsx), which has
 * always called /api/syndication/status, sync-all, and channel toggle/sync
 * endpoints that never existed. This service is the real backend:
 *
 *   - The channel CATALOG comes from listingSyndication.PLATFORMS (names,
 *     env keys, whether an API exists at all).
 *   - The per-org STATE (enabled, last sync, last error) lives in the
 *     syndication_channel_states table (migration 0200).
 *   - Published/pending counts are derived from property_listings'
 *     syndicationTargets jsonb — the same records the legacy
 *     /api/listings/:id/syndicate flow writes.
 *
 * Honesty rules: a channel with missing credentials reports an error state
 * saying exactly which env keys are missing — it never fakes "synced". A
 * manual-only channel (Craigslist) says so. Sync results are recorded
 * per-listing per-channel from the adapter's real success/error, and the
 * channel's lastSyncError carries the first real failure message.
 */

import { OCCUPIED_TARGET_STATUSES } from "./listingWithdrawal";
import { offerabilityRefusal } from "./listability";
import { db } from "../db";
import {
  propertyListings,
  syndicationChannelStates,
  organizations,
  properties,
  type SyndicationChannelState,
  type PropertyListing,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  PLATFORMS,
  buildNormalizedListing,
  listingContentForChannels,
  syndicateListing,
  canonicalPlatform,
  customerAccountConnected,
  type LegacySyndicationPlatform,
  type PlatformConfig,
} from "./listingSyndication";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

// ─── Client contract (mirrors listing-syndication.tsx) ──────────────────────

export interface SyndicationChannelView {
  id: string;
  name: string;
  type: "mls" | "portal" | "social" | "marketplace";
  enabled: boolean;
  lastSyncAt?: string;
  syncStatus: "synced" | "pending" | "error" | "disabled";
  listingsPublished: number;
  pendingCount: number;
  errorMessage?: string;
}

export interface SyndicationSummaryView {
  totalChannels: number;
  activeChannels: number;
  totalListingsPublished: number;
  pendingSync: number;
  channels: SyndicationChannelView[];
}

const CHANNEL_TYPES: Record<LegacySyndicationPlatform, SyndicationChannelView["type"]> = {
  land_com: "portal",
  landflip: "portal",
  landsearch: "portal",
  landwatch: "portal",
  lands_of_america: "portal",
  facebook_marketplace: "marketplace",
  craigslist: "marketplace",
};

export function isKnownChannel(id: string): id is LegacySyndicationPlatform {
  return id in PLATFORMS;
}

/**
 * Whether the channel can post for this org: a channel that needs the
 * customer's own account is postable only once that account is connected
 * (listingSyndication.customerAccountConnected — none can be yet). This
 * replaced a check of AcreOS's own process.env keys (founder decision
 * 2026-10-20 #3).
 */
export async function channelConnected(orgId: number, cfg: PlatformConfig): Promise<boolean> {
  return customerAccountConnected(orgId, cfg.id);
}

interface ChannelCounts {
  published: number;
  pending: number;
}

/**
 * Pure derivation of one channel's honest view from catalog config, stored
 * state, listing counts, and credential presence. Exported for unit tests.
 */
export function deriveChannelView(
  cfg: PlatformConfig,
  state: Pick<SyndicationChannelState, "enabled" | "lastSyncAt" | "lastSyncError"> | undefined,
  counts: ChannelCounts,
  connected: boolean,
): SyndicationChannelView {
  const enabled = state?.enabled ?? false;
  const lastSyncAt = state?.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : undefined;

  let syncStatus: SyndicationChannelView["syncStatus"];
  let errorMessage: string | undefined;

  if (!enabled) {
    syncStatus = "disabled";
  } else if (!cfg.apiAvailable) {
    // Craigslist-class channels: no API exists. Enabled = "generate posts
    // for me", but auto-sync can't run — say so instead of pretending.
    syncStatus = "pending";
    errorMessage = `${cfg.name} has no listing API — posts are generated for manual publishing.`;
  } else if (!connected) {
    syncStatus = "error";
    errorMessage = `Not connected — automatic posting to ${cfg.name} runs on your own ${cfg.name} account, and AcreOS can't connect one yet.`;
  } else if (state?.lastSyncError) {
    syncStatus = "error";
    errorMessage = state.lastSyncError;
  } else if (counts.pending > 0 || !lastSyncAt) {
    syncStatus = "pending";
  } else {
    syncStatus = "synced";
  }

  return {
    id: cfg.id,
    name: cfg.name,
    type: CHANNEL_TYPES[cfg.id],
    enabled,
    lastSyncAt,
    syncStatus,
    listingsPublished: counts.published,
    pendingCount: enabled ? counts.pending : 0,
    errorMessage,
  };
}

/** Count published/pending listings per channel from syndicationTargets. */
export function countTargets(
  listings: Pick<PropertyListing, "syndicationTargets" | "status">[],
): Map<string, ChannelCounts> {
  const counts = new Map<string, ChannelCounts>();
  const activeListings = listings.filter((l) => l.status === "active");

  for (const id of Object.keys(PLATFORMS)) {
    let published = 0;
    for (const listing of listings) {
      const target = (listing.syndicationTargets ?? []).find((t) => t.platform === id);
      if (target?.status === "active") published++;
    }
    // Pending = active listings not yet live on this channel.
    let pending = 0;
    for (const listing of activeListings) {
      const target = (listing.syndicationTargets ?? []).find((t) => t.platform === id);
      if (!target || target.status === "pending" || target.status === "failed") pending++;
    }
    counts.set(id, { published, pending });
  }
  return counts;
}

// ─── DB-backed operations ────────────────────────────────────────────────────

export async function getSyndicationSummary(orgId: number): Promise<SyndicationSummaryView> {
  const [states, listings] = await Promise.all([
    db.select().from(syndicationChannelStates).where(eq(syndicationChannelStates.organizationId, orgId)),
    db.select({
      syndicationTargets: propertyListings.syndicationTargets,
      status: propertyListings.status,
    }).from(propertyListings).where(eq(propertyListings.organizationId, orgId)),
  ]);

  const stateByChannel = new Map(states.map((s) => [s.channelId, s]));
  const counts = countTargets(listings);

  const channels = await Promise.all(Object.values(PLATFORMS).map(async (cfg) =>
    deriveChannelView(
      cfg,
      stateByChannel.get(cfg.id),
      counts.get(cfg.id) ?? { published: 0, pending: 0 },
      await channelConnected(orgId, cfg),
    ),
  ));

  return {
    totalChannels: channels.length,
    activeChannels: channels.filter((c) => c.enabled).length,
    totalListingsPublished: channels.reduce((sum, c) => sum + c.listingsPublished, 0),
    pendingSync: channels.reduce((sum, c) => sum + c.pendingCount, 0),
    channels,
  };
}

export async function setChannelEnabled(
  orgId: number,
  channelId: LegacySyndicationPlatform,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(syndicationChannelStates)
    .values({ organizationId: orgId, channelId, enabled })
    .onConflictDoUpdate({
      target: [syndicationChannelStates.organizationId, syndicationChannelStates.channelId],
      set: { enabled, updatedAt: clock.now() },
    });
}

export interface ChannelSyncOutcome {
  channelId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedReason?: string;
}

/**
 * Push the org's ACTIVE listings to the given channels (or all enabled
 * channels when none specified). Each adapter result is recorded into the
 * listing's syndicationTargets and the channel's state row — real outcomes
 * only, including real failures.
 */
export async function syncChannels(
  orgId: number,
  channelIds?: LegacySyndicationPlatform[],
): Promise<ChannelSyncOutcome[]> {
  const states = await db
    .select()
    .from(syndicationChannelStates)
    .where(eq(syndicationChannelStates.organizationId, orgId));
  const enabledIds = new Set(states.filter((s) => s.enabled).map((s) => s.channelId));

  const targets: LegacySyndicationPlatform[] = (
    channelIds ?? (Object.keys(PLATFORMS) as LegacySyndicationPlatform[])
  ).filter((id) => enabledIds.has(id));

  const outcomes: ChannelSyncOutcome[] = [];
  const syncable: LegacySyndicationPlatform[] = [];

  for (const id of targets) {
    const cfg = PLATFORMS[id];
    if (!cfg.apiAvailable) {
      outcomes.push({ channelId: id, attempted: 0, succeeded: 0, failed: 0, skippedReason: "manual-only channel (no API)" });
      continue;
    }
    if (!(await channelConnected(orgId, cfg))) {
      outcomes.push({ channelId: id, attempted: 0, succeeded: 0, failed: 0, skippedReason: "needs your own account connected, which AcreOS can't do yet" });
      continue;
    }
    syncable.push(id);
  }

  if (syncable.length === 0) return outcomes;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const activeListings = await db
    .select()
    .from(propertyListings)
    .where(and(eq(propertyListings.organizationId, orgId), eq(propertyListings.status, "active")));

  const propertyIds = [...new Set(activeListings.map((l) => l.propertyId))];
  const props = propertyIds.length
    ? await db.select().from(properties).where(and(eq(properties.organizationId, orgId), inArray(properties.id, propertyIds)))
    : [];
  const propById = new Map(props.map((p) => [p.id, p]));

  const perChannel = new Map<string, { succeeded: number; failed: number; firstError?: string }>(
    syncable.map((id) => [id, { succeeded: 0, failed: 0 }]),
  );

  for (const listing of activeListings) {
    const property = propById.get(listing.propertyId);
    if (!property) continue;
    // Only held land is pushed (DEFECT-0174 audit): a listing published while
    // the parcel was owned stays "active" after a sale, and sync-all then
    // offered sold land on every other channel.
    if (offerabilityRefusal(property.status)) continue;

    // Only push to channels where this listing isn't already live — and
    // never back onto a channel it was withdrawn or taken down from (a
    // verified take-down was undone by the next sync).
    const WITHDRAWN = new Set([...OCCUPIED_TARGET_STATUSES, "removed"]);
    // Canonical channels (DEFECT-0182 audit): Lands of America posts as
    // Land.com, so with both enabled sync-all posted Land.com twice and, on
    // every later run, re-posted over the live Land.com target.
    const needed = [...new Set(syncable.map(canonicalPlatform))].filter((id) => {
      const t = (listing.syndicationTargets ?? []).find((x) => canonicalPlatform(x.platform) === id);
      return !t || !WITHDRAWN.has(t.status);
    });
    if (needed.length === 0) continue;

    const normalized = await buildNormalizedListing(property, org, listingContentForChannels(listing));
    const results = await syndicateListing(normalized, needed);

    const nextTargets = [...(listing.syndicationTargets ?? [])];
    for (const r of results) {
      const tally =
        perChannel.get(r.platform) ?? [...perChannel.entries()].find(([id]) => canonicalPlatform(id) === r.platform)?.[1];
      if (tally) {
        if (r.success) tally.succeeded++;
        else {
          tally.failed++;
          if (!tally.firstError && r.error) tally.firstError = r.error;
        }
      }
      const idx = nextTargets.findIndex((t) => canonicalPlatform(t.platform) === r.platform);
      const record = {
        platform: r.platform as string,
        listingId: r.listingId,
        listingUrl: r.listingUrl,
        status: r.success ? "active" : "failed",
        postedAt: r.success ? clock.now().toISOString() : undefined,
        error: r.success ? undefined : r.error,
      };
      if (idx >= 0) nextTargets[idx] = { ...nextTargets[idx], ...record };
      else nextTargets.push(record);
    }

    await db
      .update(propertyListings)
      .set({ syndicationTargets: nextTargets, updatedAt: clock.now() })
      .where(and(eq(propertyListings.id, listing.id), eq(propertyListings.organizationId, orgId)));
  }

  const now = clock.now();
  for (const id of syncable) {
    const tally = perChannel.get(id)!;
    await db
      .insert(syndicationChannelStates)
      .values({ organizationId: orgId, channelId: id, enabled: true, lastSyncAt: now, lastSyncError: tally.firstError ?? null })
      .onConflictDoUpdate({
        target: [syndicationChannelStates.organizationId, syndicationChannelStates.channelId],
        set: { lastSyncAt: now, lastSyncError: tally.firstError ?? null, updatedAt: now },
      });
    outcomes.push({
      channelId: id,
      attempted: tally.succeeded + tally.failed,
      succeeded: tally.succeeded,
      failed: tally.failed,
    });
    logger.info("Syndication channel sync completed", {
      orgId,
      channelId: id,
      succeeded: tally.succeeded,
      failed: tally.failed,
    });
  }

  return outcomes;
}
