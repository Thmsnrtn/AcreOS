/**
 * DEFECT-0163 — "could not look" is not "nothing is waiting".
 *
 * `listPendingHands` caught its own query failure and returned []. Every
 * founder reader then turned that into a verdict: the Controls door printed
 * "0 awaiting your tap", the board report printed "Nothing right now. The
 * company is running itself.", and the step-away check called the queue
 * clear. The read now throws; readers take the needs-you union, whose unread
 * sources are named rather than counted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const { state } = vi.hoisted(() => ({ state: { fail: false, rows: [] as unknown[] } }));

vi.mock("../../server/db", () => {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (f: any, r: any) =>
      (state.fail ? Promise.reject(new Error("connection terminated")) : Promise.resolve(state.rows)).then(f, r),
  };
  return { db: { select: () => chain } };
});

import { listPendingHands, pendingHandCounters } from "../../server/services/autopilot/pendingHands";
import { composeBoardReport } from "../../server/services/autopilot/boardReport";
import { attentionLoad } from "../../server/services/autopilot/boardReserve";

beforeEach(() => {
  state.fail = false;
  state.rows = [];
});

describe("listPendingHands — a failed read is a failure", () => {
  it("rejects when the query fails (was: resolved [])", async () => {
    state.fail = true;
    await expect(listPendingHands()).rejects.toThrow("connection terminated");
  });

  it("an empty queue is still an empty list", async () => {
    await expect(listPendingHands()).resolves.toEqual([]);
  });

  // The Controls count comes from pendingHandCounters; the list and the
  // approval treat a pending row with no expiry as expired, so must the count.
  it("a pending row with no expiry is not counted as waiting", async () => {
    const now = Date.now();
    state.rows = [
      { status: "pending", approvedBy: null, expiresAt: null, createdAt: new Date(now) },
      { status: "pending", approvedBy: null, expiresAt: new Date(now + 60_000), createdAt: new Date(now) },
    ];
    const c = await pendingHandCounters();
    expect(c.pendingNow).toBe(1);
    expect(c.expiredUnseen).toBe(1);
  });
});

describe("board report — 'What needs you' reads the needs-you union", () => {
  const unread = {
    total: null,
    asks: 0,
    decisions: 0,
    frozenSends: null,
    unreadSources: ["frozen sends"],
  };

  it("an unread source is 'couldn't check', never 'nothing right now'", () => {
    const r = composeBoardReport({ topMove: null, pendingCount: 0, needsYou: unread, attention: attentionLoad(0, 0) });
    expect(r).not.toContain("Nothing right now");
    expect(r).toContain("Couldn't check frozen sends");
  });

  it("queued decisions are reported even when nothing is frozen", () => {
    const r = composeBoardReport({
      topMove: null,
      pendingCount: 0,
      needsYou: { total: 4, asks: 0, decisions: 4, frozenSends: 0, unreadSources: [] },
      attention: attentionLoad(0, 0),
    });
    expect(r).not.toContain("Nothing right now");
    expect(r).toContain("4 decision(s) queued");
  });

  it("a genuinely empty union is still the zero-state", () => {
    const r = composeBoardReport({
      topMove: null,
      pendingCount: 0,
      needsYou: { total: 0, asks: 0, decisions: 0, frozenSends: 0, unreadSources: [] },
      attention: attentionLoad(0, 0),
    });
    expect(r).toContain("Nothing right now");
  });
});

describe("Controls door — /api/founder/autopilot/live counts from the one loader", () => {
  const src = stripComments(fs.readFileSync(path.join(process.cwd(), "server/routes-autopilot.ts"), "utf8"));
  const start = src.indexOf('"/api/founder/autopilot/live"');
  const end = src.indexOf("app.", start + 1);
  const handler = src.slice(start, end);

  it("the handler was located (vacuity floor)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(handler.length).toBeGreaterThan(200);
  });

  it("reads loadNeedsYouCounts, not the swallowing list or the stale pulse", () => {
    expect(handler).toContain("loadNeedsYouCounts");
    expect(handler).not.toContain("listPendingHands");
    expect(handler).not.toMatch(/pulse\?\.\s*(decisionsWaitingCount|asksOpenCount)/);
  });

  // Audit follow-up: the card the door actually RENDERS ("N waiting on you" /
  // "Nothing waiting") read /control's asks-only count, 0 on a failed read.
  it("/control's waiting-on-you card reads the same union", () => {
    const at = src.indexOf('"/api/founder/autopilot/control"');
    const body = src.slice(at, src.indexOf("app.", at + 1));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain("loadNeedsYouCounts");
    expect(body).not.toContain("listOpenAsks");
  });

  it("the client renders an unread count as unread, not as a number", () => {
    const client = stripComments(
      fs.readFileSync(path.join(process.cwd(), "client/src/pages/founder/autopilot-control.tsx"), "utf8"),
    );
    expect(client).toMatch(/pendingCount:\s*number\s*\|\s*null/);
    expect(client).toContain("pendingCount === null");
    expect(client).toContain("needsYou.total === null");
    expect(client).not.toMatch(/data\.openAsks/);
  });
});
