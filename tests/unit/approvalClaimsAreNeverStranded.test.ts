/**
 * A claimed approval that nothing finished must not vanish.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `approvePendingAction` claims the row pending→approved and only THEN
 * executes the tool. If the process dies in that window — a machine replaced
 * mid-deploy, an OOM, the uncaughtException handler calling process.exit — the
 * row stays `approved` forever.
 *
 * `livePendingPredicate` filters on `status = 'pending'`, so `listPendingActions`
 * and `countPendingActions` both skip it. `sweepExpiredPendingActions` also
 * only touches `pending`. Nothing anywhere in the repository read or repaired
 * an `approved` row.
 *
 * Observable behaviour for a paying customer: they tap Approve, the card
 * disappears from the queue, the message is never sent, the badge is
 * "correct", and no record of the failure exists (2026-09-04 review,
 * CONFIRMED).
 *
 * ── WHY execution_unknown AND NOT A RELEASE ─────────────────────────────────
 * Because the claim is the last thing anyone knows. The executor may have died
 * before the send, during it, or after the provider accepted and before the
 * status write — and these sends carry no provider idempotency key, so
 * re-offering the ask means a second tap could send a second message to a real
 * counterparty. Between silently losing a send and silently duplicating one,
 * the third answer is to say we do not know.
 *
 * That choice is load-bearing and is asserted below, so a future author who
 * re-arms these rows has to face the reason first — and add the idempotency
 * key that makes it safe.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Comments stripped — the fix documents the state it replaced, by name. */
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

const KERNEL = "server/services/approvalKernel.ts";
const JOB = "server/jobs/pendingActionExpiryJob.ts";

describe("the claim leaves a timestamp, so a stranded one is findable", () => {
  const kernel = code(KERNEL);

  it("the schema carries claimed_at, and a migration creates it", () => {
    expect(code("shared/schema.ts")).toMatch(/claimedAt: timestamp\("claimed_at"\)/);
    expect(read("scripts/migrate.mjs")).toContain(
      'ALTER TABLE "pending_actions" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp',
    );
    // A column with no index is a sweep that scans the table every 5 minutes.
    expect(read("scripts/migrate.mjs")).toContain('"pending_actions_stale_claim_idx"');
  });

  it("the pending→approved claim stamps it", () => {
    const at = kernel.indexOf('status: "approved"');
    expect(at, "the claim is gone — this test reads nothing").toBeGreaterThan(-1);
    expect(kernel.slice(at, at + 200)).toContain("claimedAt: new Date()");
  });

  it("releasing a claim clears it", () => {
    // Otherwise a released row keeps a claim time and the sweep would judge a
    // row that is back in the queue, correctly, as stranded.
    expect(kernel).toMatch(/status: "pending", approvedByUserId: null, claimedAt: null/);
  });
});

describe("the sweep finds them and says what it does not know", () => {
  const kernel = code(KERNEL);

  it("selects approved rows with a stale claim and no execution", () => {
    const at = kernel.indexOf("export async function sweepStaleApprovalClaims");
    expect(at, "the sweep does not exist").toBeGreaterThan(-1);
    const fn = kernel.slice(at, at + 1800);
    expect(fn).toContain('eq(pendingActions.status, "approved")');
    expect(fn, "a row that DID execute is not stranded").toContain("isNull(pendingActions.executedAt)");
    expect(fn, "a claim with no timestamp predates the column — leave it alone").toMatch(
      /claimedAt\} IS NOT NULL/,
    );
    expect(fn, "a fresh claim is a live execution, not a dead one").toMatch(/make_interval\(mins =>/);
  });

  it("marks them execution_unknown rather than re-offering them", () => {
    const at = kernel.indexOf("export async function sweepStaleApprovalClaims");
    const fn = kernel.slice(at, at + 1800);
    expect(fn).toContain('.set({ status: "execution_unknown" })');
    expect(
      fn,
      "the sweep releases stranded claims back to the queue. These sends carry " +
        "no provider idempotency key, so a second tap can send a second message " +
        "to a counterparty — add the key before making this safe.",
    ).not.toMatch(/\.set\(\{ status: "pending"/);
  });

  it("logs each one, because the whole defect was that nothing recorded it", () => {
    const at = kernel.indexOf("export async function sweepStaleApprovalClaims");
    const fn = kernel.slice(at, at + 2600);
    expect(fn).toContain("logger.error");
    expect(fn).toContain("pendingActionId");
    expect(fn).toContain("toolName");
  });

  it("execution_unknown is NOT in the live queue predicate", () => {
    // If it were, the row would be re-offered and the reasoning above undone.
    const at = kernel.indexOf("function livePendingPredicate");
    const fn = kernel.slice(at, at + 400);
    expect(fn).toContain('eq(pendingActions.status, "pending")');
    expect(fn).not.toContain("execution_unknown");
  });
});

describe("the sweep actually runs", () => {
  const job = code(JOB);

  it("the five-minute job calls it", () => {
    // Built-but-unwired is this repository's most common defect, and a sweep
    // nobody schedules is exactly the shape of the thing it was written to fix.
    expect(job).toContain("sweepStaleApprovalClaims");
    expect(job).toMatch(/await sweepStaleApprovalClaims\(\)/);
  });

  it("its failure does not take the expiry sweep down with it", () => {
    const at = job.indexOf("sweepStaleApprovalClaims()");
    const around = job.slice(Math.max(0, at - 300), at + 400);
    expect(around).toContain("try {");
    expect(around).toContain("catch");
  });

  it("the run says how many it found", () => {
    expect(job).toContain("strandedClaims");
    expect(job).toContain("execution_unknown");
  });

  it("the job is registered by the orchestrator", () => {
    // The last link in the chain: a job whose start* entrypoint nothing calls
    // is the same defect one level up.
    expect(code("server/jobs/runScheduledJobs.ts")).toContain("startPendingActionExpiryJob");
  });
});
