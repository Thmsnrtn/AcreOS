/**
 * Subdivision V1, Leg 4 — the decision desk on a parent parcel the org holds
 * (package 2026-11 §6, §7).
 *
 *   POST /api/subdivision/decide          — record the operator's pursue / pass
 *                                           call through the shared decision kit (§6.1)
 *   GET  /api/subdivision/parcels/:id/desk — the desk's read model: the latest
 *                                           screen run, the recorded decisions,
 *                                           the pricing locks, the critical path
 *
 * §6.1 — THE DECISION. The feasibility inputs arrive from the operator and are
 * recomputed server-side through the kit (`recordUnderwrittenDecision`, engine
 * `subdivision_feasibility`, pack "subdivider"), so the evidence-rule-v2
 * ownership guard runs before anything is written. The decision freezes the
 * LATEST buildability screen run as derived assumptions — run id, rule version,
 * trigger counts, and both ends of the yield range with their stated bases — or
 * says, in one assumption, that no screen had been run. Only pursue and pass are
 * accepted: a decision is recorded on the PARENT parcel, never a child lot.
 *
 * §6.2 — PRICING LOCKS are shown with their true grading state. A lock is a
 * pricing act, not an outcome-graded decision: its record cites no scenario and
 * carries no review date, by design. The desk lists locks as "ungraded" and
 * never rewrites, back-fills or regrades them.
 *
 * §6.3 — THE LOOP CLOSES through the existing GET /api/decisions/due, which
 * takes no pack filter: a pursue/pass recorded here with a review date is asked
 * for its outcome like every other decision. This module adds no second queue.
 *
 * Nothing here looks anything up, sends anything, contacts anyone or moves
 * money. The desk reads the org's own rows and the kit records one decision.
 */
