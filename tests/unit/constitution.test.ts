/**
 * Constitution ratchet — the meta-gate over the governance registry.
 *
 * The ">$500 founder-only" hard stop drifted out of enforcement for months
 * because doctrine lived in prose while the code said otherwise, and nothing
 * cross-checked the two. This ratchet closes that class of failure:
 *
 *   1. Every enforcement pointer must resolve to a file that actually exists
 *      (a stale pointer = doctrine claiming an enforcement that's gone).
 *   2. The number of UNENFORCED HARD STOPS may only shrink, never grow —
 *      a hard stop with no automated backstop is governance debt, and this
 *      baseline drives it to zero the same way FOUNDER_ROUTE_BASELINE and the
 *      deletion floor drive their debts down.
 *   3. (2026-08-16) Every enforcement.kind must be TRUE, not merely declared.
 *      See the "enforcement CLAIMS are backed" block below.
 *
 * When you wire real enforcement for a prose-only hard stop, reclassify it in
 * shared/governance/constitution.ts and LOWER the baseline below.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CONSTITUTION,
  hardStops,
  unenforcedHardStops,
  invariantById,
} from "@shared/governance/constitution";

const ROOT = path.resolve(__dirname, "../..");

// ── Shared predicates for the claim-verification block ────────────────────
// Ported from tests/unit/statuteRegister.test.ts (which governs the parallel
// compliance registry and already had these checks) — same shape, same
// reasoning, applied to the constitution's four enforcement kinds.

const isTestFile = (p: string) => /\.test\.tsx?$/.test(p);
/** Real code — not a test, and not a .md/.json pointed at to satisfy a check. */
const isSourceFile = (p: string) => /\.(ts|tsx|js|mjs)$/.test(p) && !isTestFile(p);
const isLintScript = (p: string) => /^scripts\/[\w.-]+\.mjs$/.test(p);
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const moduleName = (p: string) => path.basename(p).replace(/\.(tsx?|mjs|js)$/, "");

/** Kinds whose claim is "a vitest gate fails the build on drift". */
const TEST_BACKED_KINDS = new Set(["ratchet-test", "unit-test"]);

/**
 * Words that carry no subject meaning — they appear in nearly every id and
 * would make the linkage check below match anything.
 */
const GENERIC_ID_TOKENS = new Set([
  "hard", "stop", "no", "not", "never", "only", "pre", "the", "and", "or",
  "over", "four", "five", "six", "per", "new", "all", "any",
]);

/**
 * The entry's SUBJECT, derived from its own id — no hand-maintained keyword
 * map to drift out of date, and an appended entry cannot skip supplying one.
 * "hard-stop.customer-data-deletion" → ["customer", "data", "deletion"].
 */
function subjectTerms(id: string): string[] {
  return id
    .split(/[.\-_]/)
    .filter((t) => t.length >= 3 && !GENERIC_ID_TOKENS.has(t) && !/^\d+$/.test(t));
}

/** Case-insensitive substring, so camelCase/SNAKE_CASE/kebab all match, plus a naive singular. */
function mentions(content: string, term: string): boolean {
  const hay = content.toLowerCase();
  const t = term.toLowerCase();
  if (hay.includes(t)) return true;
  const stem = t.endsWith("s") ? t.slice(0, -1) : t;
  return stem.length >= 3 && hay.includes(stem);
}

/** Every scripts/*.mjs reachable from `npm run check` — the real lint chain. */
function scriptsWiredIntoCheck(): Set<string> {
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const chain = pkg.scripts?.check ?? "";
  const wired = new Set<string>();
  for (const step of chain.matchAll(/npm run ([\w:-]+)/g)) {
    const body = pkg.scripts?.[step[1]] ?? "";
    for (const s of body.matchAll(/(scripts\/[\w.-]+\.mjs)/g)) wired.add(s[1]);
  }
  return wired;
}

