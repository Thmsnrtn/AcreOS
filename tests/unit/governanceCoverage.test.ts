/**
 * F5-lite — /api/founder/governance/coverage.
 *
 * The endpoint is a pure read of the two governance registries
 * (shared/governance/constitution.ts + statuteRegister.ts). These tests assert
 * the payload is DERIVED from the real registries — every id present, every
 * rollup equal to the shared helpers' outputs — never a hardcoded count, so
 * the suite stays true as entries are added or debts shrink. The shrink-only
 * baselines themselves live in constitution.test.ts / statuteRegister.test.ts;
 * this suite pins the REPORT to the registries, not the registries to a number.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import {
  CONSTITUTION,
  unenforcedHardStops,
} from "@shared/governance/constitution";
import {
  STATUTE_REGISTER,
  unreviewed,
} from "@shared/governance/statuteRegister";

// ── Mock infra dependencies BEFORE importing the module under test ──────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { requireFounderSpy } = vi.hoisted(() => ({
  requireFounderSpy: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "founder-1", claims: { sub: "founder-1" } };
    next();
  },
  requireFounder: requireFounderSpy,
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 1, name: "Test Org" };
    req.organizationId = 1;
    next();
  },
}));

// ── Import the module under test ───────────────────────────────────────────

import {
  buildGovernanceCoverageReport,
  registerFounderGovernanceCoverageRoutes,
} from "../../server/routes-founder-governance-coverage";

describe("governance coverage report (F5-lite)", () => {
  let app: ReturnType<typeof express>;

  beforeAll(() => {
    app = express();
    registerFounderGovernanceCoverageRoutes(app);
  });

  describe("GET /api/founder/governance/coverage", () => {
    it("serves the report through the founder gate", async () => {
      requireFounderSpy.mockClear();
      const res = await request(app).get("/api/founder/governance/coverage");
      expect(res.status).toBe(200);
      expect(requireFounderSpy).toHaveBeenCalledTimes(1);
      expect(res.body.constitution.total).toBe(CONSTITUTION.length);
      expect(res.body.statutes.total).toBe(STATUTE_REGISTER.length);
      expect(typeof res.body.asOf).toBe("string");
    });
  });

  describe("constitution side", () => {
    it("contains every CONSTITUTION id, exactly once, with title/category/kind/refs", () => {
      const report = buildGovernanceCoverageReport();
      const byId = new Map(report.constitution.entries.map((e) => [e.id, e]));
      expect(report.constitution.entries).toHaveLength(CONSTITUTION.length);
      expect(byId.size).toBe(CONSTITUTION.length);
      for (const inv of CONSTITUTION) {
        const entry = byId.get(inv.id);
        expect(entry, `missing constitution entry ${inv.id}`).toBeDefined();
        expect(entry!.title).toBe(inv.title);
        expect(entry!.category).toBe(inv.category);
        expect(entry!.kind).toBe(inv.enforcement.kind);
        expect(entry!.refs).toEqual(inv.enforcement.refs);
      }
    });

    it("rollups are derived: byKind sums to total, enforced = total − prose-only", () => {
      const report = buildGovernanceCoverageReport();
      const { byKind, total, enforced } = report.constitution;
      const kindSum = Object.values(byKind).reduce((a, b) => a + b, 0);
      expect(kindSum).toBe(total);
      expect(enforced).toBe(total - byKind["prose-only"]);
      // Recompute independently from the registry itself.
      const proseOnly = CONSTITUTION.filter((i) => i.enforcement.kind === "prose-only").length;
      expect(byKind["prose-only"]).toBe(proseOnly);
      expect(enforced).toBe(CONSTITUTION.length - proseOnly);
    });

    it("unenforcedHardStops mirrors the shared helper exactly", () => {
      const report = buildGovernanceCoverageReport();
      const helper = unenforcedHardStops();
      expect(report.constitution.unenforcedHardStops.count).toBe(helper.length);
      expect(report.constitution.unenforcedHardStops.ids).toEqual(helper.map((i) => i.id));
    });
  });

  describe("statute side", () => {
    it("contains every STATUTE_REGISTER id, exactly once, with citation/kind/refs/reviewStatus", () => {
      const report = buildGovernanceCoverageReport();
      const byId = new Map(report.statutes.entries.map((e) => [e.id, e]));
      expect(report.statutes.entries).toHaveLength(STATUTE_REGISTER.length);
      expect(byId.size).toBe(STATUTE_REGISTER.length);
      for (const statute of STATUTE_REGISTER) {
        const entry = byId.get(statute.id);
        expect(entry, `missing statute entry ${statute.id}`).toBeDefined();
        expect(entry!.title).toBe(statute.citation);
        expect(entry!.kind).toBe(statute.enforcement.kind);
        expect(entry!.refs).toEqual(statute.enforcement.refs);
        expect(entry!.reviewStatus).toBe(statute.reviewStatus);
      }
    });

    it("rollups are derived: byKind sums to total, reviewed = total − unreviewed", () => {
      const report = buildGovernanceCoverageReport();
      const { byKind, total, reviewed } = report.statutes;
      const kindSum = Object.values(byKind).reduce((a, b) => a + b, 0);
      expect(kindSum).toBe(total);
      const helper = unreviewed();
      expect(reviewed).toBe(total - helper.length);
      // Recompute independently from the registry itself.
      const unreviewedCount = STATUTE_REGISTER.filter((e) => e.reviewStatus === "UNREVIEWED").length;
      expect(report.statutes.unreviewed.count).toBe(unreviewedCount);
      expect(report.statutes.unreviewed.ids).toEqual(helper.map((e) => e.id));
    });
  });

  describe("honesty invariants", () => {
    it("reports no kind outside the registries' vocabularies (nothing invented)", () => {
      const report = buildGovernanceCoverageReport();
      const constitutionKinds = new Set(CONSTITUTION.map((i) => i.enforcement.kind));
      for (const [kind, count] of Object.entries(report.constitution.byKind)) {
        if (count > 0) expect(constitutionKinds.has(kind as never), `constitution kind ${kind}`).toBe(true);
      }
      const statuteKinds = new Set(STATUTE_REGISTER.map((e) => e.enforcement.kind));
      for (const [kind, count] of Object.entries(report.statutes.byKind)) {
        if (count > 0) expect(statuteKinds.has(kind as never), `statute kind ${kind}`).toBe(true);
      }
    });
  });
});
