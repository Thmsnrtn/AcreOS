/**
 * Audits of e3debe0 and 224a5c0 — a deal status transition's evidence
 * (entering offer_sent = an offer made; leaving closed = the recorded sale
 * retracted) was recorded by one route, then by seven route-level emitters,
 * while the undo, the bulk endpoint, workflows, the agent, voice-call CRM
 * updates, title closing and soft deletes wrote `deals.status` without it.
 *
 * The evidence now lives where the status is written: the deal repository.
 * The population is every write to the deals table in server/ — Drizzle
 * `.update(…)`/`.delete(…)` by any alias or namespace import, and raw
 * `UPDATE deals` / `DELETE FROM deals` SQL — enumerated from the source:
 * outside server/storage/ there must be none, and every repository method
 * that writes the table must record the evidence. A new raw writer is the
 * thing that fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const H = vi.hoisted(() => ({
  activation: [] as Array<Record<string, unknown>>,
  retracted: [] as Array<[number, string]>,
  before: null as null | { status: string; propertyId: number | null },
  after: null as null | Record<string, unknown>,
  /** Set once the UPDATE has run: later reads see the committed row (`after`). */
  committed: false,
  commissionRetracted: [] as unknown[][],
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: {
    dealDiscovered: async () => undefined,
    dealClosed: async () => undefined,
    dealUpdated: async () => undefined,
  },
}));
vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: (a: Record<string, unknown>) => void H.activation.push(a),
}));
vi.mock("../../server/services/acreOSValuation", () => ({
  acreOSValuation: { retractTrainingTransaction: async (o: number, k: string) => void H.retracted.push([o, k]) },
}));
vi.mock("../../server/services/marketNetworkContributor", () => ({
  closedSaleDealKey: (o: number, d: number) => `key-${o}-${d}`,
}));
vi.mock("../../server/services/commissionService", () => ({
  retractDealCommission: async (...a: unknown[]) => (H.commissionRetracted.push(a), { removed: 1, flagged: 0 }),
}));
vi.mock("../../server/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "set", "returning"]) c[m] = () => c;
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows()).then(f, r);
    return c;
  };
  const db = {
    // The reopen retraction re-reads the deal's CURRENT status under its lock
    // (W10.4 audit finding 5), so a read after the write sees the write.
    select: () => chain(() => (H.committed && H.after ? [H.after] : H.before ? [H.before] : [])),
    update: () => chain(() => ((H.committed = true), H.after ? [H.after] : [])),
    // The reopen retraction runs under the per-deal training lock
    // (dealClose.withDealTrainingLock, W10.4): a transaction + advisory lock.
    execute: async () => [],
  };
  return { db, withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) };
});

const ROOT = path.resolve(__dirname, "../..");
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
 * Names the `deals` table is bound to in a file: a named import from the
 * shared schema (`deals`, `deals as dealsTable`), by any specifier that
 * reaches it (`@shared/schema`, a relative `shared/schema` path), or a
 * namespace import (`import * as schema` → `schema.deals`).
 */
