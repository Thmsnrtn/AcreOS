/**
 * Seventy-six files say they are "the ONE place". This checks whether they are.
 *
 * Unit 96 found `formatCents` naming four different functions while its canonical
 * module counted its rivals in prose and was wrong on both the count and the
 * names. The obvious next question is not "are there other `formatCents`" but
 * *how many other modules make that same claim, and is any of them also false?*
 *
 * The claim is written down, repeatedly and in the repo's own words — "This is
 * the ONE place …", "single source of truth for …", "the canonical home". That
 * makes it the documented technique rather than another grep-anomaly detector:
 * find a rule the repo has already stated and enumerate the surfaces it covers.
 * Four such detectors have failed on this codebase; this one starts from an
 * assertion the code makes about itself.
 *
 * THE RESULT. 76 claimants, and of every symbol they export, **seven** are also
 * defined somewhere else. Six are name collisions between unrelated domains and
 * are allowlisted below with reasons. One was real:
 *
 * **`delinquencyIsDeterminable`** — the predicate deciding whether the product
 * may say a borrower is behind — had THREE implementations. The server's parsed
 * the date and round-tripped it through `Date.UTC`; both client copies tested
 * only the string's shape, `/^\d{4}-\d{2}-\d{2}$/`. `"2026-02-30"` matches that
 * shape and is not a day, so the screen would have declared aging determinable
 * for a date the server refuses to measure from. Latent — the column is a
 * Postgres `date` — and recorded as latent.
 *
 * What makes it worth fixing rather than noting is the reason both copies gave:
 * *"the client cannot import server code, so the check is restated here."* True
 * of `server/`, and it skips `shared/`, which is browser-safe by construction and
 * which both pages already import from. A comment that admits a mirror and
 * explains why it must exist is a standing invitation to write a third. The
 * predicate now lives in `shared/notes/delinquency.ts`.
 *
 * THE GATE CAUGHT TWO THINGS ON ITS FIRST RUNS, and both were mine.
 *
 * **First:** moving the server's private `parseIsoDate` into `shared/` collided
 * with an EXPORTED `parseIsoDate` in `shared/regulatory/depositReturnRules.ts`
 * that does `String(iso).slice(0, 10)` and then trusts `new Date()` — so it
 * accepts `"2026-02-30"` and silently returns March 2, on a statutory
 * security-deposit return deadline. Two functions with one name and opposite
 * answers about whether a date EXISTS is the exact thing this file prevents, so
 * the strict one took a name that says which it is. The lenient one is recorded
 * in NEXT_UP as its own question; quietly renaming around it would have hidden it.
 *
 * **Second:** that new name, `parseCalendarDate`, collided with a THIRD
 * independent implementation in `server/services/periodicStatements/index.ts` —
 * and that one was better. It accepts a `Date` and an ISO datetime as well as
 * `'YYYY-MM-DD'`, all with the same roll-over rejection, which matters because
 * `next_payment_date` is a `date` column on `acquired_notes` and a `timestamp` on
 * two other tables: the anchored version would refuse a due date that genuinely
 * exists. So consolidation moved THAT body into `shared/` rather than replacing
 * it with the weaker one. A widening, safe on every current caller (all pass
 * `'YYYY-MM-DD'` from `toIsoDate`) and correct on the ones that do not yet.
 *
 * Neither collision was visible to any existing gate, and neither would have been
 * found by reading the diff — which is the argument for the check.
 *
 * **WHERE THE PARSER ACTUALLY IS, as of unit 99:** `shared/dates/calendar.ts`,
 * not `shared/notes/delinquency.ts`. It moved once more when the same rollover
 * defect turned up on a statutory deposit deadline and a payoff quote, which made
 * a notes-specific home wrong for it. This paragraph exists because the sentence
 * above would otherwise be the exact thing this file was written to catch — a
 * comment naming a location that has since changed.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { delinquencyIsDeterminable } from "@shared/notes/delinquency";
// The parser lives in the neutral module, not behind the notes one. Unit 100's
// completeness audit removed the re-export that made this import work: a
// re-export with no production consumer is the same dead weight as any other
// unreached export, and a test importing through it hid that.
import { parseCalendarDate } from "@shared/dates/calendar";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
      out.push(path.relative(ROOT, full));
    }
  };
  for (const tree of ["shared", "server", "client/src"]) walk(path.join(ROOT, tree));
  return out.sort();
}

const RAW = new Map<string, string>();
const CODE = new Map<string, string>();
for (const rel of sourceFiles()) {
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  RAW.set(rel, raw);
  CODE.set(rel, stripComments(raw));
}

/** A top-level named definition, exported or not. */
const DEFINITION =
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/gm;

