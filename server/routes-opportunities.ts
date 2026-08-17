/**
 * Opportunity HTTP surface — the Reality Graph's pre-commitment object.
 *
 *   POST /api/opportunities                          — open one on a parcel
 *   GET  /api/opportunities/:state/:county/:apn      — every opportunity on a
 *                                                      parcel (the BI93 read)
 *   POST /api/opportunities/:id/close                — close or mark converted
 *
 * WHY THIS EXISTS AT ALL. `DECISION_SUBJECT_TYPES` and `SCENARIO_SUBJECT_TYPES`
 * have both accepted an `opportunity` subject for some time, and POST
 * /api/decisions validates against that enum — so a client could already record
 * a decision against an opportunity id. With no `opportunities` table, that id
 * was resolved as a `properties.id` and the decision froze an unrelated
 * property's evidence. The table closes that hole; this router is what makes
 * the subject reachable, because a subject type nothing can CREATE is a subject
 * type that can only ever refuse.
 *
 * THERE IS NO UPDATE ENDPOINT for the parcel identity. An opportunity's parcel
 * is what it IS; re-pointing one at different land would silently re-target
 * every decision and outcome already recorded against it. Close it and open
 * another.
 *
 * NAVIGATION NOTE: an API surface only. It adds no customer nav entry —
 * opportunities render inside the existing Deals and Map surfaces, per the
 * five-fixed-doors doctrine in CLAUDE.md.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import {
  UnavailableOpportunityError,
  closeOpportunity,
  createOpportunity,
  opportunitiesForParcel,
} from "./services/opportunities";
import { normalizeParcelRef } from "@shared/parcel/parcelRef";
import {
  OPPORTUNITY_KINDS,
  OPPORTUNITY_ORIGINS,
} from "@shared/schema";

const router = Router();

const openSchema = z.object({
  state: z.string(),
  county: z.string(),
  apn: z.string(),
  kind: z.enum(OPPORTUNITY_KINDS),
  /**
   * Absent means "not yet chosen" and is stored as NULL. Deliberately not
   * defaulted: `strategy` is what makes two simultaneous evaluations of one
   * parcel distinguishable, and inventing one would fabricate an intent.
   */
  strategy: z.string().min(1).max(120).nullable().optional(),
  originType: z.enum(OPPORTUNITY_ORIGINS),
  originRef: z.string().max(200).nullable().optional(),
});

// POST /api/opportunities
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const parsed = openSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const { state, county, apn, ...rest } = parsed.data;
    // ONE definition of "the same parcel". A refusal here is a CALLER error —
    // the alternative is storing a half-formed key, which attaches every
    // decision made against this opportunity to land nobody can identify.
    const ref = normalizeParcelRef({ state, county, apn });
    if (!ref.ok) {
      return Errors.badRequest(
        res,
        "The parcel reference is not usable as an identity.",
        { problems: ref.problems },
      );
    }

    const row = await createOpportunity({
      organizationId,
      parcel: ref.ref,
      kind: rest.kind,
      strategy: rest.strategy ?? null,
      originType: rest.originType,
      originRef: rest.originRef ?? null,
    });
    // 200 rather than 201, for the same reason routes-decisions.ts gives: the
    // res-status-raw ratchet is down-only and adding a new `res.status(201)`
    // would require raising it. The body carries the id, which is what a caller
    // needs.
    res.json({ id: row.id, openedAt: row.openedAt, status: row.status });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /api/opportunities/:state/:county/:apn
router.get(
  "/:state/:county/:apn",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const ref = normalizeParcelRef({
        state: req.params.state,
        county: decodeURIComponent(req.params.county ?? ""),
        apn: decodeURIComponent(req.params.apn ?? ""),
      });
      if (!ref.ok) {
        return Errors.badRequest(
          res,
          "The parcel reference is not usable as an identity.",
          { problems: ref.problems },
        );
      }

      const rows = await opportunitiesForParcel(organizationId, ref.ref);
      res.json({
        parcel: ref.ref,
        // Several rows differing only in `strategy` is the expected shape here,
        // not a duplicate-data bug: it is one parcel under several simultaneous
        // evaluations (BI93).
        opportunities: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          strategy: r.strategy,
          status: r.status,
          originType: r.originType,
          openedAt: r.openedAt,
          closedAt: r.closedAt,
        })),
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

const closeSchema = z.object({
  // "passed" and "won" are DECISIONS and belong in decision_snapshots. Allowing
  // them here would give one judgement two owners that can disagree.
  status: z.enum(["converted", "closed"]),
});

// POST /api/opportunities/:id/close
router.post("/:id/close", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Errors.badRequest(res, "Opportunity id must be a positive integer.");
    }
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);

    const row = await closeOpportunity(organizationId, id, parsed.data.status);
    res.json({ id: row.id, status: row.status, closedAt: row.closedAt });
  } catch (err) {
    // Not found and belongs-to-another-tenant are the same answer on purpose —
    // see UnavailableOpportunityError. 404 rather than 400: from the caller's
    // side there is no such opportunity, and saying anything sharper would make
    // the endpoint an oracle for which sequential ids exist elsewhere.
    if (err instanceof UnavailableOpportunityError) {
      return Errors.notFound(res, "Opportunity");
    }
    Errors.internal(res, err);
  }
});

export default router;
