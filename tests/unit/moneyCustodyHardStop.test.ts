/**
 * Money-custody ratchet — the structural half of
 * `hard-stop.no-platform-money-custody`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * Founder ruling 2026-07-29 — "BE THE RAIL, NOT THE PROVIDER". AcreOS's payment
 * architecture applies ONLY to direct subscription payments TO the platform.
 * Customer-managed money (borrower note payments, rent, escrow, distributions)
 * runs on the CUSTOMER's own connected processor account or is routed out
 * entirely: no platform-account fallback, no application fee, no funds
 * transiting AcreOS's balance.
 *
 * The runtime half of that hard stop lives in
 * `server/services/customerMoneyRouting.ts` (`prepareCustomerMoneyCall` throws
 * on a platform take or an unscoped call) and in the ACH lane
 * (`achMandateSetup` / `achAutopay` re-scope every call to the lender's own
 * account). A chokepoint only helps at call sites that use it, so this file
 * guards the perimeter instead: it asserts that the platform-custody shapes
 * appear NOWHERE, and that the surfaces already deleted for violating the
 * ruling stay deleted.
 *
 * The audit that produced the ruling found FOUR dead-or-dormant custody
 * surfaces that had survived multiple honesty waves precisely because there was
 * no payments analogue to the (long-standing) send-rail re-fronting ban:
 *
 *   • `transactionFeeService.ts` — a full escrow-and-take-a-cut engine with ZERO
 *     call sites, which also stamped a fabricated `tr_simulated_<ts>` string
 *     into a money column.
 *   • `/api/transaction-fees` + `/fee-dashboard` — its stub router and founder
 *     console, including a `POST /fees/payouts/trigger` placebo that returned
 *     202 "processing" and did nothing.
 *   • `/api/actum/*` — a single platform `ACTUM_MERCHANT_ID` making AcreOS the
 *     merchant of record for every org, with one endpoint accepting RAW bank
 *     routing and account numbers.
 *   • `marketplace_transactions.seller_payout_*` — columns encoding AcreOS
 *     paying a seller out of its own balance.
 *
 * Deleting them is only durable if something notices when they come back.
 *
 * No DATABASE_URL, no imports from the server runtime: this is a filesystem
 * scan, so it runs anywhere and cannot be defeated by mocking.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

// ───────────────────────────────────────────────────────────────────────────
// Scanner
// ───────────────────────────────────────────────────────────────────────────

const SCAN_ROOTS = ["server", "shared", "client/src"];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The machine-readable doctrine registry STATES the bans, so it necessarily
 * spells out the banned parameter names and the fabricated-id shape. It is a
 * frozen array of decision records — no imports, no Stripe client, no runtime
 * behaviour — so naming them there cannot move money. Excluded from the scans,
 * with `the doctrine registry stays inert` below pinning that it stays inert.
 */
const DOCTRINE_FILES = ["shared/governance/constitution.ts"];

/** Repo-relative source files in scope; tests and doctrine prose excluded. */
function sourceFiles(roots: string[] = SCAN_ROOTS): string[] {
  const files: string[] = [];
  for (const root of roots) {
    for (const abs of walk(path.join(ROOT, root))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      if (/\.(test|spec)\.tsx?$/.test(rel)) continue;
      if (DOCTRINE_FILES.includes(rel)) continue;
      files.push(rel);
    }
  }
  return files;
}

