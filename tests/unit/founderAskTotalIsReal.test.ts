/**
 * DEFECT-0129 — the founder's "waiting on you" count is a real total.
 *
 * GET /api/founder/asks returned `count: rows.length` AFTER `.slice(0, limit)`,
 * and the mobile Decisions badge asked with limit=1 — so any backlog showed as
 * "1". The route now returns `total` (every ask in the status) beside the page
 * `count`, and the badge reads `total` and shows "?" when a read fails.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireFounder: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/solene/founderCollab", () => ({
  listOpenAsks: vi.fn(async () => Array.from({ length: 200 }, (_, i) => ({ id: i }))),
  answerFounderAsk: vi.fn(),
  supersedeAsk: vi.fn(),
  getAsk: vi.fn(),
}));

import { registerFounderCollabRoutes } from "../../server/routes-founder-collab";

describe("DEFECT-0129 — open-ask total", () => {
  it("limit=1 still reports the whole backlog as total", async () => {
    const app = express();
    registerFounderCollabRoutes(app);
    const res = await request(app).get("/api/founder/asks?status=open&limit=1");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.total).toBe(200);
  });

  it("the mobile badge reads total and never renders a failed read as zero", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/components/mobile/FounderMobileBottomNav.tsx"), "utf8");
    // The badge reads the Letter's own union through /api/founder/needs-you
    // (DEFECT-0145), and a partial read (total null) is still "?" not 0.
    expect(src).toMatch(/\/api\/founder\/needs-you/);
    expect(src).toMatch(/body\?\.total/);
    expect(src).not.toMatch(/\/api\/founder\/asks\?status=open&limit=1/);
    expect(src).toMatch(/needsYouCount === null \? "\?"/);
  });
});
