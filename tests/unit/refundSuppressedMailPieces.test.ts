/**
 * DEFECT-0277 — the founder-run repayment of suppressed-mail-piece refunds
 * skipped before DEFECT-0271 (scripts/data/refund-suppressed-mail-pieces.ts).
 *
 * Pins: the selection (which shipments are owed, how much, from which purse,
 * and why every other one is skipped); dry run changes nothing; --apply
 * exports before it refunds; a re-run refunds nothing twice; the key and share
 * are the flusher's own; and nothing in the product calls the script.
 *
 * The database is a stateful fake whose answers are COMPUTED from its tables
 * (the selection's WHERE and the refund's ON CONFLICT are evaluated, not
 * returned as fixed rows), so a re-run sees what the first run wrote.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Queryable } from "../../scripts/data/_client";
import {
  planSuppressedRefunds,
  refundSuppressedMailPieces,
  suppressedRefundKey,
  suppressedShareCents,
  SELECT_SUPPRESSED_SHIPMENTS,
  type RefundFn,
  type SuppressedShipmentRow,
} from "../../scripts/data/refund-suppressed-mail-pieces";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const NOW = new Date("2026-10-06T12:00:00.000Z");
const THIS_MONTH = new Date("2026-10-02T00:00:00.000Z");
const LAST_MONTH = new Date("2026-09-12T00:00:00.000Z");

const row = (o: Partial<SuppressedShipmentRow>): SuppressedShipmentRow => ({
  shipment_id: 1,
  organization_id: 7,
  status: "sent",
  debit_event_key: "mail:7:op-1",
  debited_cents: 1000,
  piece_count: 4,
  suppressed_pieces: 1,
  original_cents: -1000,
  original_posted_by: "system:credit-pool",
  original_posted_at: THIS_MONTH,
  refund_exists: false,
  refunded_so_far_cents: 0,
  ...o,
});

describe("the plan — which shipments are owed, and why the rest are not", () => {
  it("refunds the suppressed share, floored exactly as the flusher does", () => {
    const { planned } = planSuppressedRefunds([row({ debited_cents: 1000, piece_count: 3, suppressed_pieces: 1, original_cents: -1000 })], NOW);
    expect(planned).toEqual([
      expect.objectContaining({ shipmentId: 1, refundKey: "mail:7:op-1:suppressed:refund", shareCents: 333, expectedCents: 333 }),
    ]);
  });

  it("skips each non-owed shape with its own reason", () => {
    const { planned, skipped } = planSuppressedRefunds(
      [
        row({ shipment_id: 1, refund_exists: true }),
        row({ shipment_id: 2, debit_event_key: null }),
        row({ shipment_id: 3, debited_cents: 0 }),
        row({ shipment_id: 4, original_cents: null }),
        row({ shipment_id: 5, original_cents: -1000, refunded_so_far_cents: 1000 }),
      ],
      NOW,
    );
    expect(planned).toEqual([]);
    expect(skipped.map((s) => [s.shipmentId, s.reason])).toEqual([
      [1, "already_refunded"],
      [2, "no_debit_key"],
      [3, "zero_share"],
      [4, "original_debit_missing"],
      [5, "nothing_left_to_refund"],
    ]);
  });

  it("caps at what is left of the debit after its earlier refunds", () => {
    const { planned } = planSuppressedRefunds(
      [row({ debited_cents: 1000, piece_count: 2, suppressed_pieces: 1, original_cents: "-1000", refunded_so_far_cents: "800" })],
      NOW,
    );
    expect(planned[0]).toMatchObject({ shareCents: 500, expectedCents: 200 });
  });

  it("says which purse each refund reaches — and that a closed month's pool refund is a record only", () => {
    const { planned } = planSuppressedRefunds(
      [
        row({ shipment_id: 1, original_posted_by: "system:credit-pool:purchased-overflow", original_posted_at: LAST_MONTH }),
        row({ shipment_id: 2, original_posted_at: THIS_MONTH }),
        row({ shipment_id: 3, original_posted_at: LAST_MONTH }),
      ],
      NOW,
    );
    expect(planned.map((p) => [p.shipmentId, p.purse])).toEqual([
      [1, "purchased_credits_returned"],
      [2, "pool_netted_this_month"],
      [3, "pool_prior_month_record_only"],
    ]);
  });
});

// ── A stateful fake: tables in memory, queries evaluated against them ──────
interface Shipment { id: number; organization_id: number; status: string; debit_event_key: string | null; debited_cents: number | null; piece_count: number }
interface Piece { shipment_id: number; organization_id: number; status: string }
interface Ledger { organization_id: number; external_event_id: string; amount_cents: number; posted_by: string; posted_at: Date }

function fakeDb(state: { shipments: Shipment[]; pieces: Piece[]; ledger: Ledger[] }) {
  const calls: string[] = [];
  const client: Queryable = {
    async query<T>(sql: string, params?: unknown[]) {
      calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      if (sql === SELECT_SUPPRESSED_SHIPMENTS) {
        const out: SuppressedShipmentRow[] = [];
        for (const s of state.shipments) {
          const suppressed = state.pieces.filter(
            (p) => p.shipment_id === s.id && p.organization_id === s.organization_id && p.status === "suppressed",
          ).length;
          if (suppressed === 0) continue;
          const original = s.debit_event_key
            ? state.ledger.find((l) => l.external_event_id === s.debit_event_key && l.organization_id === s.organization_id)
            : undefined;
          const key = s.debit_event_key;
          out.push({
            shipment_id: s.id,
            organization_id: s.organization_id,
            status: s.status,
            debit_event_key: key,
            debited_cents: s.debited_cents,
            piece_count: s.piece_count,
            suppressed_pieces: suppressed,
            original_cents: original?.amount_cents ?? null,
            original_posted_by: original?.posted_by ?? null,
            original_posted_at: original?.posted_at ?? null,
            refund_exists: key != null && state.ledger.some((l) => l.external_event_id === `${key}:suppressed:refund`),
            refunded_so_far_cents: key == null ? 0 : state.ledger
              .filter((l) => l.organization_id === s.organization_id && l.posted_by === "system:credit-pool:refund" && l.external_event_id.startsWith(`${key}:`))
              .reduce((n, l) => n + Math.abs(l.amount_cents), 0),
          });
        }
        return { rows: out as T[] };
      }
      if (/FROM organizations/.test(sql)) {
        const ids = (params?.[0] ?? []) as number[];
        return { rows: ids.map((id) => ({ id, credit_balance: "0" })) as T[] };
      }
      if (/FROM financial_ledger WHERE external_event_id = \$1 AND organization_id = \$2/.test(sql)) {
        const [key, org] = params as [string, number];
        return { rows: state.ledger.filter((l) => l.external_event_id === key && l.organization_id === org) as T[] };
      }
      if (/^(BEGIN|ROLLBACK|COMMIT)/.test(sql.trim())) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  // refundPoolDebit's contract: the original must exist in the org; capped at
  // what is left after earlier refunds (excluding its own key); ON CONFLICT
  // (external_event_id) DO NOTHING.
  const refundCalls: Parameters<RefundFn>[0][] = [];
  const refund: RefundFn = async (args) => {
    refundCalls.push(args);
    const original = state.ledger.find((l) => l.external_event_id === args.originalEventId && l.organization_id === args.organizationId);
    if (!original) return;
    const prior = state.ledger
      .filter((l) => l.organization_id === args.organizationId && l.posted_by === "system:credit-pool:refund"
        && l.external_event_id.startsWith(`${args.originalEventId}:`) && l.external_event_id !== args.refundKey)
      .reduce((n, l) => n + Math.abs(l.amount_cents), 0);
    const cents = Math.min(args.amountCents, Math.max(0, Math.abs(original.amount_cents) - prior));
    if (cents <= 0) return;
    if (state.ledger.some((l) => l.external_event_id === args.refundKey)) return;
    state.ledger.push({ organization_id: args.organizationId, external_event_id: args.refundKey, amount_cents: cents, posted_by: "system:credit-pool:refund", posted_at: NOW });
  };
  return { client, calls, refund, refundCalls };
}

function world() {
  return {
    shipments: [
      { id: 10, organization_id: 7, status: "sent", debit_event_key: "mail:7:a", debited_cents: 400, piece_count: 4 },
      { id: 11, organization_id: 8, status: "cancelled", debit_event_key: "mail:8:b", debited_cents: 300, piece_count: 3 },
      // Already repaid by the post-0271 flusher.
      { id: 12, organization_id: 7, status: "sent", debit_event_key: "mail:7:c", debited_cents: 200, piece_count: 2 },
      // No suppressed piece: not in the population at all.
      { id: 13, organization_id: 7, status: "sent", debit_event_key: "mail:7:d", debited_cents: 200, piece_count: 2 },
    ],
    pieces: [
      { shipment_id: 10, organization_id: 7, status: "suppressed" },
      { shipment_id: 10, organization_id: 7, status: "sent" },
      { shipment_id: 10, organization_id: 7, status: "sent" },
      { shipment_id: 10, organization_id: 7, status: "sent" },
      { shipment_id: 11, organization_id: 8, status: "suppressed" },
      { shipment_id: 11, organization_id: 8, status: "suppressed" },
      { shipment_id: 11, organization_id: 8, status: "suppressed" },
      { shipment_id: 12, organization_id: 7, status: "suppressed" },
      { shipment_id: 12, organization_id: 7, status: "sent" },
      { shipment_id: 13, organization_id: 7, status: "sent" },
    ],
    ledger: [
      { organization_id: 7, external_event_id: "mail:7:a", amount_cents: -400, posted_by: "system:credit-pool", posted_at: THIS_MONTH },
      { organization_id: 8, external_event_id: "mail:8:b", amount_cents: -300, posted_by: "system:credit-pool:purchased-overflow", posted_at: LAST_MONTH },
      { organization_id: 7, external_event_id: "mail:7:c", amount_cents: -200, posted_by: "system:credit-pool", posted_at: THIS_MONTH },
      { organization_id: 7, external_event_id: "mail:7:c:suppressed:refund", amount_cents: 100, posted_by: "system:credit-pool:refund", posted_at: THIS_MONTH },
      { organization_id: 7, external_event_id: "mail:7:d", amount_cents: -200, posted_by: "system:credit-pool", posted_at: THIS_MONTH },
    ] as Ledger[],
  };
}

describe("running the script", () => {
  it("a dry run reads in a READ ONLY transaction, refunds nothing, exports nothing", async () => {
    const state = world();
    const f = fakeDb(state);
    const outDir = join(mkdtempSync(join(tmpdir(), "sup-")), "out");
    const r = await refundSuppressedMailPieces(f.client, { apply: false, outDir, now: NOW, refund: f.refund });
    expect(f.calls[0]).toBe("BEGIN READ");
    expect(f.refundCalls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
    expect(r.planned.map((p) => [p.shipmentId, p.expectedCents])).toEqual([[10, 100], [11, 300]]);
    expect(r.skipped).toEqual([{ shipmentId: 12, organizationId: 7, reason: "already_refunded" }]);
    expect(state.ledger).toHaveLength(5);
  });

  it("--apply exports the plan first, refunds each share under the flusher's key, and reads the outcome back", async () => {
    const state = world();
    const f = fakeDb(state);
    const outDir = join(mkdtempSync(join(tmpdir(), "sup-")), "out");
    const r = await refundSuppressedMailPieces(f.client, { apply: true, outDir, now: NOW, refund: f.refund });
    const exported = JSON.parse(readFileSync(r.exportPath!, "utf8")) as Array<{ refundKey: string }>;
    expect(exported.map((e) => e.refundKey)).toEqual(["mail:7:a:suppressed:refund", "mail:8:b:suppressed:refund"]);
    expect(existsSync(r.balancesExportPath!)).toBe(true);
    expect(f.refundCalls.map((c) => [c.organizationId, c.originalEventId, c.refundKey, c.amountCents])).toEqual([
      [7, "mail:7:a", "mail:7:a:suppressed:refund", 100],
      [8, "mail:8:b", "mail:8:b:suppressed:refund", 300],
    ]);
    expect(r.outcomes).toEqual([
      { shipmentId: 10, refundKey: "mail:7:a:suppressed:refund", expectedCents: 100, postedCents: 100 },
      { shipmentId: 11, refundKey: "mail:8:b:suppressed:refund", expectedCents: 300, postedCents: 300 },
    ]);
  });

  it("a re-run refunds nothing twice", async () => {
    const state = world();
    const f = fakeDb(state);
    const dir = mkdtempSync(join(tmpdir(), "sup-"));
    await refundSuppressedMailPieces(f.client, { apply: true, outDir: join(dir, "1"), now: NOW, refund: f.refund });
    const ledgerAfterFirst = state.ledger.length;
    const second = await refundSuppressedMailPieces(f.client, { apply: true, outDir: join(dir, "2"), now: NOW, refund: f.refund });
    expect(second.planned).toEqual([]);
    expect(second.applied).toBe(false);
    expect(f.refundCalls).toHaveLength(2);
    expect(state.ledger).toHaveLength(ledgerAfterFirst);
    expect(second.skipped.map((s) => s.reason)).toEqual(["already_refunded", "already_refunded", "already_refunded"]);
  });

  it("reports a refund the ledger does not show, instead of assuming it", async () => {
    const state = world();
    const f = fakeDb(state);
    const swallowing: RefundFn = async () => {}; // refundPoolDebit logs and swallows its errors
    const r = await refundSuppressedMailPieces(f.client, {
      apply: true,
      outDir: join(mkdtempSync(join(tmpdir(), "sup-")), "out"),
      now: NOW,
      refund: swallowing,
    });
    expect(r.outcomes.map((o) => o.postedCents)).toEqual([null, null]);
  });

  it("--apply without a refund function refuses", async () => {
    const f = fakeDb(world());
    await expect(
      refundSuppressedMailPieces(f.client, { apply: true, outDir: join(mkdtempSync(join(tmpdir(), "sup-")), "out"), now: NOW }),
    ).rejects.toThrow(/refund function/);
  });
});

describe("the script is the flusher's refund, run late — and only by the founder", () => {
  const flusher = stripComments(readFileSync("server/services/mail/mailFlusher.ts", "utf8"));

  it("uses the flusher's refund key", () => {
    expect(flusher).toContain("refundKey: `${ship.debitEventKey}:suppressed:refund`");
    expect(suppressedRefundKey("mail:7:a")).toBe("mail:7:a:suppressed:refund");
  });

  it("computes the share with the flusher's arithmetic (debitShareCents, body for body)", () => {
    const body = (src: string, sig: RegExp) => {
      const m = sig.exec(src);
      expect(m).not.toBeNull();
      const start = src.indexOf("{", m!.index + m![0].length - 1);
      const end = src.indexOf("\n}\n", start);
      return src.slice(start, end).replace(/ship\./g, "").replace(/\s+/g, " ");
    };
    const script = stripComments(readFileSync("scripts/data/refund-suppressed-mail-pieces.ts", "utf8"));
    expect(body(script, /export function suppressedShareCents\([^)]*\): number \{/)).toBe(
      body(flusher, /function debitShareCents\([^)]*\): number \{/),
    );
    expect(suppressedShareCents(1000, 3, 1)).toBe(333);
  });

  it("nothing in the product imports or calls it", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(name) && /refund-suppressed-mail-pieces/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    for (const d of ["server", "client/src", "shared"]) walk(d);
    expect(hits).toEqual([]);
  });
});
