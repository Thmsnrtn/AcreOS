/**
 * Scenario HTTP surface — the economics layer (Master Audit BI12, BK24).
 *
 *   POST /api/scenarios                          — compute + persist a scenario
 *                                                  (422 scenario_subject_mismatch
 *                                                  for an engine not about the
 *                                                  named subject, e.g. a note)
 *   POST /api/scenarios/preview                  — compute a vertical
 *                                                  underwriting scenario, persist
 *                                                  nothing
 *   POST /api/scenarios/subdivision-feasibility/sensitivity
 *                                                — the subdivision feasibility
 *                                                  engine's sensitivity grid,
 *                                                  persist nothing
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
import { BUSINESS_TYPE_IDS } from "@shared/business-types";
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
  ScenarioSubjectRefused,
  type EngineSpec,
} from "@shared/economics/scenario";
import { ALL_ENGINES } from "./services/economics/engines";
import { previewUnderwriting, underwritingInputsSchema } from "./services/underwriting/verticalDecision";
import { routeParam } from "./utils/routeParams";
import { feasibilityInputsFromWire } from "./services/economics/engines/subdivisionFeasibility";
import { FEASIBILITY_ENGINE_VERSION, FeasibilityInputError, feasibilitySensitivity } from "@shared/subdivision/feasibility";

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
  // VALIDATED AGAINST THE CANONICAL REGISTRY, not `z.string()`. This is a
  // public write path: accepting any string here would let a caller store a
  // pack id that names nothing, which is the drift a second taxonomy would have
  // caused anyway. z.enum over BUSINESS_TYPE_IDS rejects it at the door.
  strategyPackId: z.enum(BUSINESS_TYPE_IDS).nullable().default(null),
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

const previewSchema = z.object({
  engineId: z.string().min(1).max(64),
  inputs: underwritingInputsSchema,
});

/**
 * Compute a vertical underwriting scenario WITHOUT persisting it — what the
 * underwriting workbench shows while the operator types. Same registry and
 * arithmetic as the recorded scenario (previewUnderwriting), so what they see
 * is what a decision later freezes. Records nothing, decides nothing.
 */
router.post("/preview", (req: AuthenticatedRequest, res: Response) => {
  try {
    getOrganizationId(req);
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    res.json(previewUnderwriting(parsed.data.engineId, parsed.data.inputs));
  } catch (err) {
    if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

/**
 * POST /api/scenarios/subdivision-feasibility/sensitivity — the §5.3 grid for
 * the subdivision feasibility engine: lot price ±10/±20%, absorption pace ±25%,
 * infrastructure cost ±15%, one axis at a time, every cell computed by the SAME
 * pure module over the same (perturbed) input snapshot — so a frozen scenario's
 * grid is reproducible from its stored inputs. Records nothing.
 */
const sensitivitySchema = z.object({ inputs: underwritingInputsSchema });
router.post("/subdivision-feasibility/sensitivity", (req: AuthenticatedRequest, res: Response) => {
  try {
    getOrganizationId(req);
    const parsed = sensitivitySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    const inputs = feasibilityInputsFromWire(parsed.data.inputs);
    res.json({ engineVersion: FEASIBILITY_ENGINE_VERSION, cells: feasibilitySensitivity(inputs) });
  } catch (err) {
    if (err instanceof ScenarioEngineError || err instanceof FeasibilityInputError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
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
    if (err instanceof ScenarioSubjectRefused) {
      // The request is well-formed and nothing in it can be corrected: the
      // store cannot key this engine's subject. Answer 422 with the refusal
      // named, not a 400 that tells the caller to fix their input.
      return Errors.unprocessable(res, err.message, {
        refusal: err.refusal,
        engineId: err.engineId,
        engineSubjectKind: err.engineSubjectKind,
        subjectType: err.subjectType,
      });
    }
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
      const subjectType = routeParam(req.params.subjectType);
      if (!(SCENARIO_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
        return Errors.badRequest(res, `Unknown scenario subject type: ${subjectType}`);
      }
      const subjectId = Number(routeParam(req.params.subjectId));
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
