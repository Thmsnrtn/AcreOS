/**
 * A status compared against `deals.status` must be a status a deal can have.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `getExecutiveMetrics` counted the pipeline with
 * `or(status='negotiation', 'pending', 'due_diligence', 'under_contract')`,
 * and `getPipelineValue` repeated the identical four. NOT ONE of those is a
 * member of DEAL_STATUSES — and `'negotiation'` is a one-character typo for
 * the schema default `'negotiating'`. routes.ts validates every status write
 * against DEAL_STATUSES, so three of the four could never legitimately be
 * stored at all.
 *
 * Net effect: the "Deals in Pipeline" KPI card and the pipeline-value chart
 * read 0 for every organization, forever. `getDealMetrics` had the mirror
 * defect — it counted lost deals as `status IN ('dead','cancelled')`, and
 * `'dead'` is a LEAD status, so the win-rate denominator was short too
 * (2026-09-04 review, CONFIRMED).
 *
 * The canonical list existed the whole time. It had no adoption in the surface
 * that needed it — the second law's shape exactly.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * Every string literal compared against `deals.status` anywhere in server/ is
 * a member of DEAL_STATUSES. The population is the whole server tree rather
 * than a list of files, because the defect was in a file nobody would have
 * thought to enumerate, and the count is asserted so a parser that stops
 * matching cannot read as "no violations".
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEAL_STATUSES, ACTIVE_DEAL_STATUSES, LEAD_STATUSES } from "@shared/lifecycle/pipeline-status";

const ROOT = path.resolve(__dirname, "../..");

function serverFiles(rel = "server", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) serverFiles(child, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(child);
  }
  return out;
}

/** Strip comments so prose about a retired literal never reads as a comparison. */
function code(rel: string): string {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/**
 * Every `deals.status` compared against a string literal, in any of the
 * spellings this codebase uses.
 */
const COMPARISONS = [
  /eq\(\s*deals\.status\s*,\s*['"]([^'"]+)['"]\s*\)/g,
  /ne\(\s*deals\.status\s*,\s*['"]([^'"]+)['"]\s*\)/g,
  /deals\.status\s*===?\s*['"]([^'"]+)['"]/g,
  /inArray\(\s*deals\.status\s*,\s*\[([^\]]*)\]\s*\)/g,
];

interface Hit {
  file: string;
  value: string;
}

function statusComparisons(): Hit[] {
  const hits: Hit[] = [];
  for (const file of serverFiles()) {
    const src = code(file);
    if (!src.includes("deals.status")) continue;
    for (const rx of COMPARISONS) {
      for (const m of src.matchAll(rx)) {
        for (const raw of m[1].split(",")) {
          const value = raw.trim().replace(/^['"]|['"]$/g, "");
          if (value) hits.push({ file, value });
        }
      }
    }
  }
  return hits;
}

describe("every deal-status literal in server/ is a real deal status", () => {
  const hits = statusComparisons();

  it("reads a real population (vacuity guard)", () => {
    // Both halves can silently empty: the file walk, and the regexes. If either
    // stops matching, "no violations" and "read nothing" look identical.
    expect(serverFiles().length).toBeGreaterThan(300);
    expect(
      hits.length,
      "no deal-status comparison was found anywhere — the patterns above have " +
        "stopped matching the code, and this gate is measuring nothing",
    ).toBeGreaterThanOrEqual(5);
  });

  it("no literal outside DEAL_STATUSES is compared against deals.status", () => {
    const canonical = new Set<string>(DEAL_STATUSES);
    const offenders = hits
      .filter((h) => !canonical.has(h.value))
      .map((h) => `${h.file}: "${h.value}"`);
    expect(
      [...new Set(offenders)],
      `a deal can never hold these values (routes.ts validates writes against ` +
        `DEAL_STATUSES), so every query using one silently returns nothing. ` +
        `Import ACTIVE_DEAL_STATUSES / DEAL_STATUSES from ` +
        `shared/lifecycle/pipeline-status.ts instead of spelling a list.`,
    ).toEqual([]);
  });

  it("the two vocabularies really are distinct, which is what makes the rule bite", () => {
    // 'dead' was counted as a lost DEAL. If the two lists ever overlapped, the
    // rule above would stop catching that class entirely.
    const deal = new Set<string>(DEAL_STATUSES);
    const leakage = (LEAD_STATUSES as readonly string[]).filter((s) => deal.has(s));
    // Measured, not assumed: 'accepted', 'closed' and 'negotiating' are
    // spelled the same in both vocabularies and mean different things in each.
    // Everything else is disjoint, which is why a lead status compared against
    // deals.status matches nothing at all rather than matching the wrong rows —
    // and why 'dead', the LEAD terminal, silently counted zero lost deals.
    expect(leakage.sort(), "the two vocabularies have drifted — revisit this gate").toEqual([
      "accepted",
      "closed",
      "negotiating",
    ]);
    expect(deal.has("dead"), "'dead' is the LEAD terminal; a deal is 'cancelled'").toBe(false);
  });
});

describe("the canonical active-pipeline projection is derived and adopted", () => {
  it("ACTIVE_DEAL_STATUSES is DEAL_STATUSES minus the terminals, not a second list", () => {
    expect([...ACTIVE_DEAL_STATUSES].sort()).toEqual(
      DEAL_STATUSES.filter((s) => s !== "closed" && s !== "cancelled").slice().sort(),
    );
    expect(ACTIVE_DEAL_STATUSES.length).toBeGreaterThan(0);
  });

  it("nobody re-declares it", () => {
    // routes-founder-bridge.ts had its own copy. It happened to be correct;
    // a second copy of a canonical vocabulary is how the analytics one drifted
    // into four statuses that do not exist.
    const redeclarers = serverFiles().filter((f) =>
      /(const|let)\s+ACTIVE_DEAL_STATUSES\s*=/.test(code(f)),
    );
    expect(redeclarers).toEqual([]);
  });

  it("the surfaces that count a pipeline consume it", () => {
    for (const file of ["server/storage/analyticsRepo.ts", "server/routes-founder-bridge.ts"]) {
      expect(code(file), `${file} must import the canonical list`).toContain(
        "ACTIVE_DEAL_STATUSES",
      );
      expect(code(file)).toContain('from "@shared/lifecycle/pipeline-status"');
    }
  });
});
