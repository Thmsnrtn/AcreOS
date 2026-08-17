/**
 * Two note data models. The founder ruled which one survives.
 *
 * | | legacy | cents family |
 * |---|---|---|
 * | tables | `notes`, `payments` | `acquired_notes`, `note_payments` |
 * | money | `numeric` read with `parseFloat` | `bigint` integer cents |
 *
 * `shared/finance/cents.ts` states the house rule — *money is SUMMED and
 * COMPARED in integer cents, never in JS floats* — and names
 * `server/services/notePaymentMath.ts` as the layer that "got this right from
 * day one". The cents family follows it; the legacy family predates it.
 *
 * **Founder ruling 2026-08-13 (BLOCKERS B10): `acquired_notes` /
 * `note_payments` is the successor.** So the legacy writers are a MIGRATION
 * LIST, not a maintenance burden — and the point of this file is to keep that
 * list honest and shrinking rather than to freeze a snapshot of it.
 *
 * WHAT THIS PINS, AND WHY THAT SHAPE
 * ----------------------------------
 * The set of files that WRITE the legacy tables, derived from source and
 * strictly down-only. Not a hand-maintained list: a hand-maintained migration
 * list is exactly the artifact that goes stale between the decision and the
 * migration, and this program has now watched that happen to a deletion ledger,
 * a feature-flag catalogue and a reseller feature set in the same week.
 *
 * Down-only means two things at once, and both matter:
 *
 *   - **A NEW legacy writer fails.** Adding one deepens the model being
 *     retired, and it is the change most likely to be made by accident — the
 *     legacy tables are the ones with the familiar names.
 *   - **Migrating one to the cents family passes, and must lower the
 *     baseline in the same commit.** That is what turns the ruling into
 *     measurable progress instead of a sentence in a document.
 *
 * WHAT WAS DELETED WITH THE RULING. `POST /api/notes/:id/record-payment` in
 * `routes-elite-features.ts` — B10's named deletion candidate, and it had no
 * caller: the record-payment modal posts to `/api/notes/:id/payments`, the
 * cents route. It reimplemented the principal/interest split in floats, was not
 * transactional (a bare insert then a separate update), credited tax escrow
 * BEFORE the payment insert, updated the note WITHOUT an organization predicate,
 * and typed the update payload `any`. Under the ruling, fixing those five would
 * have been work thrown away on a model being retired.
 *
 * WHAT IS **NOT** ASSERTED HERE. That the remaining writers are correct. Three
 * of them do float math today, and that stays true until they migrate — this
 * file is about the DIRECTION of travel, not the state of the legacy code. The
 * actual data migration needs a database (BLOCKERS B1) and is not attempted.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping, so a note ABOUT a legacy write is not one. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

/**
 * `db.insert|update|delete(<table>)`, tolerant of the fluent line break Drizzle
 * calls are usually written with (`db\n  .update(notes)`).
 */
function writersOf(tables: string[]): string[] {
  const re = new RegExp(
    String.raw`db\s*\.\s*(?:insert|update|delete)\s*\(\s*(?:${tables.join("|")})\s*\)`,
  );
  return serverFiles()
    .filter((abs) => re.test(stripComments(fs.readFileSync(abs, "utf8"))))
    .map((abs) => path.relative(ROOT, abs))
    .sort();
}

/**
 * Files that still write `notes` / `payments`, and what each is for.
 *
 * **This list may only SHRINK.** Migrating one to `acquired_notes` /
 * `note_payments` lowers it in the same commit; adding one fails.
 */
const LEGACY_WRITERS: Record<string, string> = {
  "server/routes-subdivisions.ts":
    "Creates a seller-financed note when a subdivision lot sells.",
  "server/services/achAutopay.ts":
    "Advances the note after an autopay debit clears. Already uses splitPaymentCents.",
  "server/services/atrSafeHarbor.ts":
    "Stamps the ability-to-repay safe-harbour determination onto the note.",
  "server/services/propertyTaxService.ts":
    "Tax-escrow credits and debits against the note's escrow balance (4 writes).",
  "server/storage/noteRepo.ts":
    "The legacy repository itself — create, update, delete, and the payment " +
    "update. This is the file a migration would replace, not amend.",
};

