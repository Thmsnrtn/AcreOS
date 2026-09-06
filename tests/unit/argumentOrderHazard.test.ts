/**
 * Two functions with the same name must not take the same parameters in
 * opposite orders.
 *
 * ── WHY THIS GATE EXISTS ────────────────────────────────────────────────────
 * This session found TWO live bugs of one shape, neither visible to tsc:
 *
 *   `suggestOfferRange(leadId, propertyId)` against a
 *   `(propertyId, signals)` signature — `req.body` is `any`, so the lead id
 *   became the property id and the property id became the signals object. The
 *   endpoint derived an offer range from whatever property happened to share
 *   an id with the lead.
 *
 *   `resolveAlert(alertId, resolution)` against a
 *   `(organizationId, alertId)` signature — the alert id became the
 *   organization id and the resolution TEXT became the alert id, so the query
 *   was `WHERE id = parseInt("<free text>")`, i.e. NaN. The compliance alert
 *   was never resolved, and the audit log recorded that it was.
 *
 * A third instance is recorded in the code itself, at
 * `routes-seller-intent.ts`: "It used to take a predictionId, and this line
 * passed a leadId to it under a comment that said so — the outcome of lead #42
 * landed on prediction #42."
 *
 * The enabling condition is always the same: two adjacent parameters whose
 * types accept each other. The compiler cannot object. So the defence is to
 * stop the AMBIGUITY existing, not to be careful at each call site.
 *
 * ── WHAT THIS SCANS ─────────────────────────────────────────────────────────
 * Function/method declarations across `server/`, grouped by name. A pair is a
 * hazard when two declarations share two or more parameter NAMES and order
 * them differently — because then a caller who reaches for the wrong import
 * gets a silent swap.
 *
 * Fixed by aligning to the house convention (organization first), which is what
 * `storage.getLead`, `complianceAI`, `leadQualification`, `writingStyle`,
 * `marketWatchlist` and `predictIntent` already do:
 *   - `leadEnrichment.enrichLead` (leadId, organizationId) → org first. Its twin
 *     `propertyEnrichment.enrichLead` was already org-first, and BOTH are
 *     mounted — the sharpest pair in the codebase.
 *   - `taxDelinquentPipeline.getLead` (id, orgId) → org first, matching
 *     `storage.getLead`.
 *   - `sellerIntentPredictor.recordOutcome` (leadId, organizationId, …) → org
 *     first, matching `negotiationOrchestrator.recordOutcome`.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = join(__dirname, "../..");
const SERVER = join(ROOT, "server");

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") tsFiles(p, out); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

interface Decl { file: string; line: number; params: string[] }

function declarations(): Map<string, Decl[]> {
  const byName = new Map<string, Decl[]>();
  const re = /(?:export\s+)?(?:public\s+|private\s+)?(?:async\s+)?(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]{0,300})\)\s*:\s*Promise/g;
  for (const f of tsFiles(SERVER)) {
    const src = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const [, name, raw] = m;
      if (/^(if|for|while|switch|catch|return|then|constructor)$/.test(name)) continue;
      const params = raw
        .split(",")
        .map((p) => p.trim().match(/^([A-Za-z_$][\w$]*)\s*[?:=]/)?.[1] ?? null);
      if (params.length < 2 || params.some((p) => !p)) continue;
      const named = params as string[];
      // A leading `this` is an artifact of matching class methods; it shifts
      // every position by one and would manufacture a hazard at every pair.
      if (named[0] === "this") named.shift();
      if (named.length < 2) continue;
      const line = src.slice(0, m.index).split("\n").length;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push({ file: relative(ROOT, f), line, params: named });
    }
  }
  return byName;
}

function hazards(): string[] {
  const out: string[] = [];
  for (const [name, defs] of declarations()) {
    if (defs.length < 2) continue;
    const uniq = [...new Map(defs.map((d) => [d.params.join(","), d])).values()];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i], b = uniq[j];
        const shared = a.params.filter((p) => b.params.includes(p));
        if (shared.length < 2) continue;
        if (shared.some((p) => a.params.indexOf(p) !== b.params.indexOf(p))) {
          out.push(`${name}: ${a.file}:${a.line} (${a.params.join(", ")})  vs  ${b.file}:${b.line} (${b.params.join(", ")})`);
        }
      }
    }
  }
  return out.sort();
}

/**
 * The two shapes that LOOK like the hazard and are not. Both are annotated
 * rather than pattern-excluded, so a third of either kind is a decision
 * somebody makes on purpose.
 */
const BENIGN: Array<{ match: RegExp; why: string }> = [
  {
    match: /^updateEntry:/,
    why:
      "LAYERING, not an inversion. `marketWatchlist` declares the STORAGE " +
      "interface `updateEntry(entryId, updates)` and the SERVICE method " +
      "`updateEntry(orgId, entryId, updates)` which checks ownership and then " +
      "delegates to storage. The service wrapping storage and adding the org is " +
      "the correct pattern; its own comment says 'Org-scoped — a foreign entry " +
      "reads as missing'.",
  },
  {
    match: /^updateConfig:/,
    why:
      "ARITY, not an inversion. `acquisitionRadar.updateConfig(organizationId, " +
      "configId, updates)` and `whiteLabelService.updateConfig(organizationId, " +
      "updates)` are BOTH organization-first; the shared name `updates` sits at " +
      "a different index only because one takes an extra id. No two parameters " +
      "can be swapped between them.",
  },
];

describe("no two same-named functions invert their shared parameters", () => {
  it("THE SCAN IS NOT VACUOUS — it indexes real declarations", () => {
    // Guard first. A regex that stopped matching would report zero hazards and
    // read as a clean bill of health.
    const decls = declarations();
    expect(decls.size, "the declaration scan found nothing").toBeGreaterThan(800);
    const multi = [...decls.values()].filter((v) => v.length > 1).length;
    expect(multi, "no repeated function names found — the grouping broke").toBeGreaterThan(50);
  });

  it("the hazard detector fires on a known inverted pair", () => {
    // Prove the comparison works, using a synthetic pair rather than trusting
    // that a real one exists — the whole point of this gate is that real ones
    // should reach zero.
    const a = ["organizationId", "leadId"];
    const b = ["leadId", "organizationId"];
    const shared = a.filter((p) => b.includes(p));
    expect(shared.length).toBeGreaterThanOrEqual(2);
    expect(shared.some((p) => a.indexOf(p) !== b.indexOf(p))).toBe(true);
  });

  it("every benign exemption still matches something", () => {
    // A stale exemption silently covers a real hazard that later takes its name.
    const found = hazards();
    for (const b of BENIGN) {
      expect(
        found.some((h) => b.match.test(h)),
        `the exemption ${b.match} matches nothing any more — delete it`,
      ).toBe(true);
    }
  });

  it("NO unexplained inverted pair exists", () => {
    const unexplained = hazards().filter((h) => !BENIGN.some((b) => b.match.test(h)));
    expect(
      unexplained,
      "two functions share a name and order their shared parameters differently. " +
        "A caller who reaches for the wrong import gets a silent swap that the " +
        "compiler cannot see — this session shipped two live bugs of exactly " +
        "that shape. Align to organization-first, or add an annotated BENIGN " +
        "entry explaining why the pair cannot be confused.",
    ).toEqual([]);
  });
});
