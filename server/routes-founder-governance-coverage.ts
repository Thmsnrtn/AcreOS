/**
 * /api/founder/governance/coverage — the governance-coverage report (FOUNDER-ONLY).
 *
 * Answers "how much of our doctrine is actually CODE?" from the two
 * machine-readable governance registries — shared/governance/constitution.ts
 * (standing founder decisions) and shared/governance/statuteRegister.ts
 * (statute implementations) — with per-entry enforcement pointers and the two
 * honest debt rollups the ratchets drive to zero: unenforced hard stops and
 * unreviewed statutes. Pure registry read: no DB, no cache, no fabrication —
 * the numbers ARE the registries' contents (F5-lite, master handoff 2026-08).
 *
 * Rendered by the Letter's "rules that are code" stat row and the Story's
 * Governance section. This endpoint only READS the registries; changing a
 * decision still happens at its source (founder-only), and the registry files
 * themselves are gate-tamper-pinned.
 *
 * Pattern: isAuthenticated + getOrCreateOrg + requireFounder — same gate as
 * routes-founder-coverage.ts.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import {
  CONSTITUTION,
  unenforcedHardStops,
  type EnforcementKind,
} from "@shared/governance/constitution";
import {
  STATUTE_REGISTER,
  unreviewed,
  type StatuteEnforcementKind,
} from "@shared/governance/statuteRegister";

/** The full report, computed fresh from the registries on every read. */
export function buildGovernanceCoverageReport() {
  const constitutionByKind: Record<EnforcementKind, number> = {
    "code-invariant": 0,
    "ratchet-test": 0,
    lint: 0,
    "prose-only": 0,
  };
  for (const inv of CONSTITUTION) constitutionByKind[inv.enforcement.kind] += 1;
  const debtHardStops = unenforcedHardStops();

  const statutesByKind: Record<StatuteEnforcementKind, number> = {
    "unit-test": 0,
    ratchet: 0,
    "refusal-path": 0,
    "prose-only": 0,
  };
  for (const entry of STATUTE_REGISTER) statutesByKind[entry.enforcement.kind] += 1;
  const debtUnreviewed = unreviewed();

  return {
    asOf: new Date().toISOString(),
    constitution: {
      total: CONSTITUTION.length,
      // "Enforced" = any automated backstop (code-invariant / ratchet-test /
      // lint). prose-only is the honest remainder, same line the
      // constitution.test.ts ratchet draws.
      enforced: CONSTITUTION.length - constitutionByKind["prose-only"],
      byKind: constitutionByKind,
      unenforcedHardStops: {
        count: debtHardStops.length,
        ids: debtHardStops.map((i) => i.id),
      },
      entries: CONSTITUTION.map((inv) => ({
        id: inv.id,
        title: inv.title,
        category: inv.category,
        kind: inv.enforcement.kind,
        refs: inv.enforcement.refs,
      })),
    },
    statutes: {
      total: STATUTE_REGISTER.length,
      // "Reviewed" = a human (founder; nothing is attorney-reviewed yet) has
      // read the legal implementation — the register's headline debt.
      reviewed: STATUTE_REGISTER.length - debtUnreviewed.length,
      byKind: statutesByKind,
      unreviewed: {
        count: debtUnreviewed.length,
        ids: debtUnreviewed.map((e) => e.id),
      },
      entries: STATUTE_REGISTER.map((entry) => ({
        id: entry.id,
        title: entry.citation,
        kind: entry.enforcement.kind,
        refs: entry.enforcement.refs,
        reviewStatus: entry.reviewStatus,
      })),
    },
  };
}

export function registerFounderGovernanceCoverageRoutes(app: Express) {
  app.get(
    "/api/founder/governance/coverage",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        return res.json(buildGovernanceCoverageReport());
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