describe("the legacy note model is terminal", () => {
  const writers = writersOf(["notes", "payments"]);

  it("finds writers at all (vacuity guard)", () => {
    // A derived ratchet that derives nothing green-lights everything. If the
    // Drizzle call shape changes, this fails first and loudly rather than
    // silently reporting a migration that never happened.
    expect(
      writers.length,
      "no legacy note writers found in server/ — has the db call shape changed?",
    ).toBeGreaterThan(0);
  });

  it("the writer set may only shrink", () => {
    const known = Object.keys(LEGACY_WRITERS).sort();
    const added = writers.filter((w) => !(w in LEGACY_WRITERS));
    const removed = known.filter((k) => !writers.includes(k));

    expect(
      added.join("\n"),
      "a NEW writer of the legacy `notes`/`payments` model appeared. The " +
        "founder ruled 2026-08-13 (B10) that `acquired_notes`/`note_payments` " +
        "is the successor, so this deepens a model being retired — and the " +
        "legacy tables are the ones with the familiar names, which is why this " +
        "is easy to do by accident. Write the cents family instead; if the new " +
        "write is genuinely required on the legacy model, add it here with the " +
        "reason and say why in B10.",
    ).toBe("");

    expect(
      removed.join("\n"),
      "a legacy writer is gone — good. Remove its LEGACY_WRITERS entry in the " +
        "SAME commit so the list keeps measuring real progress rather than " +
        "describing a repository that no longer exists.",
    ).toBe("");
  });

  it("every remaining writer says what it is for", () => {
    // A migration list whose entries are one word is a list nobody can plan
    // from. Each entry has to carry enough for the next person to sequence it.
    for (const [file, why] of Object.entries(LEGACY_WRITERS)) {
      expect(fs.existsSync(path.join(ROOT, file)), `${file} does not exist`).toBe(true);
      expect(why.length, `${file} has a stub reason`).toBeGreaterThan(40);
    }
  });

  it("the cents family is where new work goes, and it is alive", () => {
    // The other half of "terminal": if the successor had no writers, calling
    // the legacy model terminal would be declaring the feature dead rather
    // than migrating it.
    const cents = writersOf(["acquiredNotes", "notePayments"]);
    expect(
      cents.length,
      "the cents family has no writers — the successor model is not actually " +
        "carrying the feature, so 'legacy is terminal' would be a demotion, " +
        "not a migration",
    ).toBeGreaterThan(2);
    expect(cents, "the acquired-note ledger's writer is gone").toContain(
      "server/routes-notes.ts",
    );
  });
});

describe("the house rule the ruling follows is still written down", () => {
  it("cents.ts still states it", () => {
    // The ruling's justification. If the repo ever stops requiring integer
    // cents, B10 was decided on a premise that no longer holds and should be
    // re-argued rather than inherited.
    const cents = fs.readFileSync(path.join(ROOT, "shared/finance/cents.ts"), "utf8");
    expect(cents).toMatch(/integer cents/i);
    expect(cents).toMatch(/float/i);
  });

  it("splitPaymentCents is the shared split, and the recorders use it", () => {
    // B10 says "three of the four payment recorders use it — achAutopay,
    // routes-borrower (twice), and paymentApplication". Counted against HEAD
    // that is three CALL SITES in two files, and `paymentApplication` is not
    // one of them: it deliberately accepts a PRE-SPLIT so the module stays pure
    // and testable, with its own contract naming notePaymentMath.
    // splitPaymentCents as the upstream source. True in spirit, not a call —
    // and worth pinning as the distinction it is, so nobody "fixes"
    // paymentApplication into calling it and loses that purity.
    const math = fs.readFileSync(
      path.join(ROOT, "server/services/notePaymentMath.ts"),
      "utf8",
    );
    expect(math).toContain("export function splitPaymentCents");

    let callSites = 0;
    for (const abs of serverFiles()) {
      if (abs.endsWith("notePaymentMath.ts")) continue;
      const code = stripComments(fs.readFileSync(abs, "utf8"));
      callSites += [...code.matchAll(/(?<!import\s*\{[^}]*)\bsplitPaymentCents\s*\(/g)].length;
    }
    expect(
      callSites,
      "fewer splitPaymentCents call sites than expected — a payment recorder " +
        "went back to doing its own float math. The house rule in " +
        "shared/finance/cents.ts is that money is summed and compared in " +
        "integer cents, never in JS floats.",
    ).toBeGreaterThanOrEqual(3);

    const application = fs.readFileSync(
      path.join(ROOT, "server/services/paymentApplication/index.ts"),
      "utf8",
    );
    expect(
      application,
      "paymentApplication stopped naming splitPaymentCents as the source of " +
        "the split it accepts — either it now computes one itself (losing the " +
        "purity that contract exists for) or the provenance of those cents is " +
        "no longer written down",
    ).toContain("splitPaymentCents");
  });
});

describe("the float-math record-payment route stays deleted", () => {
  const elite = stripComments(
    fs.readFileSync(path.join(ROOT, "server/routes-elite-features.ts"), "utf8"),
  );

  it("it is gone", () => {
    expect(
      elite.includes('app.post("/api/notes/:id/record-payment"'),
      "the elite record-payment route is back. It had no caller — the modal " +
        "posts to /api/notes/:id/payments — and it did float principal/interest " +
        "math, was not transactional, credited tax escrow before the payment " +
        "insert, updated the note with no organization predicate, and typed its " +
        "update payload `any`. Under the B10 ruling, making it correct is work " +
        "thrown away on a model being retired.",
    ).toBe(false);
  });

  it("the route that replaced it is the transactional one", () => {
    // Named explicitly: a deletion is only safe because a better path exists,
    // and if that path ever goes, the deletion needs re-examining rather than
    // leaving customers with no way to record a payment.
    const notesRoutes = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-notes.ts"), "utf8"),
    );
    expect(notesRoutes, "the cents-family payment route is gone").toContain(
      '"/api/notes/:id/payments"',
    );
    const modal = fs.readFileSync(
      path.join(ROOT, "client/src/components/note-record-payment-modal.tsx"),
      "utf8",
    );
    expect(modal, "the modal no longer posts to the cents route").toContain(
      "/api/notes/${note.id}/payments",
    );
  });
});
