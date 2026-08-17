/**
 * Scenario HTTP surface — the economics layer (Master Audit BI12, BK24).
 *
 *   POST /api/scenarios                          — compute + persist a scenario
 *   GET  /api/scenarios/engines                  — the deterministic engines and
 *                                                  the metrics each produces
 *   GET  /api/scenarios/:subjectType/:subjectId  — a subject's scenarios
 *
 * There is deliberately NO update and NO delete. Re-running the maths POSTs a
 * new scenario; a stored one never changes. Canonical law 4 requires financial
 * truth to be deterministic, tested AND versioned, and a mutable scenario would
 * let improving a formula silently rewrite the meaning of every number the old
 * one produced.
 *
 * The POST body carries INPUTS, never outputs. The server computes. A route
 * that accepted pre-computed metrics would make `engine_version` a claim by the
 * caller rather than a fact about the arithmetic — and would be the exact hole
 * through which a model-generated number becomes a persisted financial fact.
 *
 * NAVIGATION NOTE: API surface only. Scenario comparison renders inside the
 * existing Deals/Map property surfaces, per the five-fixed-doors doctrine.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import {
  recordScenario,
  scenariosForSubject,
} from "./services/economics/scenarioStore";
import {
  METRICS,
  SCENARIO_SUBJECT_TYPES,
  ScenarioEngineError,
  type EngineSpec,
} from "@shared/economics/scenario";
import { ALL_ENGINES } from "./services/economics/engines";

const router = Router();

const assumptionSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
  origin: z.enum(["user", "strategy-pack-default", "derived", "platform-default"]),
  basis: z.string().optional(),
});

const computeSchema = z.object({
  subjectType: z.enum(SCENARIO_SUBJECT_TYPES),
  subjectId: z.number().int().positive(),
  label: z.string().min(1),
  engineId: z.string().min(1),
  // Inputs only. Never outputs — see the file header. Strings are admitted for
  // ISO dates; the engines' own requireCents refuses a non-integer money value,
  // so this is not a loophole for "42000.50".
  inputs: z.record(z.string(), z.union([z.number(), z.string()])),
  assumptions: z.array(assumptionSchema).default([]),
  strategyPackId: z.string().nullable().default(null),
  strategyPackVersion: z.string().nullable().default(null),
});

// GET /api/scenarios/engines — what the platform can compute, and in what units
router.get("/engines", (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    engines: ALL_ENGINES.map((e: EngineSpec) => ({
      id: e.id,
      version: e.version,
      label: e.label,
      produces: e.produces,
    })),
    metrics: METRICS.map((m) => ({
      id: m.id,
      label: m.label,
      unit: m.unit,
      higherIsBetter: m.higherIsBetter,
    })),
  });
});

// POST /api/scenarios
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = computeSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const stored = await recordScenario(organizationId, parsed.data);
    res.json({ id: stored.id, computedAt: stored.computedAt, scenario: stored.body });
  } catch (err) {
    // An unregistered engine or a malformed money input is a CALLER error, and
    // saying so precisely is the difference between a fixable 400 and a
    // mysterious 500.
    if (err instanceof ScenarioEngineError) {
      return Errors.badRequest(res, err.message);
    }
    Errors.internal(res, err);
  }
});

// GET /api/scenarios/:subjectType/:subjectId
router.get(
  "/:subjectType/:subjectId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const subjectType = req.params.subjectType;
      if (!(SCENARIO_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
        return Errors.badRequest(res, `Unknown scenario subject type: ${subjectType}`);
      }
      const subjectId = Number(req.params.subjectId);
      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        return Errors.badRequest(res, "Invalid subject id");
      }

      const list = await scenariosForSubject(
        organizationId,
        subjectType as (typeof SCENARIO_SUBJECT_TYPES)[number],
        subjectId,
      );
      res.json({
        subjectType,
        subjectId,
        scenarios: list.map((s) => ({
          id: s.id,
          computedAt: s.computedAt,
          label: s.body.label,
          engineId: s.body.engineId,
          engineVersion: s.body.engineVersion,
          strategyPackId: s.body.strategyPackId,
          strategyPackVersion: s.body.strategyPackVersion,
          inputs: s.body.inputs,
          assumptions: s.body.assumptions,
          metrics: s.body.metrics,
        })),
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

export default router;
