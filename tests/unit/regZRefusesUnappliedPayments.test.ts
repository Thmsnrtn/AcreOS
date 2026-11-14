/**
 * A §1026.41 periodic statement may not tell a borrower who paid that they
 * paid nothing.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Every past-payment figure on a periodic statement — principal, interest,
 * escrow, fees, unapplied, the transactions array and the year-to-date totals
 * — is summed from `payment_applications`
 * (server/services/periodicStatements/index.ts). That table has exactly ONE
 * writer in the entire server, `applyPayment` in
 * server/services/paymentApplication/index.ts, and NOTHING imports that
 * module: the repository's own reachability gate files it under module
 * orphans. So no production code path has ever written a row.
 *
 * Payments, meanwhile, are posted through five live rails — the borrower
 * portal (server/routes-borrower.ts), ACH autopay settlement
 * (server/services/achAutopay.ts, twice), Stripe webhooks
 * (server/webhookHandlers.ts) and the note repository
 * (server/storage/noteRepo.ts) — plus the manual note-payment route for
 * acquired notes (server/routes-notes.ts).
 *
 * The statement job runs unconditionally on the 1st of every month for every
 * organization with an active subscription
 * (server/jobs/runScheduledJobs.ts). For any borrower who actually paid, the
 * generator would therefore have printed $0 applied to principal, $0 to
 * interest, $0 to escrow, and the PDF's literal line "No transactions during
 * this cycle." on a federally mandated disclosure.
 *
 * That is not a missing feature. It is a false statement of account, and a
 * fabricated number under the standing no-fabrication rule.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The interim fix is a REFUSAL, not a guess: when a cycle has real posted
 * payments and zero applications to describe them with, the loan is skipped
 * into `periodic_statement_skips` with a reason and the § that authorises it,
 * exactly like the existing NO_DERIVABLE_DUE_DATE refusal. A missing
 * statement is a disclosure defect the ledger records and an examiner can
 * see; a wrong statement is a misrepresentation nobody can see.
 *
 * A truthful $0 still generates: a borrower who paid nothing has no rows in
 * either table, so the contradiction never arises and the statement issues as
 * before. This refuses one specific shape.
 *
 * ── THE REVOCATION CONDITION IS PART OF THE GATE ────────────────────────────
 * The last block below originally asserted the premise that MADE this refusal
 * necessary — that `payment_applications` had no reachable writer — and was
 * written to fail the day someone wired the posting paths, so the refusal
 * would be revisited instead of outliving its cause.
 *
 * That day came on 2026-11-09 (defect D4, caught by the PKG-3 settlement-proof
 * suite): every posting path now writes the breakdown in its own transaction
 * via `recordPostedPaymentApplication`. The revisit did NOT delete the
 * refusal, and the block below now pins why: the cycles posted before the
 * wiring have no application rows and no backfill yet, so deleting the
 * refusal would print $0 breakdowns for real payments — the exact
 * misrepresentation it exists to prevent — and the refusal remains the guard
 * for any future posting path that forgets the mirror write. The block's
 * assertion flipped direction: it now fails if a posting path LOSES its
 * wiring, or if a new `.insert(paymentApplications)` appears outside the one
 * module that owns the table.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const GENERATOR = "server/services/periodicStatements/index.ts";

/** Strip comments so prose about a symbol never reads as a call to it. */
function code(rel: string): string {
  return stripComments(read(rel));
}

