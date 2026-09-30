/**
 * Audits of e3debe0 and 224a5c0 — a deal status transition's evidence
 * (entering offer_sent = an offer made; leaving closed = the recorded sale
 * retracted) was recorded by one route, then by seven route-level emitters,
 * while the undo, the bulk endpoint, workflows, the agent, voice-call CRM
 * updates, title closing and soft deletes wrote `deals.status` without it.
 *
 * The evidence now lives where the status is written: the deal repository.
 * The population is every `.update(<deals table>)` in server/, enumerated
 * from the source (aliases included): outside server/storage/ there must be
 * none, and every repository method that writes the table must record the
 * evidence. A new raw writer is the thing that fails.
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
vi.mock("../../server/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "set", "returning"]) c[m] = () => c;
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows()).then(f, r);
    return c;
  };
  return {
    db: {
      select: () => chain(() => (H.before ? [H.before] : [])),
      update: () => chain(() => (H.after ? [H.after] : [])),
    },
  };
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

/** Names the `deals` table is bound to in a file (`deals`, `deals as dealsTable`). */
function dealsAliases(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@shared\/schema[^"']*["']/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim().replace(/^type\s+/, "");
      const a = t.match(/^deals(?:\s+as\s+(\w+))?$/);
      if (a) names.add(a[1] ?? "deals");
    }
  }
  return [...names];
}
function dealsUpdates(src: string): number[] {
  const at: number[] = [];
  for (const name of dealsAliases(src)) {
    for (const m of src.matchAll(new RegExp(String.raw`\.update\(\s*${name}\s*\)`, "g"))) at.push(m.index ?? 0);
  }
  return at;
}

beforeEach(() => {
  H.activation = [];
  H.retracted = [];
  H.before = null;
  H.after = null;
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
    // Vacuity: updateDeal, bulkUpdateDeals, bulkDeleteDeals, deleteProperty, bulkDeleteProperties.
    expect(sites).toBeGreaterThanOrEqual(5);
    expect(missing, missing.join("\n")).toEqual([]);
  });
});

describe("the repository records the evidence on a real transition", () => {
  it("updateDeal from closed retracts the recorded sale; into offer_sent records the offer", async () => {
    const { dealRepo } = await import("../../server/storage/dealRepo");
    H.before = { status: "closed", propertyId: 3 };
    H.after = { id: 9, organizationId: 5, status: "negotiating", propertyId: 3 };
    await dealRepo.updateDeal.call({} as never, 9, { status: "negotiating" }, undefined, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(H.retracted).toEqual([[5, "deal:key-5-9"]]);

    H.before = { status: "negotiating", propertyId: 3 };
    H.after = { id: 9, organizationId: 5, status: "offer_sent", offerAmount: "12000", propertyId: 3 };
    await dealRepo.updateDeal.call({} as never, 9, { status: "offer_sent" }, undefined, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(H.activation).toEqual([expect.objectContaining({ orgId: 5, eventName: "first_offer_made", eventValue: { dealId: 9, offerAmount: "12000" } })]);
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
