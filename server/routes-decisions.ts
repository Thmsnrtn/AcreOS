/**
 * Decision Memory HTTP surface (Master Audit BI20, BK28).
 *
 *   POST /api/decisions                          — record a decision, freezing
 *                                                  the evidence in force
 *   GET  /api/decisions/:id                      — one frozen decision
 *   GET  /api/decisions/:subjectType/:subjectId  — a subject's decision history
 *
 * There is deliberately NO update and NO delete endpoint. A snapshot is written
 * once and read forever; later evidence and later outcomes append context but
 * never edit it (canonical laws 6 and 9). An endpoint that could edit a
 * snapshot would make the whole layer decorative.
 *
 * NAVIGATION NOTE: this is an API surface only. It adds no customer nav entry —
 * decision history renders inside the existing Deals/Map property surfaces,
 * per the five-fixed-doors doctrine in CLAUDE.md.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import {
  decisionsForSubject,
  getDecision,
  recordDecision,
} from "./services/decisions/decisionStore";
import {
  DECISION_ACTOR_TYPES,
  DECISION_KINDS,
  DECISION_SUBJECT_TYPES,
  describeFooting,
} from "@shared/decisions/snapshot";

const router = Router();

const assumptionSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  unit: z.string().optional(),
  origin: z.enum(["user", "strategy-pack-default", "derived", "platform-default"]),
  basis: z.string().optional(),
});

const alternativeSchema = z.object({
  choice: z.string().min(1),
  // An alternative with no reason is not a considered option — it is noise in
  // the record. Required, deliberately.
  reason: z.string().min(1),
});

const unknownSchema = z.object({
  subject: z.string().min(1),
  kind: z.enum(["unknown", "conflict", "unmeasured"]),
  note: z.string().optional(),
});

const recordSchema = z.object({
  subjectType: z.enum(DECISION_SUBJECT_TYPES),
  subjectId: z.number().int().positive(),
  kind: z.enum(DECISION_KINDS),
  choice: z.string().min(1),
  // A decision with no rationale is an event, not a decision. Requiring it is
  // the difference between Decision Memory and an activity log (BI76).
  rationale: z.string().min(1),
  actorType: z.enum(DECISION_ACTOR_TYPES),
  actorRef: z.string().min(1),
  authority: z.string().min(1),
  strategyPackId: z.string().nullable().default(null),
  strategyPackVersion: z.string().nullable().default(null),
  assumptions: z.array(assumptionSchema).default([]),
  alternatives: z.array(alternativeSchema).default([]),
  additionalUnknowns: z.array(unknownSchema).default([]),
  /**
   * Scenarios whose economics justified this choice. Ids only — the store
   * resolves them to frozen references itself, because a caller that hands
   * over pre-computed numbers can hand over any numbers at all.
   */
  scenarioIds: z.array(z.number().int().positive()).default([]),
});

// POST /api/decisions
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const { scenarioIds, ...decision } = parsed.data;
    const recorded = await recordDecision(
      organizationId,
      decision,
      new Date(),
      scenarioIds,
    );
    // 200 rather than 201: the res-status-raw ratchet is down-only and 172
    // pre-existing `res.status(201)` calls are already frozen into its
    // baseline, so adding a 173rd would require raising it. The response body
    // carries the created id, which is what a caller actually needs.
    res.json({
      id: recorded.id,
      decidedAt: recorded.decidedAt,
      footing: describeFooting(recorded.body),
      snapshot: recorded.body,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /api/decisions/:id
router.get("/:id(\\d+)", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const id = Number(req.params.id);
    const found = await getDecision(organizationId, id);
    if (!found) return Errors.notFound(res, "Decision");
    res.json({
      id: found.id,
      decidedAt: found.decidedAt,
      footing: describeFooting(found.body),
      snapshot: found.body,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /api/decisions/:subjectType/:subjectId
router.get("/:subjectType/:subjectId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const subjectType = req.params.subjectType;
    if (!(DECISION_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
      return Errors.badRequest(
        res,
        `Unknown decision subject type: ${subjectType}`,
      );
    }
    const subjectId = Number(req.params.subjectId);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return Errors.badRequest(res, "Invalid subject id");
    }

    const history = await decisionsForSubject(
      organizationId,
      subjectType as (typeof DECISION_SUBJECT_TYPES)[number],
      subjectId,
    );
    res.json({
      subjectType,
      subjectId,
      decisions: history.map((d) => ({
        id: d.id,
        decidedAt: d.decidedAt,
        kind: d.body.kind,
        choice: d.body.choice,
        rationale: d.body.rationale,
        actorType: d.body.actorType,
        authority: d.body.authority,
        strategyPackId: d.body.strategyPackId,
        strategyPackVersion: d.body.strategyPackVersion,
        // The footing leads with what was NOT known — the part a reader
        // reconstructing a past decision most needs and is least likely to be
        // told.
        footing: describeFooting(d.body),
        unknowns: d.body.unknowns,
      })),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