function dealsAliases(src: string): string[] {
  const names = new Set<string>();
  const fromSchema = String.raw`from\s*["'](?:@shared\/schema|[./]*shared\/schema)[^"']*["']`;
  for (const m of src.matchAll(new RegExp(String.raw`import\s*\{([^}]*)\}\s*` + fromSchema, "g"))) {
    for (const part of m[1].split(",")) {
      const t = part.trim().replace(/^type\s+/, "");
      const a = t.match(/^deals(?:\s+as\s+(\w+))?$/);
      if (a) names.add(a[1] ?? "deals");
    }
  }
  for (const m of src.matchAll(new RegExp(String.raw`import\s*\*\s*as\s+(\w+)\s*` + fromSchema, "g"))) {
    names.add(`${m[1]}\\.deals`);
  }
  return [...names];
}
/** Every write to the deals table: Drizzle update/delete by any alias, and raw SQL. */
function dealsUpdates(src: string): number[] {
  const at: number[] = [];
  for (const name of dealsAliases(src)) {
    for (const m of src.matchAll(new RegExp(String.raw`\.(?:update|delete)\(\s*${name}\s*\)`, "g"))) at.push(m.index ?? 0);
  }
  // Raw SQL in a `sql` tagged template: DELETE FROM deals, or an UPDATE deals
  // whose SET names status (paxLearning's `UPDATE deals SET property_id` is
  // not a status write). Anchored on the tag, so text between two unrelated
  // templates is never read as one statement.
  for (const m of src.matchAll(/\bsql`([^`]*)`/g)) {
    const body = m[1];
    if (/\bdelete\s+from\s+"?deals"?\b/i.test(body) || (/\bupdate\s+"?deals"?\s/i.test(body) && /\bstatus\b/i.test(body))) {
      at.push(m.index ?? 0);
    }
  }
  return at;
}

beforeEach(() => {
  H.activation = [];
  H.retracted = [];
  H.before = null;
  H.after = null;
  H.committed = false;
  H.commissionRetracted = [];
});

describe("every deal status write passes the repository, which records the evidence", () => {
  it("no file outside server/storage/ writes the deals table directly", () => {
    const offenders: string[] = [];
    for (const abs of serverFiles()) {
      if (abs.includes(`${path.sep}server${path.sep}storage${path.sep}`)) continue;
      const src = stripComments(fs.readFileSync(abs, "utf8"));
      if (dealsUpdates(src).length > 0) offenders.push(path.relative(ROOT, abs));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every repository method that writes the deals table records the transition's evidence", () => {
    let sites = 0;
    const missing: string[] = [];
    for (const abs of serverFiles()) {
      if (!abs.includes(`${path.sep}server${path.sep}storage${path.sep}`)) continue;
      const src = stripComments(fs.readFileSync(abs, "utf8"));
      const methodStarts = [...src.matchAll(/async\s+(\w+)\s*\(\s*this:\s*DatabaseStorage/g)].map((m) => ({ at: m.index ?? 0, name: m[1] }));
      for (const at of dealsUpdates(src)) {
        sites++;
        const method = methodStarts.filter((m) => m.at < at).at(-1);
        if (!method) {
          missing.push(`${path.relative(ROOT, abs)}: a deals write outside any repository method`);
          continue;
        }
        const next = methodStarts.find((m) => m.at > method.at)?.at ?? src.length;
        const body = src.slice(method.at, next);
        if (!/recordDealTransitionEvidence\(/.test(body)) missing.push(`${path.relative(ROOT, abs)}: ${method.name}`);
      }
    }
    // Vacuity: updateDeal, bulkUpdateDeals, bulkDeleteDeals, deleteProperty,
    // bulkDeleteProperties, purgeOldDeals (a hard delete — audit of 7cc7345).
    expect(sites).toBeGreaterThanOrEqual(6);
    expect(missing, missing.join("\n")).toEqual([]);
  });
});

describe("the repository records the evidence on a real transition", () => {
  it("updateDeal from closed retracts the recorded sale; into offer_sent records the offer", async () => {
    const { dealRepo } = await import("../../server/storage/dealRepo");
    H.before = { status: "closed", propertyId: 3 };
    H.after = { id: 9, organizationId: 5, status: "negotiating", propertyId: 3 };
    // `closed` is terminal; the one path that reopens a deal is the bulk
    // undo's backward move (audit of 9ed61f4).
    await dealRepo.updateDeal.call({} as never, 9, { status: "negotiating" }, undefined, 5, { backwardUndo: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(H.retracted).toEqual([[5, "deal:key-5-9"]]);
    // …and its commission (an unpaid one removed, a paid one flagged — W10.4 audit finding 2).
    expect(H.commissionRetracted).toEqual([[5, 9, "Deal left closed (now negotiating)"]]);

    H.committed = false;
    H.before = { status: "negotiating", propertyId: 3 };
    H.after = { id: 9, organizationId: 5, status: "offer_sent", offerAmount: "12000", propertyId: 3 };
    await dealRepo.updateDeal.call({} as never, 9, { status: "offer_sent" }, undefined, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(H.activation).toEqual([expect.objectContaining({ orgId: 5, eventName: "first_offer_made", eventValue: { dealId: 9, offerAmount: "12000" } })]);
  });

  it("the repository refuses a move the state machine forbids — every writer passes here (audit of 9ed61f4)", async () => {
    const { dealRepo, DealTransitionRefusedError } = await import("../../server/storage/dealRepo");
    H.before = { status: "closed", propertyId: 3 };
    H.after = { id: 9, organizationId: 5, status: "negotiating", propertyId: 3 };
    await expect(dealRepo.updateDeal.call({} as never, 9, { status: "negotiating" }, undefined, 5)).rejects.toBeInstanceOf(
      DealTransitionRefusedError,
    );
    H.before = { status: "deleted", propertyId: 3 };
    await expect(dealRepo.updateDeal.call({} as never, 9, { status: "closed" }, undefined, 5)).rejects.toThrow(/deleted deal/);
    // Not even the undo moves a deleted deal, or to a word that is not a stage.
    await expect(dealRepo.updateDeal.call({} as never, 9, { status: "negotiating" }, undefined, 5, { backwardUndo: true })).rejects.toThrow(/deleted deal/);
    H.before = { status: "offer_sent", propertyId: 3 };
    await expect(dealRepo.updateDeal.call({} as never, 9, { status: "closing" }, undefined, 5, { backwardUndo: true })).rejects.toThrow(/not a valid deal status/);
    expect(H.retracted).toEqual([]);
  });

  it("bulkUpdateDeals refuses the whole batch when one move is illegal", async () => {
    const { dealRepo, DealTransitionRefusedError } = await import("../../server/storage/dealRepo");
    H.before = { id: 9, status: "closed" } as never;
    await expect(dealRepo.bulkUpdateDeals.call({} as never, 5, [9], { status: "offer_sent" })).rejects.toBeInstanceOf(
      DealTransitionRefusedError,
    );
  });

  it("a write that does not move the status records nothing", async () => {
    const { dealRepo } = await import("../../server/storage/dealRepo");
    H.before = { status: "closed", propertyId: 3 };
    H.after = { id: 9, organizationId: 5, status: "closed", propertyId: 3 };
    await dealRepo.updateDeal.call({} as never, 9, { notes: "x" }, undefined, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(H.retracted).toEqual([]);
    expect(H.activation).toEqual([]);
  });
});
