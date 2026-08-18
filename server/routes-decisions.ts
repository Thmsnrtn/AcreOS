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
  decisionsDueForOutcome,
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
import { UnavailableScenarioError } from "./services/economics/scenarioStore";
import {
  UnknownDecisionError,
  calibrationForOrganization,
  outcomesForDecision,
  recordOutcome,
} from "./services/outcomes/outcomeStore";
import { OUTCOME_KINDS, OutcomeMetricError } from "@shared/outcomes/outcome";
import {
  MIN_COMPARISONS_FOR_DIRECTION,
  describeCalibration,
} from "@shared/outcomes/calibration";

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
  /**
   * When the decision-maker expects to know whether this worked.
   *
   * Optional, and OMITTING it means "no natural review date" rather than
   * "default to 30 days". A default here would manufacture a due date the
   * customer never chose, and the sweep would then nag about every decision
   * ever recorded — which is how a prompt earns being ignored.
   */
  reviewDueAt: z.coerce.date().nullable().optional(),
});

// POST /api/decisions
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = recordSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const { scenarioIds, ...decision } = parsed.data;
    // The wire field stays optional for back-compat; the snapshot type does
    // not. Normalising HERE rather than inside `freeze()` is the point: the
    // frozen record promises that "never to be reviewed" is distinguishable
    // from "review forgotten", and a silent coalesce deep in the writer is what
    // made those the same value.
    const recorded = await recordDecision(
      organizationId,
      { ...decision, reviewDueAt: decision.reviewDueAt ?? null },
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
    // Citing a scenario this org cannot read is a CALLER error, not a server
    // fault. The message deliberately does not say whether the id belongs to
    // another tenant or does not exist — see UnavailableScenarioError.
    if (err instanceof UnavailableScenarioError) {
      return Errors.badRequest(res, err.message);
    }
    Errors.internal(res, err);
  }
});

/**
 * GET /api/decisions/due
 *
 * The decisions whose review date has passed and which have no RESOLVED
 * outcome — the missing end of the canonical loop (Master Audit Section VII).
 *
 * Until this existed, nothing ever ASKED for an outcome, so the loop closed only
 * when someone spontaneously chose to close it. That is not merely incomplete:
 * it biases everything built above it, because the outcomes a person volunteers
 * are the memorable ones and memorable usually means extreme. A calibration over
 * volunteered outcomes measures what someone remembers, not how they forecast.
 *
 * Read-only. Being asked for an outcome must never create one.
 */
router.get("/due", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const due = await decisionsDueForOutcome(organizationId);
    res.json({
      due,
      // The count is the list's length, not a separate query — two numbers that
      // can disagree are worse than one.
      count: due.length,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /api/decisions/calibration
 *
 * The layer above a single variance (Master Audit Section VII D): how this
 * organization's FORECASTS have tended to miss, per metric, across every
 * outcome it has recorded.
 *
 * Registered before `/:id` by convention. It is not strictly required here —
 * that route is digit-constrained (`/:id(\d+)`), so a literal path cannot be
 * swallowed by it — but the ordering is what `scripts/check-route-order.mjs`
 * looks for and what a reader expects.
 *
 * API surface only. Calibration renders inside the existing Deals/Finance
 * surfaces; the five customer doors do not grow a sixth.
 */
router.get("/calibration", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const report = await calibrationForOrganization(organizationId);
    res.json({
      calibration: report,
      // One honest line per metric, including "not enough measured outcomes
      // yet" — which is the whole sentence when the sample cannot support a
      // claim, rather than a hedged version of one.
      summary: describeCalibration(report),
      minComparisonsForDirection: MIN_COMPARISONS_FOR_DIRECTION,
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

// ── Outcomes: what actually happened (canonical law 9) ────────────────────
//
// Mounted under /api/decisions/:id/outcomes rather than a top-level
// /api/outcomes, because an outcome has no meaning apart from the decision it
// grades — the URL says so, and there is no way to POST one without naming a
// decision this org owns.
//
// There is NO update and NO delete: outcomes append learning, they do not
// rewrite history. And nothing on this path can edit the decision itself.

const outcomeSchema = z.object({
  kind: z.enum(OUTCOME_KINDS),
  summary: z.string().min(1),
  actuals: z
    .array(
      z.object({
        id: z.string().min(1),
        // null means NOT MEASURED. It never means zero, so the schema must
        // accept it explicitly rather than coercing a missing value.
        value: z.number().nullable(),
      }),
    )
    .default([]),
  /** When it was OBSERVED — not when it was recorded. */
  observedAt: z.coerce.date(),
});

// POST /api/decisions/:id/outcomes
router.post("/:id(\\d+)/outcomes", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = outcomeSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const stored = await recordOutcome(organizationId, {
      decisionSnapshotId: Number(req.params.id),
      ...parsed.data,
    });
    res.json({ id: stored.id, observedAt: stored.observedAt, outcome: stored.body });
  } catch (err) {
    if (err instanceof UnknownDecisionError) return Errors.notFound(res, "Decision");
    // An unregistered metric is a caller error, and saying so precisely is the
    // difference between a fixable 400 and a mysterious 500.
    if (err instanceof OutcomeMetricError) return Errors.badRequest(res, err.message);
    Errors.internal(res, err);
  }
});

// GET /api/decisions/:id/outcomes — with variance against the FROZEN scenarios
router.get("/:id(\\d+)/outcomes", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const list = await outcomesForDecision(organizationId, Number(req.params.id));
    res.json({
      decisionSnapshotId: Number(req.params.id),
      outcomes: list.map((o) => ({
        id: o.id,
        observedAt: o.observedAt,
        recordedAt: o.recordedAt,
        kind: o.body.kind,
        summary: o.body.summary,
        actuals: o.body.actuals,
        // Computed on read against what the decision FROZE, never against a
        // live scenario row — a later recomputation must not change how a past
        // decision looks.
        variance: o.variance,
        varianceSummary: o.varianceSummary,
      })),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
