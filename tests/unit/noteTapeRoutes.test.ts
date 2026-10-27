/**
 * V-Notes-1 N1 — the note-tape routes over HTTP (the real router, real
 * validator; the commit service is the seam).
 *
 *   - preview suggests a mapping, validates, and WRITES NOTHING (commit is
 *     never reached);
 *   - commit re-validates server-side and takes the organization from the
 *     SESSION — an organizationId in the body is ignored;
 *   - a refused commit is a 400 carrying the field report / unresolved rows;
 *   - the canImportData gate stands in front of both.
 */
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: { id: 41 },
  user: { id: "u-41" },
  permit: true,
  commit: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = h.user;
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = h.org;
    req.organizationId = h.org.id;
    next();
  },
}));
vi.mock("../../server/utils/permissions", () => ({
  requirePermission: (perm: string) => (_req: any, res: any, next: any) =>
    h.permit && perm === "canImportData" ? next() : res.status(403).json({ error: "FORBIDDEN", message: "no", statusCode: 403 }),
}));
vi.mock("../../server/services/notes/noteTapeCommit", () => ({ commitNoteTape: (...a: unknown[]) => h.commit(...a) }));

import { registerNoteTapeRoutes } from "../../server/routes-note-tape";

const csv = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
function app() {
  const a = express();
  a.use(express.json({ limit: "6mb" }));
  registerNoteTapeRoutes(a);
  return a;
}

beforeEach(() => {
  h.permit = true;
  h.commit.mockReset();
});

describe("POST /api/note-tape/preview", () => {
  it("suggests a mapping, reports every row, and writes nothing", async () => {
    const res = await request(app()).post("/api/note-tape/preview").send({ csv, fileName: "golden.csv" });
    expect(res.status).toBe(200);
    expect(res.body.mappingWasSuggested).toBe(true);
    expect(res.body.validation.summary).toEqual({ totalRows: 5, validCount: 3, rejectedCount: 2, documentsIncomplete: 1 });
    expect(res.body.validation.rejected[0]).toMatchObject({ fileRow: 4, errors: [expect.objectContaining({ field: "interestRate", fix: expect.any(String) })] });
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("an unreadable file is a 400 with the reason, not a 500", async () => {
    const res = await request(app()).post("/api/note-tape/preview").send({ csv: "Loan #\n", fileName: "x.csv" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no lot rows|header row but no/);
  });
});

describe("POST /api/note-tape/commit", () => {
  it("takes the organization and actor from the session — never from the body", async () => {
    h.commit.mockResolvedValue({ status: "committed", importId: "i", created: 3, appendedToExisting: 0, excludedRows: [4, 5], notes: [] });
    const preview = await request(app()).post("/api/note-tape/preview").send({ csv, fileName: "golden.csv" });
    const res = await request(app())
      .post("/api/note-tape/commit")
      .send({ csv, fileName: "golden.csv", mapping: preview.body.mapping, excludeRows: [4, 5], organizationId: 999, actorUserId: "someone-else" });
    expect(res.status).toBe(200);
    expect(h.commit).toHaveBeenCalledTimes(1);
    const arg = h.commit.mock.calls[0][0];
    expect(arg).toMatchObject({ organizationId: 41, actorUserId: "u-41", fileName: "golden.csv", excludeRows: [4, 5], asOf: null });
    // Server-side re-validation, not the client's preview.
    expect(arg.validation.summary.validCount).toBe(3);
  });

  it("a refusal is a 400 carrying the unmapped fields", async () => {
    h.commit.mockResolvedValue({ status: "refused", reason: "Map every required column before importing.", unmappedRequired: [{ field: "interestRate", label: "Interest rate (%)", fix: "map it" }] });
    const res = await request(app()).post("/api/note-tape/commit").send({ csv, fileName: "golden.csv", mapping: {} });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Map every required column/);
    expect(res.body.details.unmappedRequired[0].field).toBe("interestRate");
  });

  it("without canImportData both routes are refused before anything runs", async () => {
    h.permit = false;
    expect((await request(app()).post("/api/note-tape/preview").send({ csv, fileName: "g.csv" })).status).toBe(403);
    expect((await request(app()).post("/api/note-tape/commit").send({ csv, fileName: "g.csv", mapping: {} })).status).toBe(403);
    expect(h.commit).not.toHaveBeenCalled();
  });
});
