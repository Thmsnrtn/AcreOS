/**
 * DEFECT-0118 — the synchronous 1099-INT batch response carries the files the
 * tax-readiness page renders.
 *
 * `/notes/tax-readiness` builds its download lines from `recipientPdfs`,
 * `transmittalPdfBase64` and `fireFile`. `POST /api/accounting/1099-batch`
 * returned counts only, so a successful batch showed "Batch generated — N
 * forms" with nothing to download, and the recipient PDFs — which the job
 * row does not store — were built and thrown away.
 *
 * The refusal middleware is stubbed open here: this pins the RESPONSE SHAPE
 * for the day the direction review lands. The refusal itself is pinned in
 * bookkeeping1099.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/form1099Refusal", () => ({
  requireQualified1099Output: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  QUALIFIED_1099_PAYLOAD_MARK: "tax.1099int.direction_reviewed",
}));
vi.mock("../../server/services/form1099Batch", () => ({
  generate1099Batch: vi.fn(async () => ({
    jobId: "job-1",
    status: "success",
    formCount: 1,
    totalInterestCents: 12_345,
    fireFileBytes: 750,
    fireRecordCounts: { T: 1, A: 1, B: 1, C: 1, F: 1 },
    recipientPdfs: [{ recipientName: "Bea Rowe", noteId: 77, pdfBase64: "JVBERi0x", box1Cents: 12_345 }],
    transmittalPdfBase64: "JVBERi0y",
    fireFile: "T2025...",
  })),
  getForm1099BatchStatus: vi.fn(async () => null),
}));

const { default: accountingRouter } = await import("../../server/routes-accounting");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    Object.assign(req, {
      organization: { id: 5, name: "Cedar Ridge Land Holdings LLC" },
      organizationId: 5,
      isFounder: false,
      permissionContext: { role: "owner" },
    });
    next();
  });
  a.use("/api/accounting", accountingRouter);
  return a;
}

describe("DEFECT-0118 — POST /api/accounting/1099-batch returns what the page downloads", () => {
  it("carries recipient PDFs, the 1096 transmittal and the FIRE text", async () => {
    const res = await request(app()).post("/api/accounting/1099-batch?taxYear=2025");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.recipientPdfs).toEqual([
      { recipientName: "Bea Rowe", noteId: 77, pdfBase64: "JVBERi0x", box1Cents: 12_345 },
    ]);
    expect(res.body.transmittalPdfBase64).toBe("JVBERi0y");
    expect(res.body.fireFile).toBe("T2025...");
  });
});
