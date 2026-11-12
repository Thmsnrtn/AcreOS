/**
 * Push revival (autonomy gap slice 7): the creation sites that fan out to the
 * phone, pinned by source because their bodies (a nightly cert scan, the
 * borrower ladder) need a full database to execute.
 *
 * Population is enumerated, not assumed: EVERY server file that calls
 * `pushOrgEvent` is found by walking `server/`, and must be one of the
 * declared creation sites. A new caller (or a caller that stops calling)
 * fails here rather than going unseen. Comments are stripped first, so a
 * comment describing a push cannot satisfy — or trip — any predicate.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** Creation sites that are allowed to fan out, with the org expression each must pass. */
const SITES: Record<string, { orgArg: RegExp; family?: string }> = {
  "server/services/paxNudges.ts": { orgArg: /pushOrgEvent\(\s*orgId\s*,/ },
  "server/jobs/redemptionClockRefresh.ts": {
    orgArg: /pushOrgEvent\(\s*row\.organizationId\s*,/,
    family: "redemption_alert",
  },
  "server/services/financeAgent.ts": {
    orgArg: /pushOrgEvent\(\s*note\.organizationId\s*,/,
    family: "ladder_ready",
  },
  // S-05 (P1-4b): a borrower portal message notifies the note's org.
  "server/services/borrowerMessageNotify.ts": {
    orgArg: /pushOrgEvent\(\s*notice\.orgId\s*,/,
    family: "borrower_message",
  },
};
const DEFINITION = "server/services/orgPushFanout.ts";

describe("push fan-out: population", () => {
  const callers = walk(path.join(ROOT, "server"))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .filter((rel) => /\bpushOrgEvent\s*\(/.test(read(rel)) && rel !== DEFINITION);

  it("exactly the four declared creation sites call pushOrgEvent", () => {
    expect(callers.sort()).toEqual(Object.keys(SITES).sort());
  });

  for (const [rel, spec] of Object.entries(SITES)) {
    it(`${rel}: every call passes the creation's own org, never a literal or another scope`, () => {
      const src = read(rel);
      const calls = src.match(/pushOrgEvent\(/g) ?? [];
      expect(calls.length, `${rel} has no pushOrgEvent call (vacuous)`).toBeGreaterThan(0);
      const scoped = src.match(new RegExp(spec.orgArg.source, "g")) ?? [];
      // Every call (the import/definition does not match `pushOrgEvent(`) is org-scoped.
      expect(scoped.length).toBe(calls.length);
      if (spec.family) expect(src).toContain(`family: "${spec.family}"`);
    });
  }

  it("the helper is org-scoped only: no person-global or founder-plane sender is reachable from it", () => {
    const src = read(DEFINITION);
    expect(src).toContain("sendPushToOrg(");
    expect(src).not.toMatch(/sendPushToPerson|sendPushToUser/);
  });

  it("the helper gates the fan-out on stored preferences (founder decision 2026-11-10: respect mute)", () => {
    const src = read(DEFINITION);
    // The mute gate is wired: the family's preference event id resolves the
    // per-user stored prefs before dispatch.
    expect(src).toContain("ORG_PUSH_FAMILY_EVENT_ID[event.family]");
    expect(src).toContain("getPushEligibility(");
    expect(src).toContain("ORG_PUSH_FAMILY_DEFAULT_ON");
    // Every family has a mapped preference event — a family without one
    // would fan out ungated.
    expect(src).toMatch(/pax_nudge: "pax\.needs_you"/);
    expect(src).toMatch(/redemption_alert: "deal\.closing_reminder"/);
    expect(src).toMatch(/ladder_ready: "finance\.payment_missed"/);
    expect(src).toMatch(/borrower_message: "finance\.borrower_message"/);
  });
});

describe("push fan-out: ordering at each creation point", () => {
  it("redemption: the 7-day push comes AFTER the threshold alert row is inserted", () => {
    const src = read("server/jobs/redemptionClockRefresh.ts");
    const insertAt = src.indexOf(`type: "redemption_clock_threshold"`);
    const pushAt = src.indexOf("pushOrgEvent(");
    expect(insertAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(insertAt);
    // The dedupe `continue` (one alert per cert per day) precedes the push, so a
    // re-run mid-day cannot re-buzz.
    const dedupeAt = src.indexOf("if (existing) continue;");
    expect(dedupeAt).toBeGreaterThan(-1);
    expect(dedupeAt).toBeLessThan(pushAt);
  });

  it("ladder: the push is inside ensureLadderRung, after the row + receipt, before the created return", () => {
    const src = read("server/services/financeAgent.ts");
    const start = src.indexOf("async ensureLadderRung(");
    const createAt = src.indexOf("storage.createPaymentReminder(reminder)", start);
    const effectAt = src.indexOf("borrower_reminder_prepared", start);
    const pushAt = src.indexOf("pushOrgEvent(", start);
    const returnAt = src.indexOf("return { created: true, stage: rung.stage", start);
    expect(start).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(start);
    expect(effectAt).toBeGreaterThan(createAt);
    expect(pushAt).toBeGreaterThan(effectAt);
    expect(returnAt).toBeGreaterThan(pushAt);
    // Counterparty PII stays off the lock screen: the body names the note, not the borrower.
    const body = src.slice(pushAt, returnAt);
    expect(body).not.toMatch(/borrower\??\.(name|firstName|lastName|email|phone)/);
  });

  it("ladder: manual (operator-tapped) reminder creation does not push — the operator is already looking", () => {
    const src = read("server/services/financeAgent.ts");
    const endOfLadderRung = src.indexOf("return { created: true, stage: rung.stage");
    expect(endOfLadderRung).toBeGreaterThan(-1);
    const after = src.slice(endOfLadderRung);
    expect(after).not.toContain("pushOrgEvent(");
  });

  it("nudges: both creation paths push through pushUrgentNudge, which gates on priority 1", () => {
    const src = read("server/services/paxNudges.ts");
    expect(src.match(/pushUrgentNudge\(orgId,/g)?.length).toBe(2);
    expect(src).toMatch(/priority \?\? 99\) > 1\) return/);
  });
});
