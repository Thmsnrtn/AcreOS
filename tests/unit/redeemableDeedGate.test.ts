/**
 * V-Tax-1 T4b — the redeemable-deed gate covers its WHOLE population.
 *
 * Founder decision 2026-10-29: feasibility / plat / due-diligence / rehab
 * spend and the marketing paths are refused on a parcel a tax position still
 * holds, through ONE chokepoint (server/services/tax/landExit.ts). A gate is
 * only as good as the population it reads, so this test does not trust a
 * hand-kept list alone:
 *
 *   1. SPEND: every route unit in server/routes*.ts that WRITES one of the
 *      spend tables/services below must call the gate, or be named in
 *      EXEMPT with its reason. A new spend route that skips the gate fails.
 *   2. MARKETING: every place that checks `offerabilityRefusal(` (the one
 *      "may this property be offered?" rule) must also check the tax hold
 *      within the same few lines. A new marketing path that copies the
 *      offerability check without the tax gate fails.
 *   3. Vacuity: each spend marker is found at least once, each gated unit is
 *      found by its registration, and the unit splitter reads a real number
 *      of route units — a parser that silently stops matching reads exactly
 *      like a clean population.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(path.join(ROOT, p), "utf8"));

/** Writes that are feasibility / plat / DD / rehab spend or marketing. */
const SPEND_WRITES: Array<[string, RegExp]> = [
  ["subdivision plan", /\.(insert|update)\(subdivisionPlans\)/],
  ["permit checklist", /\.insert\(permitChecklists\)/],
  ["permit gate", /\.update\(permitGates\)/],
  ["lot split", /\.insert\(properties\)\.values\(inserts\)/],
  ["rehab", /\.insert\(rehabs\)/],
  ["rehab line items", /\.insert\(rehabLineItems\)/],
  ["DD assignment", /\bcreateDDAssignment\(/],
  ["DD dossier", /\b(requestDossier|runDossierPod)\(/],
  ["property listing", /\bcreatePropertyListing\(/],
  ["ad posting", /\bcreateAdPosting\(/],
];

/** Units that write a spend table but are not spend on a parcel — each with why. */
const EXEMPT: Record<string, string> = {};

const GATE = /\b(refuseRedeemableDeedSpend|taxHoldRefusal)\(/;
const REGISTRATION = /\b(app|api|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

function units(file: string): Array<{ key: string; body: string }> {
  const src = read(file);
  const starts = [...src.matchAll(REGISTRATION)].map((m) => ({ at: m.index!, key: `${m[2].toUpperCase()} ${m[3]}` }));
  return starts.map((s, i) => ({ key: s.key, body: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length) }));
}

const routeFiles = readdirSync(path.join(ROOT, "server")).filter((f) => /^routes.*\.ts$/.test(f)).map((f) => `server/${f}`);

describe("every spend route calls the redeemable-deed gate", () => {
  const all = routeFiles.flatMap((f) => units(f).map((u) => ({ ...u, file: f })));

  it("reads a real population of route units (vacuity)", () => {
    expect(routeFiles.length).toBeGreaterThan(100);
    expect(all.length).toBeGreaterThan(1500);
  });

  for (const [label, marker] of SPEND_WRITES) {
    it(`${label}: every unit that writes it is gated or exempt with a reason`, () => {
      const writers = all.filter((u) => marker.test(u.body));
      expect(writers.length, `no route unit writes ${label} — the marker went stale`).toBeGreaterThan(0);
      const ungated = writers.filter((u) => !GATE.test(u.body) && !EXEMPT[`${u.file} ${u.key}`]).map((u) => `${u.file} ${u.key}`);
      expect(ungated, `these routes spend on or market a parcel without the T4b gate — call refuseRedeemableDeedSpend before the write, or add an EXEMPT entry saying why`).toEqual([]);
    });
  }

  it("every EXEMPT entry still names a real route unit (no stale exemptions)", () => {
    const keys = new Set(all.map((u) => `${u.file} ${u.key}`));
    expect(Object.keys(EXEMPT).filter((k) => !keys.has(k))).toEqual([]);
  });
});

describe("every offerability check also checks the tax hold", () => {
  const files = [...routeFiles, ...readdirSync(path.join(ROOT, "server/services")).filter((f) => f.endsWith(".ts")).map((f) => `server/services/${f}`)];
  // listability.ts defines the rule; listingWithdrawal.ts uses it the other way round (take DOWN what is no longer offerable).
  const NOT_AN_OFFER = new Set(["server/services/listability.ts", "server/services/listingWithdrawal.ts"]);
  const sites = files.filter((f) => !NOT_AN_OFFER.has(f)).flatMap((f) => {
    const lines = read(f).split("\n");
    return lines.flatMap((l, i) => (/\bofferabilityRefusal\(/.test(l) && !/import /.test(l) ? [{ f, i, window: lines.slice(Math.max(0, i - 6), i + 6).join("\n") }] : []));
  });

  it("finds the offerability call sites (vacuity)", () => expect(sites.length).toBeGreaterThanOrEqual(7));

  it("each is paired with the tax hold", () => {
    const unpaired = sites.filter((s) => !/\b(refuseRedeemableDeedSpend|taxHoldRefusal)\(|\bheldPropertyIds\(|\btaxHeld\b|\bheld\.has\(/.test(s.window)).map((s) => `${s.f}:${s.i + 1}`);
    expect(unpaired, "an offer path checks offerability but not the tax hold (V-Tax-1 T4b)").toEqual([]);
  });

  it("the marketplace listing, which has no offerability check of its own, checks the tax hold", () => {
    expect(read("server/services/marketplace.ts")).toMatch(/taxHoldRefusal\(organizationId, propertyId/);
  });
});
