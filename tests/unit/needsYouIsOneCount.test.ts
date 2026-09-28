/**
 * DEFECT-0145 — "does anything need me?" has one answer.
 *
 * The Letter counted open asks + the Decisions queue (from the once-a-day
 * morning pulse, whose loader turned a failed read into 0) + frozen sends. The
 * mobile badge summed a different pair and left the Decisions queue out, so it
 * could show nothing while the Letter said a dozen things waited. Both now
 * read loadNeedsYouCounts (server/services/autopilot/needsYou.ts), live.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({
  counts: {} as Record<string, number | Error>,
  pendingNow: 0 as number | Error,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      let table = "";
      const q: Record<string, unknown> = {
        from: (t: unknown) => { table = getTableName(t as never); return q; },
        where: async () => {
          const v = h.counts[table];
          if (v instanceof Error) throw v;
          return [{ n: v ?? 0 }];
        },
      };
      return q;
    },
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/autopilot/pendingHands", () => ({
  pendingHandCounters: async () => {
    if (h.pendingNow instanceof Error) throw h.pendingNow;
    return { pendingNow: h.pendingNow };
  },
}));

import { loadNeedsYouCounts } from "../../server/services/autopilot/needsYou";

beforeEach(() => {
  h.counts = { solene_founder_asks: 3, decisions_inbox_items: 7 };
  h.pendingNow = 2;
});

describe("DEFECT-0145 — the needs-you union", () => {
  it("counts all three stores, the Decisions queue included", async () => {
    const r = await loadNeedsYouCounts();
    expect(r).toMatchObject({ asks: 3, decisions: 7, frozenSends: 2, total: 12, unreadSources: [] });
  });

  it("a failed read is named and makes the total unknown, never zero", async () => {
    h.counts.decisions_inbox_items = new Error("db down");
    const r = await loadNeedsYouCounts();
    expect(r.decisions).toBeNull();
    expect(r.total).toBeNull();
    expect(r.unreadSources).toEqual(["the Decisions queue"]);
  });

  it("frozen sends failing is also unknown, not a smaller total", async () => {
    h.pendingNow = new Error("nope");
    const r = await loadNeedsYouCounts();
    expect(r.total).toBeNull();
    expect(r.unreadSources).toEqual(["frozen sends"]);
  });
});

describe("DEFECT-0145 — the Letter reads the same live queue count", () => {
  it("composeFounderBrief takes the queue from countPendingDecisions, not the pulse snapshot", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/autopilot/narrate.ts"), "utf8"));
    const body = src.slice(src.indexOf("export async function composeFounderBrief"));
    expect(body).toMatch(/safePulse\.decisionsWaitingCount = await countPendingDecisions\(\)/);
    expect(body).toMatch(/catch \{\s*unreadSources\.push\("the Decisions queue"\)/);
  });
});
