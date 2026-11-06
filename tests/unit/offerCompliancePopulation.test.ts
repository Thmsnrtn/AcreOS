/**
 * The POPULATION of the assignment compliance gate (wholesale package, Leg 3).
 *
 * offerCompliance.realdb.test.ts proves the gate works on each path it names.
 * This proves the set of paths is the whole set — the third law in CLAUDE.md:
 * a gate proves its property only over the population it actually reads.
 *
 * Two populations, each enumerated from source rather than listed by hand:
 *
 *   OFFER paths — every server unit that calls `offerabilityRefusal(` (the
 *   canonical "may this property be offered?" check), plus every caller of a
 *   named marketing generator (`generatePropertyFlyer`). Each must call the
 *   compliance gate (`offerComplianceGate(` or, for an unattended path,
 *   `unattendedOfferRefusal(`) AFTER the offerability check, unless it is an
 *   exemption written below WITH its reason.
 *
 *   ASSIGNMENT DOCUMENT gates — every function that calls
 *   `checkAssignmentCompliance(` outside the rules module and the offer gate
 *   must RECORD an acknowledged warn (`recordComplianceAck(`).
 *
 * Adding a new offer path without the gate, or a new document gate that does
 * not record, fails here. A unit the splitter cannot attribute is COUNTED, not
 * skipped, and the floors below fail if the scan silently reads less.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function walk(rel: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(child));
    else if (/\.ts$/.test(e.name) && !e.name.includes(".test.")) out.push(child);
  }
  return out;
}

/**
 * Split a file into units: each route registration (`app|api|router.<verb>(`)
 * and each top-level function. The unit is named by its first string literal
 * (the route path) or the function name.
 */