/**
 * Current count of hard stops with no automated backstop. May only DECREASE.
 *
 * 2026-07-27 (initial): 3 — pricing changes, legal signing, customer-data
 *   deletion. (spends >$500 was the one already machine-enforced.)
 * 2026-07-27 (→1): auditing the actual code found checkHardGuardrails()
 *   ALREADY blocks pricing/billing modifications and customer-data deletion
 *   before the AI is consulted — the registry had been too pessimistic. That
 *   enforcement is now pinned by tests/unit/founderHardStopGuardrails.test.ts,
 *   so both were reclassified prose-only → code-invariant.
 * 2026-07-27 (→0): legal signing wired into checkHardGuardrails() —
 *   LEGAL_SIGNING_ACTIONS action class + sign/execute_contract payload flags,
 *   ratcheted by tests/unit/founderHardStopGuardrails.test.ts. All four hard
 *   stops are now machine-enforced; this baseline stays at 0 forever.
 * 2026-07-29 (stays 0): a FIFTH hard stop was registered —
 *   hard-stop.no-platform-money-custody, from the founder ruling "be the rail,
 *   not the provider". It arrived already machine-enforced (the
 *   customerMoneyRouting chokepoint + tests/unit/moneyCustodyHardStop.test.ts),
 *   so it added no debt. The registry had ZERO money-custody entries before
 *   this, which is exactly why four dead platform-custody surfaces survived
 *   several honesty waves — the ban on re-fronting platform SEND rails had no
 *   payments analogue.
 */
const UNENFORCED_HARD_STOP_BASELINE = 0;

describe("constitution registry — shape", () => {
  it("every invariant has the required non-empty fields", () => {
    for (const inv of CONSTITUTION) {
      expect(inv.id, "id").toBeTruthy();
      expect(inv.title, `${inv.id} title`).toBeTruthy();
      expect(inv.statement, `${inv.id} statement`).toBeTruthy();
      expect(inv.source, `${inv.id} source`).toBeTruthy();
      expect(inv.enforcement.refs.length, `${inv.id} refs`).toBeGreaterThan(0);
    }
  });

  it("ids are unique and kebab-namespaced", () => {
    const ids = CONSTITUTION.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  });

  it("invariantById round-trips", () => {
    expect(invariantById("hard-stop.spend-over-500")?.category).toBe("hard-stop");
    expect(invariantById("nope")).toBeUndefined();
  });
});

describe("constitution registry — enforcement pointers are real", () => {
  it("every enforcement ref resolves to a file that exists", () => {
    const missing: string[] = [];
    for (const inv of CONSTITUTION) {
      for (const ref of inv.enforcement.refs) {
        if (!fs.existsSync(path.join(ROOT, ref))) missing.push(`${inv.id} → ${ref}`);
      }
    }
    expect(missing, `stale enforcement pointers:\n${missing.join("\n")}`).toEqual([]);
  });
});

/**
 * The enforcement.kind was SELF-LABELLED and nothing verified it.
 *
 * The block above proves a pointer RESOLVES. It never proved the pointer
 * ENFORCES, so `kind` was a string an author typed. An enforcement audit
 * confirmed two bypasses against the green suite:
 *
 *   (A) append an entry with kind "code-invariant" and refs
 *       ["server/services/smsService.ts"] — a real file, zero machinery — and
 *       the suite stays green. A decision recorded as machine-enforced with
 *       nothing enforcing it.
 *   (B) delete the customer-data-deletion block from checkHardGuardrails() and
 *       repoint its refs at "CLAUDE.md" — the pointer resolves, the unenforced
 *       hard-stop counter stays 0, green. The hard stop is gone and the
 *       registry still reports it machine-enforced.
 *
 * This is the same failure the STATUTE register hit ("false assurance ships
 * green", audit note F-15-2), and it was already solved there. These checks are
 * a port of tests/unit/statuteRegister.test.ts (~L120-190), not a new idea:
 * a kind claim must name a ref of the RIGHT TYPE, that ref must actually
 * REFERENCE the thing it claims to govern, and a test ref must contain real
 * assertions that are not skipped.
 *
 * MEASURED BEFORE ADOPTION (2026-08-16), the rule this repo learned from
 * narrowing a 237-hit proposal to 10: every predicate below was run over all
 * 14 entries first. Total failures: ONE — rails.byo-not-refront claimed
 * "code-invariant" ("code + covered by a test") while naming only
 * emailService.ts. Its own note called the missing test GOVERNANCE DEBT; the
 * note was stale, emailPurposeEnforcement.test.ts had been enforcing it for
 * weeks. Fixed by pointing the entry at the test that was already running —
 * no kind was downgraded, so no debt counter moved. Every other predicate is
 * 14/14 clean: zero false positives, nothing to re-baseline.
 *
 * WHAT THIS CANNOT SEE, stated plainly per refuse-not-fabricate: token
 * linkage proves the registry names the right FILE, not that the file's logic
 * still works. Gutting checkHardGuardrails while leaving refs untouched is
 * caught by founderHardStopGuardrails.test.ts, not here. This gate's job is to
 * stop the REGISTRY from lying about where the enforcement lives.
 */
