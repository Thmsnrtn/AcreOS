/**
 * Today Decision Queue inline-resolver (Maren CPO #2).
 *
 * The /today queue is DERIVED — items are recomputed each request, so resolving
 * one "in place" can't flip a row; it writes to a resolution ledger and the GET
 * payload subtracts it. These tests lock in the three pure halves of that loop:
 *
 *   1. deriveInlineAction   — every item is inline-resolvable; follow-up-shaped
 *      ids additionally carry a Pax-draft target parsed from the lead id, and we
 *      NEVER fabricate a target for an id that doesn't carry a real entity id.
 *   2. resolveActionToState — action → persisted (status, snoozedUntil); snooze
 *      hides for 3 days, done/dismiss are permanent.
 *   3. isQueueItemHidden    — the GET subtract: done/dismissed always hide;
 *      snoozed hides only while the window is still in the future (re-surfaces
 *      after), and an unknown/absent state never hides.
 */

import { describe, it, expect } from "vitest";
import {
  deriveInlineAction,
  resolveActionToState,
  isQueueItemHidden,
} from "../../server/routes-today";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("deriveInlineAction — inline-resolvable + honest Pax-draft targets", () => {
  it("attaches a lead Pax-draft target for stale-lead items", () => {
    const action = deriveInlineAction({ id: "stale-lead-42" });
    expect(action).toEqual({ kind: "resolve", paxDraft: { entityType: "lead", entityId: 42 } });
  });

  it("attaches a target for ai-follow-up and suggest-stale ids too", () => {
    expect(deriveInlineAction({ id: "ai-follow-up-7" })).toEqual({
      kind: "resolve",
      paxDraft: { entityType: "lead", entityId: 7 },
    });
    expect(deriveInlineAction({ id: "suggest-stale-103" })).toEqual({
      kind: "resolve",
      paxDraft: { entityType: "lead", entityId: 103 },
    });
  });

  it("is still resolvable WITHOUT a Pax-draft target for non-follow-up items", () => {
    // Observation suggestions, alerts, priorities, tasks — no lead id to extract.
    expect(deriveInlineAction({ id: "suggest-obs-9" })).toEqual({ kind: "resolve" });
    expect(deriveInlineAction({ id: "alert-12" })).toEqual({ kind: "resolve" });
    expect(deriveInlineAction({ id: "priority-follow-up" })).toEqual({ kind: "resolve" });
    expect(deriveInlineAction({ id: "task-5" })).toEqual({ kind: "resolve" });
  });

  it("never fabricates a target when the trailing segment isn't a positive id", () => {
    expect(deriveInlineAction({ id: "stale-lead-" })).toEqual({ kind: "resolve" });
    expect(deriveInlineAction({ id: "stale-lead-abc" })).toEqual({ kind: "resolve" });
  });
});

describe("resolveActionToState — action → persisted state", () => {
  const now = new Date("2026-06-08T12:00:00.000Z");

  it("done is permanent (no snooze window)", () => {
    expect(resolveActionToState("done", now)).toEqual({ status: "done", snoozedUntil: null });
  });

  it("dismiss is permanent (no snooze window)", () => {
    expect(resolveActionToState("dismiss", now)).toEqual({ status: "dismissed", snoozedUntil: null });
  });

  it("snooze hides for exactly 3 days", () => {
    const state = resolveActionToState("snooze", now);
    expect(state.status).toBe("snoozed");
    expect(state.snoozedUntil).not.toBeNull();
    expect(state.snoozedUntil!.getTime() - now.getTime()).toBe(3 * DAY_MS);
  });
});

describe("isQueueItemHidden — the GET subtract", () => {
  const now = new Date("2026-06-08T12:00:00.000Z");

  it("hides done and dismissed items permanently", () => {
    expect(isQueueItemHidden({ status: "done", snoozedUntil: null }, now)).toBe(true);
    expect(isQueueItemHidden({ status: "dismissed", snoozedUntil: null }, now)).toBe(true);
  });

  it("hides a snoozed item only while its window is in the future", () => {
    const future = new Date(now.getTime() + 2 * DAY_MS);
    const past = new Date(now.getTime() - 1 * DAY_MS);
    expect(isQueueItemHidden({ status: "snoozed", snoozedUntil: future }, now)).toBe(true);
    expect(isQueueItemHidden({ status: "snoozed", snoozedUntil: past }, now)).toBe(false);
  });

  it("accepts an ISO-string snoozedUntil (as it arrives from the DB driver)", () => {
    const future = new Date(now.getTime() + DAY_MS).toISOString();
    expect(isQueueItemHidden({ status: "snoozed", snoozedUntil: future }, now)).toBe(true);
  });

  it("never hides an item with no resolution state", () => {
    expect(isQueueItemHidden(undefined, now)).toBe(false);
  });

  it("treats a snoozed row with no window as not hidden (defensive)", () => {
    expect(isQueueItemHidden({ status: "snoozed", snoozedUntil: null }, now)).toBe(false);
  });
});
