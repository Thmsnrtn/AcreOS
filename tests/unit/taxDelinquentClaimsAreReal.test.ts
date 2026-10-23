/**
 * P1 false-claims sweep — /tax-delinquent claims only what happens.
 *
 * Two defects:
 *   - "Import records" POSTed /api/tax-delinquent/import, whose service was a
 *     no-op returning `imported: 0` (pointing at a non-existent path), and the
 *     page toasted "Import started. Records will appear as the import
 *     completes." — nothing would ever appear.
 *   - "Contact" set the lead's status to "contacted" (a status claiming a
 *     contact that never happened) and toasted "Lead added to outreach
 *     sequence." — there is no sequence.
 *
 * This drives the REAL router: import refuses (non-2xx, imported 0), contact
 * refuses and writes nothing to the lead. The page must route import to the
 * real CSV importer and claim no sequence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const { update } = vi.hoisted(() => ({
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
}));
vi.mock("../../server/db", () => ({
  db: {
    update,
    insert: vi.fn(),
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 9, tcpaConsent: false }] }) }) })),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import taxDelinquentRouter from "../../server/routes-tax-delinquent";
import { taxDelinquentPipeline } from "../../server/services/taxDelinquentPipeline";

const ROOT = path.resolve(__dirname, "../..");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { organization: { id: number } }).organization = { id: 7 };
    next();
  });
  a.use("/api/tax-delinquent", taxDelinquentRouter);
  return a;
}

describe("/api/tax-delinquent refuses what it cannot do", () => {
  beforeEach(() => update.mockClear());

  it("import is refused, not reported as started, while no county scraper exists", async () => {
    const res = await request(app()).post("/api/tax-delinquent/import").send({ stateCode: "TX" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/not available/i);
    expect(JSON.stringify(res.body)).toContain("/api/leads/import/tax-delinquent");
    expect(JSON.stringify(res.body)).not.toContain("/api/import/tax-delinquent");
  });

  it("contact is refused and never marks the lead contacted", async () => {
    const res = await request(app()).post("/api/tax-delinquent/9/contact").send({});
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/nothing was sent/i);
    expect(update).not.toHaveBeenCalled();
    expect((taxDelinquentPipeline as Record<string, unknown>).addToOutreach).toBeUndefined();
  });
});

describe("the /tax-delinquent page claims no import or sequence that does not exist", () => {
  const page = stripComments(readFileSync(path.join(ROOT, "client/src/pages/tax-delinquent.tsx"), "utf8"));

  it("is read (vacuity)", () => {
    expect(page).toMatch(/Tax-delinquent pipeline/);
  });

  it("imports through the real CSV importer, not the no-op county endpoint", () => {
    expect(page).not.toContain("/api/tax-delinquent/import");
    expect(page).not.toMatch(/Import started/i);
    expect(page).toMatch(/<TaxDelinquentImporter\b/);
  });

  it("claims no outreach sequence and calls no contact endpoint", () => {
    expect(page).not.toMatch(/outreach sequence/i);
    expect(page).not.toMatch(/\/contact[`"']/);
  });
});