/** An EXPORTED top-level named definition. */
const EXPORTED =
  /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/gm;

/** The repo's own words for "there is exactly one of these". */
const CLAIM =
  /the ONE place|single source of truth|canonical home|the only place|THE ONLY `?\w+`? IN THE REPOSITORY/i;

const definitionsOf = new Map<string, Set<string>>();
for (const [rel, code] of CODE) {
  DEFINITION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEFINITION.exec(code)) !== null) {
    const sym = m[1] ?? m[2];
    if (!definitionsOf.has(sym)) definitionsOf.set(sym, new Set());
    definitionsOf.get(sym)!.add(rel);
  }
}

/** Claim is read from the file's HEADER, where a module states what it is. */
const claimants = [...RAW].filter(([, raw]) => CLAIM.test(raw.slice(0, 4000))).map(([rel]) => rel);

/**
 * Name collisions that are NOT a broken claim. Each says why, in the idiom
 * `reachability.json` already uses — an allowlist you can append to without
 * justifying yourself is how a gate rots.
 */
const ALLOWED: Record<string, string> = {
  "shared/data-classification.ts::classify":
    "A three-letter-common verb. The rivals classify unrelated things — autonomy " +
    "guardrail bands, feedback sentiment, and SLO burn-rate status. Nothing about " +
    "data-classification CLASSES is duplicated; the word is.",
  "shared/rental/noi.ts::computeNoi":
    "Different inputs, and the claim says so: this module owns NOI derived from " +
    "STORED property_expenses rows. routes-rent-roll-import computes a preview NOI " +
    "from an UPLOADED rent roll that has not been stored yet. (Its opex default of " +
    "`collected * 0.40` is a rule of thumb standing in for a figure the uploader " +
    "did not give — a separate question, recorded in NEXT_UP rather than folded in " +
    "here.)",
  "shared/governance/constitution.ts::unenforced":
    "The same one-line filter applied to two different registers — the constitution " +
    "and the statute register each expose their own prose-only entries. Duplicated " +
    "IDIOM, not duplicated state; merging them would couple two registries that " +
    "are deliberately independent.",
  "shared/subdivision/lotPricing.ts::deriveBasePerAcreCents":
    "Not a copy: routes-lot-pricing.ts imports this one as " +
    "`deriveBasePerAcreCentsPure` and wraps it in a DB load that fetches the parent " +
    "parcel. The wrapper shares the name because it answers the same question one " +
    "layer up, and it delegates the arithmetic rather than restating it.",
  "server/services/aiRouter.ts::modelForTier":
    "Different tier vocabularies. aiRouter maps ITS complexity tiers to models; " +
    "solene-chat-config maps the Solene chat tiers (strategic/conversational/fast/" +
    "code) to theirs. One is the router's, one is a product surface's.",
  "server/services/aiRouter.ts::estimateCost":
    "Per-vendor pricing, which cannot be one function: voyageClient prices Voyage " +
    "embedding tokens, solene/chat/modelRouter prices that surface's own calls. " +
    "A shared `estimateCost` would have to know every vendor's price sheet.",
};

function collisions(): string[] {
  const found: string[] = [];
  for (const rel of claimants) {
    const code = CODE.get(rel)!;
    EXPORTED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EXPORTED.exec(code)) !== null) {
      const sym = m[1] ?? m[2];
      const others = [...(definitionsOf.get(sym) ?? [])].filter((f) => f !== rel);
      if (others.length > 0) found.push(`${rel}::${sym}`);
    }
  }
  return [...new Set(found)].sort();
}

describe("every 'this is the ONE place' claim is true", () => {
  it("finds the claimants at all (vacuity guard)", () => {
    // If the header scan or the walk broke, "no collisions" would pass at zero.
    expect(claimants.length, "no single-owner claims found — the scan is broken")
      .toBeGreaterThan(50);
    expect(claimants).toContain("shared/finance/cents.ts");
  });

  it("and finds definitions at all (second vacuity guard)", () => {
    expect(definitionsOf.get("formatCents")?.size, "the definition scan is broken").toBe(1);
  });

  it("no claimant's export is defined anywhere else", () => {
    const unexplained = collisions().filter((c) => !(c in ALLOWED));
    expect(
      unexplained,
      "a module claiming to be the ONE place has a rival definition. Either give " +
        "the other one a NAME that says what it actually is (the copies are rarely " +
        "identical — that is what makes a blind de-duplication dangerous), or move " +
        "the shared one to `shared/` and import it from both sides, or add an " +
        "ALLOWLIST entry here saying why the collision is only a name.",
    ).toEqual([]);
  });

  it("every allowlist entry still corresponds to a real collision", () => {
    // Both directions, so the register cannot go stale: an entry whose collision
    // was resolved must be REMOVED, not left as decoration.
    const live = new Set(collisions());
    for (const key of Object.keys(ALLOWED)) {
      expect(live.has(key), `allowlist entry '${key}' no longer collides — delete it`).toBe(true);
    }
  });

  it("and carries a real reason", () => {
    for (const [key, reason] of Object.entries(ALLOWED)) {
      // 150, not 60. Every real entry here explains WHY the collision is only a
      // name, and that takes a sentence or two; a 60-char floor was satisfied by
      // the first fragment of a concatenated reason with the rest deleted.
      expect(reason.trim().length, `${key} has a token reason`).toBeGreaterThan(150);
    }
  });
});