describe("the refusal exists and is reachable from both loan loops", () => {
  const src = code(GENERATOR);

  it("PAYMENTS_NOT_APPLIED is a real skip code, not a string typed at one call site", () => {
    expect(src).toMatch(/StatementSkipCode\s*=[\s\S]{0,400}"PAYMENTS_NOT_APPLIED"/);
  });

  it("both the notes loop and the acquired-notes loop check before generating", () => {
    // The guard must run BEFORE the generate call in each loop — a check that
    // happens afterwards has already issued the statement it was meant to stop.
    for (const [table, generateCall] of [
      ["notes", "generateOneStatement({"],
      ["acquired_notes", "generateOneAcquiredStatement({"],
    ] as const) {
      const guardAt = src.indexOf(`breakdownWouldBeFabricated(\n        "${table}"`);
      expect(guardAt, `${table}: no fabrication guard`).toBeGreaterThan(-1);
      const generateAt = src.indexOf(generateCall, guardAt);
      expect(generateAt, `${table}: guard does not precede the generate call`).toBeGreaterThan(guardAt);
      // And the guard's failure path skips rather than falling through.
      const between = src.slice(guardAt, generateAt);
      expect(between).toContain('code: "PAYMENTS_NOT_APPLIED"');
      expect(between).toContain("continue;");
    }
  });

  it("the refusal names the section that authorises it and refuses only the contradiction", () => {
    expect(src).toContain('PAYMENTS_NOT_APPLIED_CITATION = "12 CFR 1026.41(d)(3)"');
    // Zero applications alone is NOT enough — a borrower who paid nothing
    // still gets a truthful $0 statement. The guard returns false (no
    // refusal) as soon as any application row exists for the cycle.
    expect(src).toMatch(/if \(applied\.length > 0\) return false;/);
  });

  it("the posted-payment probe is tenant-scoped on both tables", () => {
    const fn = src.slice(src.indexOf("async function hasPostedPaymentInCycle"));
    expect(fn).toContain("eq(payments.organizationId, organizationId)");
    expect(fn).toContain("eq(notePayments.organizationId, organizationId)");
  });

  it("the applications probe is tenant-scoped too", () => {
    const fn = src.slice(src.indexOf("async function breakdownWouldBeFabricated"));
    expect(fn).toContain("eq(paymentApplications.organizationId, organizationId)");
  });
});

describe("the D4 cure stays wired, and the refusal stays as its guard", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...walk(rel));
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(rel);
    }
    return out;
  }
  const serverFiles = walk("server");

  it("scans a real population (vacuity guard)", () => {
    expect(serverFiles.length).toBeGreaterThan(300);
  });

  it("payment_applications still has exactly one writer module", () => {
    // Single-writer discipline survived the cure: every posting path calls
    // the recorder in the module that owns the table; no path inserts into
    // payment_applications directly. A second literal insert site is how
    // the mirror writes drift apart — fail here instead.
    const writers = serverFiles.filter((f) => /\.insert\(paymentApplications\)/.test(code(f)));
    expect(writers).toEqual(["server/services/paymentApplication/index.ts"]);
  });

  it("every posting path imports the recorder — and calls it", () => {
    // The D4 wiring set (2026-11-09), one entry per live rail:
    //   portalPaymentPosting — the serviced-note posting rule behind the
    //     borrower portal, the Stripe checkout webhook, payment links and
    //     the operator finance route;
    //   achAutopay — ACH settlement AND its return reversal;
    //   noteRepo — the sunset portal route's createPayment;
    //   webhookHandlers — the charge-refund reversal loop;
    //   routes-notes — the acquired-note ledger route.
    // If a rail loses its call, its borrowers' statements go back to being
    // refused — the refusal above will still protect them, but the cure is
    // gone, so this gate fails loudly instead.
    const wiring = [
      "server/routes-notes.ts",
      "server/services/achAutopay.ts",
      "server/services/borrower/portalPaymentPosting.ts",
      "server/storage/noteRepo.ts",
      "server/webhookHandlers.ts",
    ];
    const importers = serverFiles.filter(
      (f) =>
        f !== "server/services/paymentApplication/index.ts" &&
        /from\s+["'][^"']*paymentApplication(?:\/index)?["']/.test(code(f)),
    );
    expect(importers.sort()).toEqual(wiring);
    for (const f of wiring) {
      expect(code(f), `${f} imports the recorder but never calls it`).toContain(
        "recordPostedPaymentApplication(",
      );
    }
  });

  it("the statement job still runs unconditionally for every active organization", () => {
    // If this stops being true the exposure changes, and so should the fix.
    expect(code("server/jobs/runScheduledJobs.ts")).toContain("periodic_statements_monthly");
  });
});