describe("constitution registry — enforcement CLAIMS are backed, not just pointed", () => {
  // ── Anti-vacuity guards ────────────────────────────────────────────────
  // This repo has been bitten repeatedly by scans that returned empty and read
  // as good news. If a filter below silently stops matching, these fail first.
  it("the scan sees entries in every kind it checks", () => {
    expect(CONSTITUTION.length).toBeGreaterThanOrEqual(14);
    const byKind = (k: string) => CONSTITUTION.filter((i) => i.enforcement.kind === k).length;
    expect(byKind("code-invariant"), "no code-invariant entries — checks vacuous").toBeGreaterThan(0);
    expect(
      CONSTITUTION.filter((i) => TEST_BACKED_KINDS.has(i.enforcement.kind)).length,
      "no test-backed entries — checks vacuous",
    ).toBeGreaterThan(0);
    expect(byKind("lint"), "no lint entries — the wiring check is vacuous").toBeGreaterThan(0);
  });

  it("every entry yields at least one subject term (else linkage is unmeasurable)", () => {
    const termless = CONSTITUTION.filter((i) => subjectTerms(i.id).length === 0).map((i) => i.id);
    expect(
      termless,
      `ids with no distinctive token — the linkage check below cannot judge ` +
        `them, so rename the id rather than let it pass unverified: ${termless.join(", ")}`,
    ).toEqual([]);
  });

  it("the package.json check chain parses (else the lint-wiring check is vacuous)", () => {
    const wired = scriptsWiredIntoCheck();
    expect(
      wired.size,
      `parsed ${wired.size} scripts out of 'npm run check' — the parse broke, ` +
        `so every 'lint' claim would pass unverified`,
    ).toBeGreaterThan(10);
    expect([...wired].every((s) => exists(s))).toBe(true);
  });

  // ── The kind must name a ref of the right TYPE ─────────────────────────
  it("every test-backed kind names an existing *.test.ts", () => {
    const bad: string[] = [];
    for (const inv of CONSTITUTION) {
      if (!TEST_BACKED_KINDS.has(inv.enforcement.kind)) continue;
      if (!inv.enforcement.refs.some((r) => isTestFile(r) && exists(r)))
        bad.push(`${inv.id} [${inv.enforcement.kind}] → ${inv.enforcement.refs.join(", ")}`);
    }
    expect(
      bad,
      `entries claiming a test-backed kind with no existing *.test.ts ref — ` +
        `"a vitest gate fails the build on drift" is then just a word in a ` +
        `data structure:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("every 'lint' entry names a scripts/*.mjs that is wired into `npm run check`", () => {
    const wired = scriptsWiredIntoCheck();
    const bad: string[] = [];
    for (const inv of CONSTITUTION) {
      if (inv.enforcement.kind !== "lint") continue;
      const scripts = inv.enforcement.refs.filter((r) => isLintScript(r) && exists(r));
      if (scripts.length === 0) bad.push(`${inv.id} → no existing scripts/*.mjs ref`);
      else if (!scripts.some((s) => wired.has(s)))
        bad.push(`${inv.id} → ${scripts.join(", ")} exist but none runs in \`npm run check\``);
    }
    expect(
      bad,
      `'lint' claims with no gate in the check chain. A checker nobody runs is ` +
        `prose with a .mjs extension:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("every 'code-invariant' entry names real code AND a covering test", () => {
    // Not an invented bar — constitution.ts defines the kind as "enforced
    // structurally in code + covered by a test". Bypass (B) repointed a
    // code-invariant hard stop at CLAUDE.md; prose is not code.
    const bad: string[] = [];
    for (const inv of CONSTITUTION) {
      if (inv.enforcement.kind !== "code-invariant") continue;
      const refs = inv.enforcement.refs.filter(exists);
      if (!refs.some(isSourceFile)) bad.push(`${inv.id} → no non-test source file among its refs`);
      if (!refs.some(isTestFile)) bad.push(`${inv.id} → no test ref; the code is uncovered`);
    }
    expect(
      bad,
      `'code-invariant' claims that are not both code and covered:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  // ── The ref must be ABOUT the decision (statuteRegister F-15-2's reasoning) ──
  it("the refs backing a claim actually mention the entry's subject", () => {
    const bad: string[] = [];
    for (const inv of CONSTITUTION) {
      const terms = subjectTerms(inv.id);
      const refs = inv.enforcement.refs.filter(exists);
      for (const [label, bucket] of [
        ["source", refs.filter(isSourceFile)],
        ["test", refs.filter(isTestFile)],
      ] as const) {
        if (bucket.length === 0) continue; // the type checks above own emptiness
        if (!bucket.some((r) => terms.some((t) => mentions(read(r), t))))
          bad.push(
            `${inv.id}: no ${label} ref mentions any of [${terms.join(", ")}] — ` +
              `${bucket.join(", ")}`,
          );
      }
    }
    expect(
      bad,
      `enforcement refs unrelated to the decision they claim to enforce. This ` +
        `is bypass (A): any real file satisfies "the pointer resolves", so the ` +
        `pointer must also be ABOUT the subject:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("a test ref names the code it claims to govern", () => {
    // F-15-2 in one line: a test that never mentions the module it supposedly
    // pins is not enforcement, it is a filename in a list.
    const bad: string[] = [];
    for (const inv of CONSTITUTION) {
      const refs = inv.enforcement.refs.filter(exists);
      const src = refs.filter(isSourceFile);
      const tests = refs.filter(isTestFile);
      if (src.length === 0 || tests.length === 0) continue;
      const linked = tests.some((t) => {
        const body = read(t);
        return src.some((s) => body.includes(s) || body.includes(moduleName(s)));
      });
      if (!linked) bad.push(`${inv.id}: no test ref references any of ${src.map(moduleName).join(", ")}`);
    }
    expect(
      bad,
      `test refs that never touch the code they are registered as covering:\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  // ── The test must be a real test (direct port of F-15-2) ───────────────
  it("every test ref actually asserts something (not a hollow file)", () => {
    const hollow: string[] = [];
    for (const inv of CONSTITUTION) {
      for (const ref of inv.enforcement.refs.filter((r) => isTestFile(r) && exists(r))) {
        if (!/\bexpect\s*\(/.test(read(ref))) hollow.push(`${inv.id} → ${ref}`);
      }
    }
    expect(
      hollow,
      `enforcement test refs with NO expect() — the registry claims the ` +
        `decision is tested but the file asserts nothing:\n${hollow.join("\n")}`,
    ).toEqual([]);
  });

  it("no test ref is entirely skipped (a skipped enforcement test is a false green)", () => {
    const skipped: string[] = [];
    for (const inv of CONSTITUTION) {
      for (const ref of inv.enforcement.refs.filter((r) => isTestFile(r) && exists(r))) {
        const src = read(ref);
        const live = (src.match(/\b(?:it|test)\s*\(/g) || []).length;
        const off = (src.match(/\b(?:it|test|describe)\s*\.\s*(?:skip|todo)\s*\(/g) || []).length;
        const topSkipped = /\bdescribe\s*\.\s*(?:skip|todo)\s*\(/.test(src);
        // Flagged only when the file has cases but ZERO can run — never a
        // false positive on a large file carrying one unrelated skip.
        if ((topSkipped || (off > 0 && live === 0)) && live + off > 0)
          skipped.push(`${inv.id} → ${ref}`);
      }
    }
    expect(
      skipped,
      `enforcement test refs that are entirely skipped — the assertion never ` +
        `runs, so the decision is unenforced behind a green pointer:\n${skipped.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * The hole the §55 reconciliation walked through on 2026-08-17.
 *
 * Everything else in this file verifies the entries that EXIST — their pointers
 * resolve, their refs are not skipped, their unenforced count is 0. None of it
 * can notice a standing decision that NEVER GOT INTO the registry at all, and
 * one hadn't: CLAUDE.md's DO-NOT-DO list states "No new persona verticals, and
 * no new top-level nav entries EVER" as one bullet with two halves. The nav half
 * was mirrored three times. The persona half was mirrored zero times, for as
 * long as the registry has existed.
 *
 * A green gate over an incomplete population is this repo's most repeated
 * defect, and the registry was one. CLAUDE.md calls the registry "the checkable
 * form of what's written here" — so what is written there has to be counted.
 */
describe("every standing decision in CLAUDE.md reached the registry", () => {
  const claudeMd = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");

  /** The bolded bullets under the DO-NOT-DO heading. */
  const doNotDoBullets = (): string[] => {
    const start = claudeMd.indexOf("## The DO-NOT-DO list");
    expect(start, "the DO-NOT-DO heading is gone from CLAUDE.md").toBeGreaterThan(-1);
    const rest = claudeMd.slice(start + 10);
    const end = rest.indexOf("\n## ");
    const block = end === -1 ? rest : rest.slice(0, end);
    return block.split("\n").filter((l) => l.startsWith("- **"));
  };

  /**
   * Pinned deliberately, and NOT derived from the registry — deriving it would
   * make the two agree by construction and prove nothing. When the founder adds
   * a standing decision to CLAUDE.md, mirror it in constitution.ts and raise
   * this number in the SAME commit; that is the whole mechanism.
   */
  const DO_NOT_DO_BULLETS = 9;

  it(`the list still has ${DO_NOT_DO_BULLETS} bullets`, () => {
    const bullets = doNotDoBullets();
    expect(
      bullets.length,
      "The DO-NOT-DO list changed size. A NEW standing decision must also be " +
        "added to shared/governance/constitution.ts — the registry is the " +
        "checkable form of that list, and nothing else in this file can see a " +
        "decision that was never registered. Add the entry, then update this " +
        "count in the same commit.\n" +
        bullets.map((b) => `  ${b.slice(0, 100)}`).join("\n"),
    ).toBe(DO_NOT_DO_BULLETS);
  });

  it("the registry covers each of the list's distinct subjects", () => {
    // Keyword-per-bullet rather than a fuzzy text match: the registry states
    // decisions in its own words, so comparing prose to prose would fail on
    // wording. Each entry below is a subject the list names and the registry
    // must speak to somewhere.
    //
    // SCANNED OVER id + title + statement ONLY — deliberately NOT the notes.
    // The first version of this searched the whole serialized registry, and a
    // mutation deleting the persona entry's title AND statement still passed,
    // because another entry's NOTE happened to contain the phrase. Notes are
    // commentary; the decision is the id, the title and the statement. A
    // register that is satisfied by something merely MENTIONING a subject is
    // the exact failure this test was written to stop.
    const registryText = CONSTITUTION.map(
      (i) => `${i.id} ${i.title} ${i.statement}`,
    )
      .join(" ")
      .toLowerCase();
    const subjects: Array<[string, string]> = [
      ["marketplace / public API ladder", "marketplace"],
      ["persona verticals", "persona vertical"],
      ["top-level nav entries", "five doors"],
      ["platform send rails", "byo"],
      ["money custody", "custody"],
      ["paid advertising", "ad account"],
      ["residential comps plane", "residential-comps"],
      ["AI destinations", "ambient"],
      ["fabrication", "fabricat"],
      ["founder-only hard stops", "founder-only"],
    ];
    const missing = subjects.filter(([, needle]) => !registryText.includes(needle));
    expect(
      missing.map(([label]) => label),
      "a subject named in CLAUDE.md's DO-NOT-DO list has no voice in the " +
        "registry. That is how `expansion.no-new-persona-verticals` was missing " +
        "for the registry's whole life.",
    ).toEqual([]);
  });
});

describe("constitution ratchet — hard stops must become machine-enforced", () => {
  it("registers the six hard stops", () => {
    // The permanent hard stops from CLAUDE.md's DO-NOT-DO list: four
    // founder-only action classes (spends >$500, pricing, legal signing,
    // customer-data deletion) plus two outright bans — customer money never
    // moves on AcreOS's own account (founder ruling 2026-07-29, "be the rail,
    // not the provider"), and paid advertising is a founder instrument with no
    // customer path in (founder ruling 2026-08-13, resolving B11). The two bans
    // are the same shape judged opposite ways, which is the point of recording
    // both: a single platform account is fatal when it holds CUSTOMER money and
    // fine when it spends ACREOS's own.
    //
    // This count may only GROW by an explicit founder decision; it may never
    // shrink, because a hard stop is permanent.
    expect(hardStops().length).toBe(6);
  });

  it("the count of UNENFORCED hard stops never exceeds the baseline (it may only shrink)", () => {
    const debt = unenforcedHardStops().map((i) => i.id);
    expect(
      debt.length,
      `unenforced hard stops (${debt.length}) exceed the baseline ` +
        `(${UNENFORCED_HARD_STOP_BASELINE}). A hard stop must not lose its ` +
        `automated backstop. If you WIRED enforcement, reclassify it in ` +
        `constitution.ts and lower the baseline. Current debt: ${debt.join(", ")}`,
    ).toBeLessThanOrEqual(UNENFORCED_HARD_STOP_BASELINE);
  });

  it("the >$500 spend hard stop is machine-enforced (never regresses to prose)", () => {
    // This is the one that drifted. Pin it enforced forever.
    expect(invariantById("hard-stop.spend-over-500")?.enforcement.kind).not.toBe(
      "prose-only",
    );
  });
});
