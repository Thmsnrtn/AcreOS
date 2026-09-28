/**
 * "Does anything need me?" — ONE answer for every founder surface that asks.
 *
 * The Letter's needs-you count is the union of three separate stores: open
 * Solene asks, pending decisions-inbox items, and frozen sends awaiting a tap.
 * The mobile Decisions badge summed a DIFFERENT pair (asks + the pending-hands
 * list), so it could say 0 while the Letter said 12 — and the Letter took its
 * queue count from the morning pulse, whose loader turned a failed read into
 * 0 (DEFECT-0145). Both now read this: each source live, and a source that
 * could not be read is named rather than counted as empty.
 */
import { eq, sql } from "drizzle-orm";
import { decisionsInboxItems, soleneFounderAsks } from "@shared/schema";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";

export interface NeedsYouCounts {
  asks: number | null;
  decisions: number | null;
  frozenSends: number | null;
  /** Null when any source was unread — a partial sum is not "the" count. */
  total: number | null;
  /** Human names of the sources that could not be read. */
  unreadSources: string[];
}

/** Pending decisions-inbox items, platform-wide (the founder's one queue). Throws on failure. */
export async function countPendingDecisions(): Promise<number> {
  const [row] = await unscopedForPlatformOps(
    "founder-plane: platform-wide pending decisions-inbox count for the needs-you union",
  )
    .select({ n: sql<number>`count(*)::int` })
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.status, "pending"));
  return Number(row?.n ?? 0);
}

async function countOpenAsks(): Promise<number> {
  const [row] = await unscopedForPlatformOps(
    "founder-plane: open Solene asks are the founder's own questions, platform-wide",
  )
    .select({ n: sql<number>`count(*)::int` })
    .from(soleneFounderAsks)
    .where(eq(soleneFounderAsks.status, "open"));
  return Number(row?.n ?? 0);
}

export async function loadNeedsYouCounts(): Promise<NeedsYouCounts> {
  const unreadSources: string[] = [];
  const read = async (name: string, fn: () => Promise<number>): Promise<number | null> => {
    try {
      return await fn();
    } catch {
      unreadSources.push(name);
      return null;
    }
  };
  const [asks, decisions, frozenSends] = await Promise.all([
    read("your open questions", countOpenAsks),
    read("the Decisions queue", countPendingDecisions),
    read("frozen sends", async () => {
      const { pendingHandCounters } = await import("./pendingHands");
      return (await pendingHandCounters()).pendingNow;
    }),
  ]);
  const total = asks === null || decisions === null || frozenSends === null ? null : asks + decisions + frozenSends;
  return { asks, decisions, frozenSends, total, unreadSources };
}
