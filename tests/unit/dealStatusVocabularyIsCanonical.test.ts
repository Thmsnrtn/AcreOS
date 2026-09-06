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

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import {
  DEAL_STATUSES,
  ACTIVE_DEAL_STATUSES,
  ADMINISTRATIVE_DEAL_STATUSES,
  ALL_FUNNEL_DEAL_STATUSES,
  CLOSED_DEAL_STATUSES,
  LEAD_STATUSES,
  RESOLVED_DEAL_STATUSES,
} from "@shared/lifecycle/pipeline-status";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


/**
 * The projections a query is ALLOWED to spread into `inArray(deals.status, …)`.
 *
 * ADDED 2026-09-06. This gate's own failure message asks the reader to "import
 * ACTIVE_DEAL_STATUSES / DEAL_STATUSES instead of spelling a list" — and then
 * failed on exactly that, because its `inArray(deals.status, [ … ])` regex
 * captured `...CLOSED_DEAL_STATUSES` and compared the spread TEXT against the
 * vocabulary. Six call sites converted to the canonical form were reported as
 * six violations.
 *
 * So the rule is stated properly rather than relaxed: a spread is acceptable
 * only when it names a projection listed here, and each of those is checked
 * BELOW against KNOWN_DEAL_STATUSES at runtime. `[...SOMETHING_ELSE]` is
 * still a violation, and a projection that starts carrying a value a deal
 * cannot hold fails too.
 */
/**
 * Every value a deal's status column can legitimately hold — composed HERE
 * from its parts rather than imported as a bundle.
 *
 * A bundled `KNOWN_DEAL_STATUSES` export existed for exactly one line of
 * this file and nothing in production, which is what the reachability ratchet
 * calls built-but-unwired and the second law calls not-canonical. Its three
 * components each have real production consumers; the union is a property of
 * this test, so it lives in this test.
 */
const KNOWN_DEAL_STATUSES: readonly string[] = [
  ...DEAL_STATUSES,
  ...ADMINISTRATIVE_DEAL_STATUSES,
  ...CLOSED_DEAL_STATUSES, // carries the legacy `closing`
];

const CANONICAL_PROJECTIONS: Record<string, readonly string[]> = {
  DEAL_STATUSES,
  ACTIVE_DEAL_STATUSES,
  ALL_FUNNEL_DEAL_STATUSES,
  ADMINISTRATIVE_DEAL_STATUSES,
  CLOSED_DEAL_STATUSES,
  RESOLVED_DEAL_STATUSES,
};

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

  it("every canonical projection holds only values a deal can really have", () => {
    // The spread allowance below is only as good as this. A projection that
    // gained a value outside the known vocabulary would launder it straight
    // past the rule, which is the failure mode of any allowlist keyed on a
    // NAME rather than on the thing the name refers to.
    const known = new Set<string>(KNOWN_DEAL_STATUSES);
    for (const [name, values] of Object.entries(CANONICAL_PROJECTIONS)) {
      expect(values.length, `${name} is empty — the import resolved to nothing`).toBeGreaterThan(0);
      const rogue = values.filter((v) => !known.has(v));
      expect(rogue, `${name} carries a value no deal can hold`).toEqual([]);
    }
  });

  it("no literal outside the known deal vocabulary is compared against deals.status", () => {
    // Comparisons may name any value a deal CAN hold — funnel, administrative
    // (`deleted`, written by the soft delete) or legacy (`closing`, written by
    // executionEngine until 2026-09-06). Writes are narrower, and that is
    // enforced separately by scripts/check-status-vocabulary.mjs.
    const known = new Set<string>(KNOWN_DEAL_STATUSES);
    const offenders = hits
      .filter((h) => {
        if (h.value.startsWith("...")) {
          // A spread: acceptable only if it names a checked projection.
          return !(h.value.slice(3) in CANONICAL_PROJECTIONS);
        }
        return !known.has(h.value);
      })
      .map((h) => `${h.file}: "${h.value}"`);
    expect(
      [...new Set(offenders)],
      `a deal can never hold these values, so every query using one silently ` +
        `returns nothing. Import a projection from ` +
        `shared/lifecycle/pipeline-status.ts instead of spelling a list — and if ` +
        `you spread one, add it to CANONICAL_PROJECTIONS above so its contents ` +
        `are checked too.`,
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