import type { Express, Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  lotPricingRules,
  outcomes,
  permitChecklists,
  permitGates,
  properties,
  subdivisionScreenRuns,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { routeParam } from "./utils/routeParams";
import { clock } from "./utils/clock";
import { ScenarioEngineError, type ScenarioAssumption } from "@shared/economics/scenario";
import type { LotYieldEstimate, RangeEnd } from "@shared/subdivision/lotYield";
import { computeCriticalPath, type CriticalPathGate } from "@shared/subdivision/criticalPath";
import {
  describeProperty,
  loadOrgProperty,
  recordUnderwrittenDecision,
  underwriteBodySchema,
} from "./services/underwriting/verticalDecision";
import { decisionsForSubject } from "./services/decisions/decisionStore";
import { scenariosForSubject } from "./services/economics/scenarioStore";

/** Only these two calls are subdivision decisions; defer / offer are not. */
const KINDS = ["pursue", "pass"] as const;
const SUBDIVIDER_PACK = "subdivider";

// The kit's own body, WITH its inputs: the feasibility inputs come from the
// operator and are recomputed through the kit (§6.1).
const decideBodySchema = underwriteBodySchema(KINDS);

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

function parseParcelId(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

/** The yield range end as a frozen number + its own basis, or nothing when it did not compute. */
function yieldEndAssumption(runId: number, which: "low" | "high", end: RangeEnd | undefined): ScenarioAssumption[] {
  if (!end || end.value === null || end.value === undefined || !Number.isFinite(end.value)) return [];
  return [
    {
      key: `yield_${which}_lots`,
      value: end.value,
      unit: "lots",
      origin: "derived",
      basis: `Frozen from buildability screen run ${runId}'s ${which} yield end. Basis: ${end.basis ?? "not recorded on the run"}`,
    },
  ];
}

export function registerSubdivisionDecisionRoutes(app: Express): void {
  app.post(
    "/api/subdivision/decide",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const organizationId = getOrganizationId(req);
        const userId = getUserId(req);
        const parsed = decideBodySchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const body = parsed.data;

        const property = await loadOrgProperty(organizationId, body.propertyId);
        if (!property) return Errors.notFound(res, "Property");

        // loadOrgProperty does not return parentParcelId — one org-scoped read of our own.
        const [lineage] = await db
          .select({ parentParcelId: properties.parentParcelId })
          .from(properties)
          .where(and(eq(properties.id, property.id), eq(properties.organizationId, organizationId)));
        if (lineage && lineage.parentParcelId !== null && lineage.parentParcelId !== undefined) {
          return Errors.badRequest(
            res,
            "Subdivision decisions are recorded on the parent parcel, not a child lot — record this decision on the parent.",
          );
        }

        const [run] = await db
          .select()
          .from(subdivisionScreenRuns)
          .where(
            and(
              eq(subdivisionScreenRuns.organizationId, organizationId),
              eq(subdivisionScreenRuns.parentParcelId, property.id),
            ),
          )
          .orderBy(desc(subdivisionScreenRuns.createdAt), desc(subdivisionScreenRuns.id))
          .limit(1);

        const evidence: ScenarioAssumption[] = [];
        if (run) {
          const est = run.yieldEstimate as unknown as LotYieldEstimate | null;
          evidence.push(
            { key: "screen_run_id", value: run.id, origin: "derived", basis: "The newest buildability screen run on this parcel when the decision was recorded; run records are append-only." },
            { key: "screen_rule_version", value: run.ruleVersion, origin: "derived", basis: `The screen rule version run ${run.id} was computed under.` },
            { key: "screen_triggered_count", value: run.triggeredCount, origin: "derived", basis: `Triggers that fired on screen run ${run.id}.` },
            { key: "screen_not_determinable_count", value: run.notDeterminableCount, origin: "derived", basis: `Triggers screen run ${run.id} could not determine from the recorded facts.` },
            ...yieldEndAssumption(run.id, "low", est?.yield?.low),
            ...yieldEndAssumption(run.id, "high", est?.yield?.high),
          );
        } else {
          evidence.push({
            key: "screen_state",
            value: "not screened",
            origin: "derived",
            basis: "No buildability screen had been run on this parcel when the decision was recorded.",
          });
        }

        const out = await recordUnderwrittenDecision(organizationId, {
          subjectType: "property",
          subjectId: property.id,
          engineId: "subdivision_feasibility",
          strategyPackId: "subdivider",
          inputs: body.inputs,
          assumptions: evidence,
          scenarioLabel: `Subdivision decision — ${describeProperty(property)}`,
          kind: body.kind,
          choice: body.choice,
          rationale: body.rationale,
          actorRef: userId,
          authority: "org_member:subdivision_decide",
          reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
        });

        res.json({ ...out, recordKind: "decision" as const });
      } catch (err) {
        if (err instanceof ScenarioEngineError) return Errors.badRequest(res, err.message);
        Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/subdivision/parcels/:id/desk",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const organizationId = getOrganizationId(req);
        const parcelId = parseParcelId(routeParam(req.params.id));
        if (!Number.isSafeInteger(parcelId)) return Errors.badRequest(res, "Invalid parcel id");

        const property = await loadOrgProperty(organizationId, parcelId);
        if (!property) return Errors.notFound(res, "Property");

        // ── latest screen run ─────────────────────────────────────────────
        const [run] = await db
          .select()
          .from(subdivisionScreenRuns)
          .where(
            and(
              eq(subdivisionScreenRuns.organizationId, organizationId),
              eq(subdivisionScreenRuns.parentParcelId, property.id),
            ),
          )
          .orderBy(desc(subdivisionScreenRuns.createdAt), desc(subdivisionScreenRuns.id))
          .limit(1);
        const latestScreenRun = run
          ? {
              id: run.id,
              createdAt: iso(run.createdAt),
              ruleVersion: run.ruleVersion,
              triggeredCount: run.triggeredCount,
              notDeterminableCount: run.notDeterminableCount,
              headline: (run.result as { headline?: string } | null)?.headline ?? null,
              yieldEstimate: run.yieldEstimate,
            }
          : null;

        // ── decisions (subdivider pursue / pass), newest first ────────────
        const recorded = (await decisionsForSubject(organizationId, "property", property.id)).filter(
          (d) => d.body.strategyPackId === SUBDIVIDER_PACK && (d.body.kind === "pursue" || d.body.kind === "pass"),
        );
        const graded = new Set<number>();
        if (recorded.length > 0) {
          const rows = await db
            .select({ decisionSnapshotId: outcomes.decisionSnapshotId })
            .from(outcomes)
            .where(
              and(
                eq(outcomes.organizationId, organizationId),
                inArray(outcomes.decisionSnapshotId, recorded.map((d) => d.id)),
              ),
            );
          for (const r of rows) graded.add(r.decisionSnapshotId);
        }
        const decisions = recorded.map((d) => ({
          id: d.id,
          decidedAt: d.decidedAt.toISOString(),
          kind: d.body.kind,
          choice: d.body.choice,
          rationale: d.body.rationale,
          reviewDueAt: iso(d.body.reviewDueAt),
          scenarioIds: d.body.scenarios.map((s) => s.scenarioId),
          hasOutcome: graded.has(d.id),
        }));

        // ── pricing locks: shown as what they are, never regraded ─────────
        const lockRows = await db
          .select()
          .from(lotPricingRules)
          .where(and(eq(lotPricingRules.organizationId, organizationId), eq(lotPricingRules.parentParcelId, property.id)))
          .orderBy(desc(lotPricingRules.lockedAt));
        const pricingLocks = lockRows
          .filter((r) => r.lockedGrid !== null && r.lockedGrid !== undefined)
          .map((r) => {
            const grid = r.lockedGrid ?? [];
            return {
              id: r.id,
              lockedAt: iso(r.lockedAt),
              lotCount: grid.length,
              totalAskingCents: grid.reduce((s, l) => s + Number(l.askingPriceCents ?? 0), 0),
              decisionSnapshotId: r.lockedDecisionSnapshotId,
              grading: "ungraded_pricing_act" as const,
              gradingNote:
                "A pricing act, not an outcome-graded decision: the lock's record cites no scenario and carries no review date, by design (package §6.2).",
            };
          });

        // ── critical path against the newest decision's stated timeline ───
        const newest = decisions[0] ?? null;
        let timelineP50Days: number | null = null;
        let timelineP90Days: number | null = null;
        if (newest && newest.scenarioIds.length > 0) {
          const stored = await scenariosForSubject(organizationId, "property", property.id);
          const cited = stored.find((s) => newest.scenarioIds.includes(s.id));
          const inputs = (cited?.body.inputs ?? {}) as Record<string, unknown>;
          const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
          timelineP50Days = num(inputs.timelineP50Days);
          timelineP90Days = num(inputs.timelineP90Days);
        }

        const gateRows = await db
          .select({
            gateKey: permitGates.gateKey,
            label: permitGates.label,
            sequence: permitGates.sequence,
            status: permitGates.status,
            expectedReturnAt: permitGates.expectedReturnAt,
          })
          .from(permitGates)
          .innerJoin(permitChecklists, eq(permitChecklists.id, permitGates.checklistId))
          .where(
            and(
              eq(permitGates.organizationId, organizationId),
              eq(permitChecklists.organizationId, organizationId),
              eq(permitChecklists.parentParcelId, property.id),
            ),
          )
          .orderBy(asc(permitGates.sequence));
        const gates: CriticalPathGate[] = gateRows.map((g) => ({
          gateKey: g.gateKey,
          label: g.label,
          sequence: g.sequence,
          status: g.status,
          expectedReturnAt: g.expectedReturnAt ? String(g.expectedReturnAt).slice(0, 10) : null,
        }));

        const criticalPath = computeCriticalPath({
          asOf: clock.now().toISOString(),
          decision: newest
            ? { recordedAt: newest.decidedAt, kind: newest.kind, timelineP50Days, timelineP90Days }
            : null,
          gates,
        });

        return res.json({
          property: {
            id: property.id,
            address: property.address,
            county: property.county,
            state: property.state,
            apn: property.apn,
          },
          latestScreenRun,
          decisions,
          pricingLocks,
          criticalPath,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