function units(src: string): Array<{ name: string; body: string }> {
  const starts: Array<{ at: number; name: string }> = [];
  const re = /\b(?:app|api|router)\.(?:get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]|^export\s+(?:async\s+)?function\s+(\w+)|^(?:async\s+)?function\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ at: m.index, name: m[1] ?? m[2] ?? m[3] });
  return starts.map((s, i) => ({ name: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
}

const files = walk("server").map((f) => ({ file: f, src: stripComments(fs.readFileSync(path.join(ROOT, f), "utf8")) }));

const OFFER_CHECK = /\b(offerabilityRefusal|generatePropertyFlyer)\(/;
const GATE = /\b(offerComplianceGate|unattendedOfferRefusal)\(/;

/**
 * Offer-check callers that are NOT outward offers of a property under
 * contract. Each needs its reason; adding one is a reviewed decision.
 */
const OFFER_EXEMPT: Record<string, string> = {
  "server/services/listability.ts#offerabilityRefusal": "the definition itself",
  "server/services/listingWithdrawal.ts#*": "taking a listing DOWN — withdrawing an offer is never restricted",
  "server/services/documents.ts#generatePropertyFlyer": "the definition itself; its route caller is gated",
};
const exempt = (file: string, unit: string) => OFFER_EXEMPT[`${file}#${unit}`] ?? OFFER_EXEMPT[`${file}#*`];

describe("every outward offer of a property passes the assignment compliance gate", () => {
  const count = (t: string) => (t.match(new RegExp(OFFER_CHECK.source, "g")) ?? []).length;
  const offerUnits = files.flatMap(({ file, src }) => {
    if (!OFFER_CHECK.test(src)) return [];
    const found = units(src).filter((u) => OFFER_CHECK.test(u.body)).map((u) => ({ file, ...u }));
    // A call the splitter could not place (a class method, a nested helper)
    // is COUNTED as an unattributed unit, never skipped: it then needs the gate
    // or a whole-file exemption like any other.
    const placed = found.reduce((n, u) => n + count(u.body), 0);
    if (placed < count(src)) found.push({ file, name: "*unattributed*", body: src });
    return found;
  });

  it("vacuity: the scan found the offer paths it should (floor), in each file it should", () => {
    expect(offerUnits.length, offerUnits.map((u) => `${u.file}#${u.name}`).join("\n")).toBeGreaterThanOrEqual(9);
    const filesSeen = new Set(offerUnits.map((u) => u.file));
    for (const f of [
      "server/routes-buyer-blasts.ts",
      "server/routes-elite-features.ts",
      "server/routes-team-messaging.ts",
      "server/services/syndicationChannels.ts",
      "server/routes-documents.ts",
      "server/services/listingWithdrawal.ts",
      "server/services/buyerMatchingAI.ts",
    ]) {
      expect(filesSeen, f).toContain(f);
    }
  });

  it("each non-exempt offer unit calls the gate — and before it generates marketing material", () => {
    const ungated = offerUnits
      .filter((u) => !exempt(u.file, u.name))
      .filter((u) => {
        const g = u.body.search(GATE);
        if (g < 0) return true;
        // A generator IS the outward act, so the gate must come first.
        const gen = u.body.search(/\bgeneratePropertyFlyer\(/);
        return gen >= 0 && gen < g;
      })
      .map((u) => `${u.file}#${u.name}`);
    expect(ungated, "an offer path reaches buyers without the assignment compliance gate").toEqual([]);
  });

  it("the gated set is exactly the known offer surfaces (a new one must be added here on purpose)", () => {
    const gated = offerUnits.filter((u) => !exempt(u.file, u.name)).map((u) => `${u.file}#${u.name}`).sort();
    expect(gated).toEqual([
      "server/routes-buyer-blasts.ts#/api/properties/:id/blast-buyers",
      "server/routes-documents.ts#/api/documents/generate/property-flyer",
      "server/routes-elite-features.ts#/api/listings/:id/syndicate",
      "server/routes-team-messaging.ts#/api/listings",
      "server/routes-team-messaging.ts#/api/listings/:id/publish",
      "server/services/buyerMatchingAI.ts#*unattributed*",
      "server/services/syndicationChannels.ts#syncChannels",
    ]);
  });

  it("every exemption still names a real unit (an exemption cannot outlive its code)", () => {
    for (const key of Object.keys(OFFER_EXEMPT)) {
      const [file, unit] = key.split("#");
      const f = files.find((x) => x.file === file);
      expect(f, key).toBeDefined();
      if (unit !== "*") expect(units(f!.src).some((u) => u.name === unit), key).toBe(true);
    }
  });

  it("canary: the splitter attributes a gate-less offer unit and the check would catch it", () => {
    const src = `app.post("/x", async () => { offerabilityRefusal(s); send(); });\napp.post("/y", async () => { offerabilityRefusal(s); await offerComplianceGate({}); });`;
    const u = units(src);
    expect(u.map((x) => x.name)).toEqual(["/x", "/y"]);
    expect(GATE.test(u[0].body)).toBe(false);
    expect(GATE.test(u[1].body)).toBe(true);
  });
});

describe("every buyer-match announcement is gated", () => {
  it("each emitBuyerMatchCreated( call in server/ sits directly inside an unattendedOfferRefusal guard", () => {
    const calls = files.flatMap(({ file, src }) =>
      (src.match(/\bemitBuyerMatchCreated\(/g) ?? []).length > 0 && !file.endsWith("buyerEvents.ts") ? [{ file, src }] : [],
    );
    expect(calls.map((c) => c.file)).toEqual(["server/services/buyerMatchingAI.ts"]);
    const src = calls[0].src;
    const total = (src.match(/\bemitBuyerMatchCreated\(/g) ?? []).length;
    const guarded = (src.match(/unattendedOfferRefusal\([^)]*\)\)\)\s*\{\s*emitBuyerMatchCreated\(/g) ?? []).length;
    expect(total, "vacuity: the matcher announces from two branches").toBe(2);
    expect(guarded).toBe(total);
  });
});

describe("every assignment-document gate RECORDS an acknowledged warn", () => {
  const gateFns = files
    .filter(({ file }) => file !== "server/routes-wholesaler-rules.ts" && file !== "server/services/wholesale/offerCompliance.ts")
    .flatMap(({ file, src }) => units(src).filter((u) => /\bcheckAssignmentCompliance\(/.test(u.body)).map((u) => ({ file, ...u })));

  it("vacuity: both known document gates are found", () => {
    expect(gateFns.map((g) => `${g.file}#${g.name}`).sort()).toEqual([
      "server/routes-contract-chain.ts#assignmentComplianceRefusal",
      "server/routes-doc-system.ts#assignmentComplianceGate",
    ]);
  });

  it("each records the acknowledgement", () => {
    const silent = gateFns.filter((g) => !/\brecordComplianceAck\(/.test(g.body)).map((g) => `${g.file}#${g.name}`);
    expect(silent).toEqual([]);
  });
});
