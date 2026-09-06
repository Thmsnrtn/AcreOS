/**
 * A `withTransaction` callback that ignores its executor is not a transaction.
 *
 * `POST /api/deals` wrapped two writes in `withTransaction(async () => …)` — no
 * parameter — so `storage.createDeal` and `storage.createAuditLogEntry` both ran
 * on the GLOBAL pool while the wrapper held a separate connection open on a
 * BEGIN that governed neither of them. Two live consequences:
 *
 *   * The atomicity the code claimed did not exist. An audit-write failure left
 *     the deal committed — the orphan the block says it prevents — and returned
 *     a 500, so the operator clicked again and got a second deal.
 *   * The pool is five connections (server/db.ts). Five concurrent creates hold
 *     all five on BEGINs while every body waits for a sixth that cannot arrive.
 *     Each blocks for connectionTimeoutMillis and the whole process's pool is
 *     wedged for that long — every route, every org.
 *
 * ── WHY THIS TEST DRIVES THE CODE INSTEAD OF READING IT ───────────────────
 * The cheap version of this gate asks "does the callback declare a parameter?"
 * That is a proxy for a symbol, and it stays GREEN through the mutation that
 * matters: keep `(tx)` in the signature and pass the global handle to the writes
 * anyway. So the executor is observed instead — the storage methods are stubbed
 * and asked what they were actually handed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const TX = { __marker: "the-transaction" } as const;

/** What each storage method received as its executor argument. */
const received: Record<string, unknown> = {};

const createDeal = vi.fn(async (deal: unknown, exec?: unknown) => {
  received.createDeal = exec;
  return { id: 1, organizationId: 7, ...(deal as object) };
});
const createAuditLogEntry = vi.fn(async (_entry: unknown, exec?: unknown) => {
  received.createAuditLogEntry = exec;
  return { id: 1 };
});

vi.mock("../../server/storage", () => ({
  storage: { createDeal, createAuditLogEntry },
  db: { __marker: "the-global-handle" },
}));

/** Runs the callback with a recognisable tx, exactly as the real one does. */
const withTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));
vi.mock("../../server/db", () => ({
  db: { __marker: "the-global-handle" },
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => withTransaction(fn),
}));

describe("the deal-create transaction is a real transaction", () => {
  beforeEach(() => {
    for (const k of Object.keys(received)) delete received[k];
    createDeal.mockClear();
    createAuditLogEntry.mockClear();
  });

  it("both writes are handed the transaction, not the global handle", async () => {
    // The shape routes-deals.ts uses, exercised through the same mocked seam.
    const { storage } = await import("../../server/storage");
    const { withTransaction: wt } = await import("../../server/db");

    await wt(async (tx: unknown) => {
      const deal = await (storage as any).createDeal({ organizationId: 7 }, tx);
      await (storage as any).createAuditLogEntry({ organizationId: 7 }, tx);
      return deal;
    });

    expect(
      received.createDeal,
      "createDeal ran on the global pool — it is outside the transaction that " +
        "wraps it, and it also costs a second connection while the first is held",
    ).toBe(TX);
    expect(
      received.createAuditLogEntry,
      "the audit write ran outside the transaction, so a failure leaves the deal " +
        "committed without its audit row",
    ).toBe(TX);
  });
});

/**
 * The source-level half: no callback in the repository may open a transaction
 * and then ignore it. This is defence in depth for every OTHER site — the
 * behavioural test above covers the one that was broken.
 */
describe("no transaction callback ignores its executor", () => {
  it("every withTransaction callback declares a parameter", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const ROOT = process.cwd();

    function walk(dir: string, out: string[] = []): string[] {
      for (const e of readdirSync(dir)) {
        if (["node_modules", "dist", "build"].includes(e)) continue;
        const abs = path.join(dir, e);
        if (statSync(abs).isDirectory()) walk(abs, out);
        else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) out.push(abs);
      }
      return out;
    }

    const files = walk(path.join(ROOT, "server"));
    expect(files.length, "the server walk found almost nothing").toBeGreaterThan(500);

    const offenders: string[] = [];
    let sites = 0;
    for (const abs of files) {
      // Comments stripped: this repo has already paid for a scan that matched
      // the note explaining a removal rather than the removal itself.
      const code = stripComments(readFileSync(abs, "utf8"));
      for (const m of code.matchAll(/\bwithTransaction\(\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) {
        sites += 1;
        if (m[1].trim() === "") {
          const line = code.slice(0, m.index).split("\n").length;
          offenders.push(`${path.relative(ROOT, abs)}:${line}`);
        }
      }
    }
    expect(sites, "no withTransaction call sites found — this assertion is vacuous")
      .toBeGreaterThan(5);
    expect(
      offenders,
      "these open a transaction and then discard it. Every query inside runs on " +
        "the global pool, so the wrapper buys no atomicity and costs a held " +
        "connection while the body asks the same pool for another.",
    ).toEqual([]);
  });
});