/** A file's lines with pure comment lines removed — what the code actually does. */
function codeLines(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

/**
 * Lines matching `pattern`, skipping pure comment lines so a doc block that
 * NAMES a banned shape (this file's own reasoning, the deletion notes left at
 * each removal site) doesn't count as a violation.
 */
function grepSource(pattern: RegExp, roots?: string[]): string[] {
  const hits: string[] = [];
  for (const rel of sourceFiles(roots)) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (pattern.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return hits;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The platform-take shapes exist nowhere but the guard that forbids them
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every one of these puts AcreOS back into the money path:
 *   application_fee_amount / application_fee_percent — AcreOS taking a cut;
 *   transfer_data                                    — a destination charge, so
 *                                                      funds settle on AcreOS's
 *                                                      balance first;
 *   on_behalf_of                                     — only meaningful when
 *                                                      rebuilding a destination
 *                                                      charge;
 *   transfers.create / payouts.create                — moving money OFF AcreOS's
 *                                                      balance, which presumes it
 *                                                      was there;
 *   ACTUM_MERCHANT_ID                                — one platform merchant of
 *                                                      record for all orgs.
 */
const PLATFORM_TAKE_SHAPES =
  /application_fee_amount|application_fee_percent|applicationFeeAmount|applicationFeePercent|transfer_data|on_behalf_of|transfers\.create|payouts\.create|ACTUM_MERCHANT_ID/;

/**
 * The ONLY file allowed to name them: the runtime guard whose entire job is to
 * reject them. If this list ever needs a second entry, the ruling is being
 * relitigated — which only the founder may do.
 */
const PLATFORM_TAKE_GUARD_FILES = ["server/services/customerMoneyRouting.ts"];

describe("money custody — no platform take anywhere", () => {
  it("names a platform-take Stripe parameter only inside the guard that forbids it", () => {
    const offenders = grepSource(PLATFORM_TAKE_SHAPES).filter(
      (hit) => !PLATFORM_TAKE_GUARD_FILES.some((allowed) => hit.startsWith(`${allowed}:`)),
    );
    expect(
      offenders,
      "Customer money must move on the org's OWN connected processor account " +
        "with no AcreOS cut and no transit through AcreOS's balance (founder " +
        "ruling 2026-07-29). Build the call with prepareCustomerMoneyCall() " +
        `instead. Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the doctrine registry inert (it may state the bans, never execute)", () => {
    for (const rel of DOCTRINE_FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} must not import a payment client`).not.toMatch(
        /from\s+["'](stripe|.*stripeClient.*)["']/,
      );
      expect(src, `${rel} must not import the server runtime`).not.toMatch(
        /from\s+["'].*\/(db|storage)["']/,
      );
    }
  });

  it("keeps the guard itself present (the enforcement may not simply be deleted)", () => {
    for (const guard of PLATFORM_TAKE_GUARD_FILES) {
      expect(fs.existsSync(path.join(ROOT, guard)), `${guard} is missing`).toBe(true);
    }
    const guard = fs.readFileSync(
      path.join(ROOT, "server/services/customerMoneyRouting.ts"),
      "utf8",
    );
    // The chokepoint's two refusals and its scope-setter must all survive.
    expect(guard).toContain("prepareCustomerMoneyCall");
    expect(guard).toContain("assertNoPlatformTake");
    expect(guard).toContain("stripeAccount");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. AcreOS never receives raw bank credentials
// ───────────────────────────────────────────────────────────────────────────

describe("money custody — AcreOS never receives raw bank credentials", () => {
  it("no HTTP route file names a raw routing/account number", () => {
    // The deleted POST /api/actum/create-profile read
    // { routingNumber, accountNumber } straight off req.body. Bank details are
    // collected directly into the org's own processor account; AcreOS stores
    // last4 only (see achMandateSetup.ts).
    const routeRoots = ["server"];
    const hits = grepSource(
      /\b(routingNumber|routing_number|bankAccountNumber)\b/,
      routeRoots,
    ).filter((hit) => /^server\/routes/.test(hit));
    expect(
      hits,
      `An HTTP route must never accept bank routing/account numbers:\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. No fabricated processor identifier in a money field
// ───────────────────────────────────────────────────────────────────────────

describe("money custody — no fabricated processor identifiers", () => {
  it("never mints a simulated transfer/transaction/profile id", () => {
    // transactionFeeService.processPayout() wrote `tr_simulated_${Date.now()}`
    // into stripe_transfer_ids and returned it as though a Stripe Transfer had
    // happened; the Actum client returned `test_txn_<ts>` / `test_profile_<ts>`
    // with success: true whenever it was unconfigured (i.e. always). Both are
    // deleted. A ledger row keyed off an invented processor id is a fabricated
    // payment.
    const hits = grepSource(/tr_simulated|test_txn_|test_profile_|ch_simulated|py_simulated/);
    expect(
      hits,
      `Refuse, don't fabricate — an unconfigured or unimplemented rail must ` +
        `return an error, never a synthetic processor id:\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The deleted custody surfaces stay deleted
// ───────────────────────────────────────────────────────────────────────────

/** path → why it was deleted (surfaced in the failure message). */
const DELETED_CUSTODY_SURFACES: Record<string, string> = {
  "server/services/transactionFeeService.ts":
    "platform escrow + take-a-cut settlement engine (zero call sites; wrote a fabricated tr_simulated_ id into a money column)",
  "server/routes-transaction-fees.ts":
    "its stub router, incl. the POST /fees/payouts/trigger placebo that returned 202 and did nothing",
  "client/src/pages/fee-dashboard.tsx":
    "its founder console — settlements, escrow release, manual payout trigger — over endpoints that returned zeros",
};

describe("money custody — deleted surfaces stay deleted", () => {
  it("does not reintroduce a platform escrow/payout surface", () => {
    const resurrected = Object.keys(DELETED_CUSTODY_SURFACES).filter((p) =>
      fs.existsSync(path.join(ROOT, p)),
    );
    expect(
      resurrected,
      resurrected
        .map((p) => `${p} is back — deleted 2026-07-29: ${DELETED_CUSTODY_SURFACES[p]}`)
        .join("\n"),
    ).toEqual([]);
  });

  it("mounts no /api/transaction-fees router and no /api/actum/* route", () => {
    const hits = grepSource(/["'`]\/api\/transaction-fees|["'`]\/api\/actum\//, ["server"]);
    expect(
      hits,
      `These namespaces were deleted with the platform-custody surfaces:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("routes no client fetch at the deleted fee endpoints", () => {
    const hits = grepSource(/\/api\/transaction-fees/, ["client/src"]);
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("keeps only the rail-agnostic ACH return-code taxonomy in actumProcessing", () => {
    // The file survives ONLY because achAutopay classifies real Stripe
    // us_bank_account returns against the NACHA R01-R29 table it holds. The
    // platform-merchant client (profile creation, charging, the batch runner)
    // is gone and must not return.
    const rel = "server/services/actumProcessing.ts";
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    // Code only: the file's header comment records WHAT was deleted by name.
    const src = codeLines(rel);
    expect(src).toContain("ACH_RETURN_CODES");
    expect(src).toContain("classifyAchReturn");
    for (const banned of [
      "createActumPaymentProfile",
      "chargeActumACH",
      "runMonthlyActumPaymentBatch",
      "isActumConfigured",
    ]) {
      expect(
        src.includes(banned),
        `${rel} must not reintroduce ${banned}: a platform-wide merchant ` +
          `account makes AcreOS merchant of record for every customer's ` +
          `borrower debits`,
      ).toBe(false);
    }
  });

  it("stores no seller-payout state on marketplace transactions", () => {
    // AcreOS receiving sale proceeds and paying the seller out of its own
    // balance. platform_fee_* stays: that fee is a payment TO AcreOS.
    const hits = grepSource(
      /sellerPayoutStatus|sellerPayoutAmount|seller_payout_status|seller_payout_amount|sellerStripeTransferId|seller_stripe_transfer_id/,
    );
    expect(
      hits,
      `Seller payouts imply AcreOS held the sale proceeds:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("defines no platform fee-escrow tables", () => {
    const hits = grepSource(
      /pgTable\(\s*["'](transaction_fee_settlements|fee_payout_schedules|fee_audit_log)["']/,
      ["shared"],
    );
    expect(hits, `Dropped in migration 0214:\n${hits.join("\n")}`).toEqual([]);
  });
});