describe("the delinquency predicate has one owner", () => {
  it("is defined only in shared/notes/delinquency.ts", () => {
    expect([...(definitionsOf.get("delinquencyIsDeterminable") ?? [])]).toEqual([
      "shared/notes/delinquency.ts",
    ]);
  });

  it("both note pages and the server read that one", () => {
    // Vacuity guard: one definition proves nothing if the surfaces stopped using
    // it. This is the half unit 90 showed matters — a server-side fix changed
    // nothing on screen because the client answered the question independently.
    for (const rel of [
      "client/src/pages/notes.tsx",
      "client/src/pages/note-detail.tsx",
      "server/services/notes/acquiredNoteSchedule.ts",
    ]) {
      expect(CODE.get(rel), `${rel} no longer imports the shared predicate`).toMatch(
        /from "@shared\/notes\/delinquency"/,
      );
    }
  });

  it("it judges the date rather than the string's shape", () => {
    // The drift that made three copies dangerous. A shape test accepts
    // "2026-02-30"; this must not.
    // The parse moved AGAIN after this gate first shipped: unit 99 found the
    // same rollover defect on a statutory deposit deadline and a payoff quote,
    // so `parseCalendarDate` now lives in the neutral `shared/dates/calendar.ts`
    // and this module imports it. The assertion follows the definition rather
    // than being deleted — the invariant is unchanged, only its address is.
    const src = CODE.get("shared/notes/delinquency.ts")!;
    expect(src, "the predicate stopped delegating to the canonical parse").toMatch(
      /from "\.\.\/dates\/calendar"/,
    );
    const canonical = CODE.get("shared/dates/calendar.ts")!;
    // The definition, not a substring — `toContain("parseCalendarDate")` also
    // matches `parseCalendarDateX`, which is how this assertion first survived
    // a rename mutation.
    expect(canonical).toMatch(/export function parseCalendarDate\(/);
    expect(
      canonical,
      "the round-trip check is gone — impossible dates roll over silently",
    ).toContain("getUTCDate() !== day");
  });

  it("accepts every shape the three columns actually store", () => {
    // BEHAVIOURAL, not a source scan — this is the argument for having taken
    // periodicStatements' body instead of the anchored one, so it is checked by
    // calling the function. `next_payment_date` is a `date` column on
    // acquired_notes and a `timestamp` on two other tables, so a parser that
    // handled only 'YYYY-MM-DD' would refuse a due date that genuinely exists.
    expect(parseCalendarDate("2026-03-01")?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(parseCalendarDate("2026-03-01T14:22:05.000Z")?.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(parseCalendarDate(new Date("2026-03-01T14:22:05.000Z"))?.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    // …and still refuses what is not a day. This is the half the client copies
    // got wrong: a shape test accepts both of these.
    expect(parseCalendarDate("2026-02-30"), "Feb 30 rolled forward instead of refusing").toBeNull();
    expect(parseCalendarDate("2026-13-45")).toBeNull();
    expect(parseCalendarDate(null)).toBeNull();
    expect(parseCalendarDate(new Date("nonsense"))).toBeNull();

    // The predicate inherits all of it.
    expect(delinquencyIsDeterminable("2026-03-01")).toBe(true);
    expect(delinquencyIsDeterminable("2026-02-30")).toBe(false);
    expect(delinquencyIsDeterminable(null)).toBe(false);
  });

  it("the 'client cannot import server code' rationale is retired", () => {
    // Read RAW: the sentence being retired is a comment, and it is the thing that
    // would license a fourth copy. Left in place, it reads as a standing reason.
    for (const rel of ["client/src/pages/notes.tsx", "client/src/pages/note-detail.tsx"]) {
      expect(
        RAW.get(rel),
        `${rel} still says the check must be restated because the client cannot ` +
          `import server code. It can import from shared/, which is where the ` +
          `predicate now lives.`,
      ).not.toMatch(/cannot import\s*\n?\s*\*?\s*server code, so the check is restated/);
    }
  });
});
