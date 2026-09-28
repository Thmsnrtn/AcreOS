/**
 * DEFECT-0166 and the DEFECT-0164 audit's quick-capture finding — a response
 * may not attest to something that did not happen.
 *
 *  - The deal-room NDA printed "Signed: <now>" and a random "Verification
 *    Code" for whatever party name the caller supplied, and stored a document
 *    row with an empty fileUrl. The e-sign ruling: AcreOS never attests that a
 *    counterparty signed.
 *  - Quick capture answered `imageAttached: true` even when storing the image
 *    threw.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/documentIntelligence", () => ({
  documentIntelligenceService: {
    uploadDocument: async () => {
      throw new Error("store failed");
    },
    extractText: async () => "",
  },
}));
vi.mock("../../server/storage", () => ({ storage: { createLead: vi.fn() }, db: {} }));

import { registerMicroFeatureRoutes } from "../../server/routes-micro-features";

const app = express();
app.use(express.json({ limit: "2mb" }));
registerMicroFeatureRoutes(app);

describe("quick capture", () => {
  it("says the image is NOT attached when storing it failed (was: always true)", async () => {
    const res = await request(app).post("/api/leads/quick-capture").send({ image: "aGVsbG8=" });
    expect(res.status).toBe(200);
    expect(res.body.imageAttached).toBe(false);
  });
});

describe("DEFECT-0166 — the deal-room NDA is an unsigned draft", () => {
  const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-deal-rooms.ts"), "utf8"));
  const at = src.indexOf("router.post('/:id/nda'");
  const handler = src.slice(at, src.indexOf("router.", at + 10));

  it("the handler was located (vacuity)", () => {
    expect(at).toBeGreaterThan(-1);
    expect(handler).toContain("NON-DISCLOSURE AGREEMENT");
  });

  it("attests no signature, invents no verification code, records no file it does not have", () => {
    expect(handler).not.toMatch(/Signed:\s*\$\{/);
    expect(handler).not.toMatch(/randomBytes/);
    expect(handler).not.toMatch(/insert\(dealRoomDocuments\)/);
    expect(handler).toMatch(/UNSIGNED DRAFT/);
  });
});
