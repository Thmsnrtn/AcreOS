/**
 * A Pax tool may not report an effect it did not have.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `schedule_background_job` advertised an enum of four job types —
 * `bulk_property_import`, `bulk_lead_import`, `campaign_send`,
 * `report_generation` — and its entire implementation was:
 *
 *     logger.info(`[AI Tools] Background job scheduled: …`);
 *     return { success: true, data: { …, status: "queued" } };
 *
 * A user who asked Pax to run the overnight campaign send was told it was
 * queued. Nothing was queued; none of those four job types exists anywhere in
 * `server/jobs` or the outbox. Deleted 2026-08-19 rather than wired, because
 * wiring it means BUILDING four job types and the defect is that it claimed to
 * already have them.
 *
 * ── WHY A SCAN AND NOT A CASE PER TOOL ──────────────────────────────────────
 * A test naming `schedule_background_job` proves that one symbol is gone and
 * says nothing about the next handler someone writes the same way. This governs
 * the SHAPE: a switch case that returns `success: true` while calling nothing
 * that can have an effect. The survey that found the original had exactly one
 * offender out of 61 cases, so the register below is small and the rule is
 * cheap — which is the moment to install it, not after the second one.
 *
 * The register is PURE COMPUTATION only. Adding a name to it is a claim that
 * the tool's whole job is arithmetic on its arguments, and that claim is
 * checkable by reading forty lines.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");
const TOOLS = path.join(ROOT, "server/ai/tools.ts");

/**
 * Handlers that legitimately return `success: true` having touched nothing:
 * they compute from their arguments and return the number. Each is arithmetic
 * with no I/O by nature, not a stub waiting to be wired.
 */
const PURE_COMPUTATION: Record<string, string> = {
  calculate_amortization:
    "Amortisation schedule from principal/rate/term. No source of truth to read.",
  calculate_roi:
    "ROI from the figures the caller passes. Reading a deal would be a different tool.",
  calculate_payment_schedule:
    "Payment schedule from the loan terms in the args, same shape as amortisation.",
};

/**
 * Anything that reaches outside this function.
 *
 * `await` is the load-bearing half and the reason this rule is cheap: every
 * handler that reads or writes anything in this codebase awaits something —
 * storage, the db, a service, a dynamic import, a fetch. A case that returns
 * `success: true` having awaited nothing has, by construction, done nothing
 * beyond arithmetic on its own arguments. The explicit patterns cover the
 * synchronous shapes as well, so a future non-async effect is still seen.
 *
 * Measured 2026-08-19 across 60 cases: this predicate leaves exactly the three
 * calculators in PURE_COMPUTATION, and nothing else.
 */
const EFFECTFUL = /\bawait\b|storage\.|\bdb\.|\bfetch\(/;

/** `case "name": { … }` bodies from the executeTool switch. */
function switchCases(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\n {6}case "([a-z_0-9]+)": \{\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    out.push({ name: m[1], body: src.slice(m.index + m[0].length, i) });
  }
  return out;
}

function claimsSuccessWithoutEffect(src: string): string[] {
  return switchCases(src)
    .filter((c) => /success:\s*true/.test(c.body))
    .filter((c) => !EFFECTFUL.test(c.body))
    .map((c) => c.name)
    .filter((n) => !(n in PURE_COMPUTATION));
}

const source = () => stripCommentsPreservingLines(fs.readFileSync(TOOLS, "utf8"));

describe("no tool reports success without doing anything", () => {
  it("vacuity: the switch is found and has the cases it should", () => {
    // Every assertion here is an absence check over `switchCases`. If the regex
    // stops matching — a reformat, a refactor of the dispatch — the offender
    // list is empty and this file certifies a file it never parsed.
    const cases = switchCases(source());
    expect(cases.length, `only ${cases.length} tool cases parsed out of the switch`).toBeGreaterThan(
      50,
    );
    const names = new Set(cases.map((c) => c.name));
    for (const known of ["get_leads", "create_lead", "send_email", "calculate_roi"]) {
      expect(names.has(known), `the switch parser lost "${known}"`).toBe(true);
    }
    // And the register must describe tools that exist.
    for (const pure of Object.keys(PURE_COMPUTATION)) {
      expect(names.has(pure), `PURE_COMPUTATION names "${pure}", which is not a tool`).toBe(true);
    }
  });

  it("finds no handler claiming an effect it did not have", () => {
    expect(
      claimsSuccessWithoutEffect(source()),
      "this handler returns success: true without calling anything that can have " +
        "an effect. Either make it do the thing, or make it refuse — a tool that " +
        'reports `status: "queued"` and queues nothing is worse than one that ' +
        "does not exist. If it is genuinely pure arithmetic, add it to " +
        "PURE_COMPUTATION with the reason.",
    ).toEqual([]);
  });

  it("FIRES on the exact handler that was deleted", () => {
    // The original, restored into a copy of the source. Not a synthetic shape —
    // this is the code that shipped.
    const mutated = source().replace(
      '      case "extract_properties_from_text": {',
      '      case "schedule_background_job": {\n' +
        "        logger.info(`[AI Tools] Background job scheduled: ${args.job_type}`);\n" +
        "        return { success: true, data: { jobType: args.job_type, status: \"queued\" } };\n" +
        "      }\n\n" +
        '      case "extract_properties_from_text": {',
    );
    expect(mutated, "the mutation did not apply — re-anchor it").not.toBe(source());
    expect(claimsSuccessWithoutEffect(mutated)).toContain("schedule_background_job");
  });

  it("does NOT fire on a handler that writes through storage", () => {
    // The negative control, on the same mutation site. A rule that flagged real
    // handlers would be turned off within a week.
    const mutated = source().replace(
      '      case "extract_properties_from_text": {',
      '      case "__probe_real_write__": {\n' +
        "        await storage.createLead({ organizationId: org.id });\n" +
        "        return { success: true, data: { created: true } };\n" +
        "      }\n\n" +
        '      case "extract_properties_from_text": {',
    );
    expect(mutated).not.toBe(source());
    expect(claimsSuccessWithoutEffect(mutated)).toEqual([]);
  });
});

describe("the deleted tool is gone from every register that named it", () => {
  it("is not a tool, not an intent, and not in the dispatch", () => {
    // Deleting a tool definition and leaving its intent-registry entry behind
    // is this repository's most common residue; the entry would keep declaring
    // a door and a scope for something that cannot be called.
    const files = [
      "server/ai/tools.ts",
      "server/services/appIntents/intentScopes.ts",
    ];
    for (const rel of files) {
      const src = stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      expect(src, `${rel} still references schedule_background_job`).not.toContain(
        "schedule_background_job",
      );
    }
  });
});
