/**
 * Subdivider vertical SD-3 — county-by-county permit-tracker workflow.
 *
 * Brigid §2: "In Williamson TN, a residential subdivision plat needs, in
 * order: pre-application meeting, sketch plan review, planning commission
 * preliminary plat approval, soil percolation tests for septic on every
 * lot without sewer, road construction permit, road bond posting,
 * stormwater Notice of Intent, utility will-serve letters, fire-marshal
 * access review, final plat approval, mylar signatures, recording, then
 * assessor splits the parcel. Fourteen separate gates."
 *
 * "If you ship the permit-tracker first, before the drawing tool, you'd
 * still get adoption from people like me — because the permit hell is the
 * part that drives the drinking. […] Knowing whether Earl's stormwater
 * plan got submitted to TDEC three weeks ago and is now stuck on a
 * reviewer's desk — that I'd pay for tomorrow."
 *
 * Routes:
 *   GET    /api/permit-templates                       — list available templates
 *   GET    /api/parcels/:id/permits                    — checklists for a parent
 *   POST   /api/parcels/:id/permits                    — create checklist from template
 *   PATCH  /api/permit-gates/:gateId                   — update gate status/dates
 *   GET    /api/permits/stalled                        — org-wide stalled gates
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, isNull, sql, lte, asc, gt } from "drizzle-orm";
import { db } from "./db";
import {
  permitChecklists,
  permitGates,
  properties,
  PERMIT_GATE_STATUSES,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { emitPermitGateApproved } from "./services/subdivisionEvents";

// ----------------------------------------------------------------------------
// Templates — permit gate sequences per (state, county) Brigid actually works.
// Brigid §2: "Williamson TN […] fourteen separate gates. Hickman County is
// different — fewer steps, but the percolation queue is worse. Maury is
// different again. Davidson refuses to do residential subdivisions in some
// districts at all anymore."
// ----------------------------------------------------------------------------

interface GateDef {
  gateKey: string;
  label: string;
  expectedDays?: number;  // typical lead-time in days from submitted_at
  feeCents?: number;
}

interface TemplateDef {
  templateKey: string;
  state: string;
  county: string;
  description: string;
  gates: GateDef[];
}

const TEMPLATES: TemplateDef[] = [
  {
    templateKey: "tn_williamson_residential_subdivision_v1",
    state: "TN",
    county: "Williamson",
    description:
      "Standard residential subdivision in Williamson County, TN — 14 gates from pre-application through recording.",
    gates: [
      { gateKey: "pre_application_meeting", label: "Pre-application meeting (Williamson Planning)", expectedDays: 14 },
      { gateKey: "sketch_plan_review", label: "Sketch plan review", expectedDays: 30 },
      { gateKey: "preliminary_plat_submitted", label: "Preliminary plat submitted", expectedDays: 45, feeCents: 140000 },
      { gateKey: "soil_percolation_tests", label: "Soil percolation tests (TDEC)", expectedDays: 90 },
      { gateKey: "road_construction_permit", label: "Road construction permit", expectedDays: 30 },
      { gateKey: "road_bond_posted", label: "Road bond posted (110% of est. road cost)", expectedDays: 14 },
      { gateKey: "stormwater_noi", label: "Stormwater NOI to TDEC", expectedDays: 21 },
      { gateKey: "utility_will_serve_electric", label: "Will-serve letter — electric co-op", expectedDays: 21 },
      { gateKey: "utility_will_serve_water", label: "Will-serve letter — water utility", expectedDays: 21 },
      { gateKey: "fire_marshal_review", label: "Fire-marshal access review", expectedDays: 30 },
      { gateKey: "final_plat_submitted", label: "Final plat submitted", expectedDays: 45 },
      { gateKey: "mylar_signatures", label: "Mylar signatures (surveyor + planning chair)", expectedDays: 14 },
      { gateKey: "plat_recorded", label: "Plat recorded at register's office", expectedDays: 21 },
      { gateKey: "assessor_split", label: "Assessor parcel split + new APNs issued", expectedDays: 60 },
    ],
  },
  {
    templateKey: "tn_hickman_residential_subdivision_v1",
    state: "TN",
    county: "Hickman",
    description:
      "Residential subdivision in Hickman County, TN — fewer gates than Williamson; TDEC perc-test queue is the bottleneck.",
    gates: [
      { gateKey: "pre_application_meeting", label: "Pre-application meeting", expectedDays: 7 },
      { gateKey: "preliminary_plat_submitted", label: "Preliminary plat submitted", expectedDays: 21, feeCents: 90000 },
      { gateKey: "soil_percolation_tests", label: "Soil percolation tests (TDEC, shared queue)", expectedDays: 120 },
      { gateKey: "stormwater_noi", label: "Stormwater NOI to TDEC", expectedDays: 21 },
      { gateKey: "final_plat_submitted", label: "Final plat submitted", expectedDays: 21 },
      { gateKey: "plat_recorded", label: "Plat recorded", expectedDays: 14 },
      { gateKey: "assessor_split", label: "Assessor parcel split", expectedDays: 60 },
    ],
  },
  {
    templateKey: "tn_maury_residential_subdivision_v1",
    state: "TN",
    county: "Maury",
    description: "Residential subdivision in Maury County, TN.",
    gates: [
      { gateKey: "pre_application_meeting", label: "Pre-application meeting", expectedDays: 14 },
      { gateKey: "sketch_plan_review", label: "Sketch plan review", expectedDays: 21 },
      { gateKey: "preliminary_plat_submitted", label: "Preliminary plat submitted", expectedDays: 30, feeCents: 110000 },
      { gateKey: "soil_percolation_tests", label: "Soil percolation tests (TDEC)", expectedDays: 90 },
      { gateKey: "road_construction_permit", label: "Road construction permit", expectedDays: 21 },
      { gateKey: "stormwater_noi", label: "Stormwater NOI to TDEC", expectedDays: 21 },
      { gateKey: "final_plat_submitted", label: "Final plat submitted", expectedDays: 30 },
      { gateKey: "plat_recorded", label: "Plat recorded", expectedDays: 21 },
      { gateKey: "assessor_split", label: "Assessor parcel split", expectedDays: 60 },
    ],
  },
  {
    templateKey: "tn_davidson_residential_subdivision_v1",
    state: "TN",
    county: "Davidson",
    description:
      "Residential subdivision in Davidson County, TN — restricted in many districts. Confirm zoning early.",
    gates: [
      { gateKey: "zoning_confirmation", label: "Zoning permits subdivision (DISTRICT-LEVEL CHECK)", expectedDays: 14 },
      { gateKey: "pre_application_meeting", label: "Pre-application meeting (Metro Planning)", expectedDays: 30 },
      { gateKey: "sketch_plan_review", label: "Sketch plan review", expectedDays: 45 },
      { gateKey: "preliminary_plat_submitted", label: "Preliminary plat submitted", expectedDays: 60, feeCents: 200000 },
      { gateKey: "stormwater_review", label: "Metro Water Services stormwater review", expectedDays: 45 },
      { gateKey: "fire_marshal_review", label: "Fire-marshal access review", expectedDays: 30 },
      { gateKey: "final_plat_submitted", label: "Final plat submitted", expectedDays: 60 },
      { gateKey: "plat_recorded", label: "Plat recorded", expectedDays: 30 },
      { gateKey: "assessor_split", label: "Assessor parcel split", expectedDays: 90 },
    ],
  },
  {
    templateKey: "generic_residential_subdivision_v1",
    state: "*",
    county: "*",
    description: "Generic 7-gate residential subdivision template — start here when no county template exists.",
    gates: [
      { gateKey: "pre_application_meeting", label: "Pre-application meeting", expectedDays: 14 },
      { gateKey: "preliminary_plat_submitted", label: "Preliminary plat submitted", expectedDays: 30 },
      { gateKey: "soil_percolation_tests", label: "Soil percolation tests", expectedDays: 60 },
      { gateKey: "stormwater_noi", label: "Stormwater NOI", expectedDays: 21 },
      { gateKey: "final_plat_submitted", label: "Final plat submitted", expectedDays: 30 },
      { gateKey: "plat_recorded", label: "Plat recorded", expectedDays: 21 },
      { gateKey: "assessor_split", label: "Assessor parcel split", expectedDays: 60 },
    ],
  },
];

const TEMPLATE_BY_KEY = new Map(TEMPLATES.map((t) => [t.templateKey, t]));

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const createChecklistSchema = z.object({
  templateKey: z.string().min(1),
  countyState: z.string().length(2).optional(),
  countyName: z.string().min(1).optional(),
  title: z.string().optional(),
});

const updateGateSchema = z.object({
  status: z.enum(PERMIT_GATE_STATUSES).optional(),
  submittedAt: z.string().optional().nullable(),
  expectedReturnAt: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  feeCents: z.coerce.number().int().nonnegative().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable().or(z.literal("")),
  contactPhone: z.string().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerPermitTrackerRoutes(app: Express): void {
  // GET /api/permit-templates — list templates so the UI can present a picker.
  app.get(
    "/api/permit-templates",
    isAuthenticated,
    async (_req: AuthenticatedRequest, res: Response) => {
      return res.json({
        templates: TEMPLATES.map((t) => ({
          templateKey: t.templateKey,
          state: t.state,
          county: t.county,
          description: t.description,
          gateCount: t.gates.length,
        })),
      });
    },
  );

  // GET /api/parcels/:id/permits — all checklists for a parent parcel.
  app.get(
    "/api/parcels/:id/permits",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const checklists = await db
          .select()
          .from(permitChecklists)
          .where(and(
            eq(permitChecklists.organizationId, orgId),
            eq(permitChecklists.parentParcelId, parentId),
          ))
          .orderBy(asc(permitChecklists.createdAt));

        if (checklists.length === 0) return res.json({ checklists: [] });

        // Fetch all gates for these checklists in a single query.
        const ids = checklists.map((c) => c.id);
        const gates = await db
          .select()
          .from(permitGates)
          .where(and(
            eq(permitGates.organizationId, orgId),
            sql`${permitGates.checklistId} = ANY(${ids}::uuid[])`,
          ))
          .orderBy(asc(permitGates.sequence));

        const gatesByChecklist = new Map<string, typeof gates>();
        for (const g of gates) {
          if (!gatesByChecklist.has(g.checklistId)) gatesByChecklist.set(g.checklistId, []);
          gatesByChecklist.get(g.checklistId)!.push(g);
        }

        const out = checklists.map((c) => {
          const cgates = gatesByChecklist.get(c.id) ?? [];
          const completed = cgates.filter((g) => g.status === "approved" || g.status === "skipped").length;
          const stalled = cgates.filter((g) => isStalledGate(g)).length;
          return { ...c, gates: cgates, completedCount: completed, stalledCount: stalled };
        });

        return res.json({ checklists: out });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/parcels/:id/permits — instantiate a template into a checklist.
  app.post(
    "/api/parcels/:id/permits",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const parsed = createChecklistSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const tpl = TEMPLATE_BY_KEY.get(parsed.data.templateKey);
        if (!tpl) return Errors.badRequest(res, `Unknown template ${parsed.data.templateKey}`);

        const [parent] = await db
          .select()
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parcel");

        const [checklist] = await db.insert(permitChecklists).values({
          organizationId: orgId,
          parentParcelId: parentId,
          countyState: parsed.data.countyState ?? parent.state,
          countyName: parsed.data.countyName ?? parent.county,
          templateKey: parsed.data.templateKey,
          title: parsed.data.title ?? `${parent.county} ${parent.state} — ${tpl.description.split(" — ")[0]}`,
        }).returning();

        const gateInserts = tpl.gates.map((g, idx) => ({
          organizationId: orgId,
          checklistId: checklist.id as string,
          sequence: idx + 1,
          gateKey: g.gateKey,
          label: g.label,
          status: "not_started" as const,
          feeCents: g.feeCents ?? null,
        }));
        const gates = await db.insert(permitGates).values(gateInserts).returning();

        logger.info("[SD-3] permit checklist created", {
          orgId,
          userId,
          parentId,
          templateKey: parsed.data.templateKey,
          gateCount: gates.length,
        });

        return res.status(201).json({ checklist: { ...checklist, gates } });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // PATCH /api/permit-gates/:gateId — flip a gate's status / dates / contact.
  app.patch(
    "/api/permit-gates/:gateId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const gateId = req.params.gateId;
        if (!gateId) return Errors.badRequest(res, "Missing gate id");

        const parsed = updateGateSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        for (const k of [
          "status", "submittedAt", "expectedReturnAt", "completedAt",
          "feeCents", "contactName", "contactEmail", "contactPhone",
          "referenceNumber", "notes",
        ] as const) {
          if (parsed.data[k] !== undefined) updates[k] = parsed.data[k] === "" ? null : parsed.data[k];
        }

        // Capture the pre-image gate BEFORE the update — its status is the
        // pre-image for the subdivision.vendor_milestone transition below, and
        // its gateKey/checklistId/sequence drive both the submitted-branch
        // expected-return calc and the next-gate lookup for the emit.
        const [beforeGate] = await db
          .select({
            status: permitGates.status,
            checklistId: permitGates.checklistId,
            sequence: permitGates.sequence,
            gateKey: permitGates.gateKey,
          })
          .from(permitGates)
          .where(and(eq(permitGates.id, gateId), eq(permitGates.organizationId, orgId)));

        // If status flipped to "submitted" and an expectedDays was set on the
        // template gate, auto-populate expected_return_at = submittedAt + Δ.
        if (parsed.data.status === "submitted" && parsed.data.submittedAt && !parsed.data.expectedReturnAt) {
          if (beforeGate) {
            const [cl] = await db
              .select({ templateKey: permitChecklists.templateKey })
              .from(permitChecklists)
              .where(eq(permitChecklists.id, beforeGate.checklistId));
            const tpl = cl?.templateKey ? TEMPLATE_BY_KEY.get(cl.templateKey) : null;
            const tplGate = tpl?.gates.find((g) => g.gateKey === beforeGate.gateKey);
            if (tplGate?.expectedDays) {
              const submitted = new Date(parsed.data.submittedAt);
              const expected = new Date(submitted.getTime() + tplGate.expectedDays * 86_400_000);
              updates.expectedReturnAt = expected.toISOString().slice(0, 10);
            }
          }
        }

        const [updated] = await db
          .update(permitGates)
          .set(updates)
          .where(and(eq(permitGates.id, gateId), eq(permitGates.organizationId, orgId)))
          .returning();
        if (!updated) return Errors.notFound(res, "Permit gate");

        // SD-3 audit Wave 1 (beta→core): a gate genuinely reaching "approved" is
        // a real vendor/county milestone. Resolve the parent parcel + the NEXT
        // gate in sequence (its label = next stage, contactName = next vendor,
        // template expectedDays = next-stage duration), then fire
        // subdivision.vendor_milestone. Fire-and-forget: this whole block is
        // wrapped so a resolution failure never fails the gate write that just
        // committed. The plat_recorded/assessor_split gates are deliberately NOT
        // special-cased here — recording emits from the plan→recorded path only.
        if (beforeGate && beforeGate.status !== "approved" && parsed.data.status === "approved") {
          try {
            const [parcel] = await db
              .select({
                parentParcelId: properties.id,
                address: properties.address,
                county: properties.county,
                state: properties.state,
                templateKey: permitChecklists.templateKey,
              })
              .from(permitChecklists)
              .innerJoin(properties, eq(properties.id, permitChecklists.parentParcelId))
              .where(and(
                eq(permitChecklists.id, beforeGate.checklistId),
                eq(permitChecklists.organizationId, orgId),
              ));

            const [nextGate] = await db
              .select({
                label: permitGates.label,
                contactName: permitGates.contactName,
                gateKey: permitGates.gateKey,
              })
              .from(permitGates)
              .where(and(
                eq(permitGates.organizationId, orgId),
                eq(permitGates.checklistId, beforeGate.checklistId),
                gt(permitGates.sequence, beforeGate.sequence),
              ))
              .orderBy(asc(permitGates.sequence))
              .limit(1);

            const tpl = parcel?.templateKey ? TEMPLATE_BY_KEY.get(parcel.templateKey) : null;
            const nextStageDays =
              nextGate && tpl
                ? tpl.gates.find((g) => g.gateKey === nextGate.gateKey)?.expectedDays ?? null
                : null;

            if (parcel) {
              emitPermitGateApproved(beforeGate.status, updated, {
                propertyAddress: parcel.address ?? `${parcel.county}, ${parcel.state}`,
                parentParcelId: parcel.parentParcelId,
                nextStage: nextGate?.label ?? null,
                nextVendor: nextGate?.contactName ?? null,
                nextStageDays,
              });
            }
          } catch (err) {
            logger.warn("[SD-3] subdivision.vendor_milestone emit resolution failed", {
              gateId,
              orgId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return res.json({ gate: updated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/permits/stalled — Brigid: "Williamson preliminary plat usually
  // returns in 45 days; if I'm at day 60 I want a yellow flag, not silence."
  app.get(
    "/api/permits/stalled",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const today = new Date().toISOString().slice(0, 10);

        const stalled = await db
          .select({
            id: permitGates.id,
            gateKey: permitGates.gateKey,
            label: permitGates.label,
            status: permitGates.status,
            submittedAt: permitGates.submittedAt,
            expectedReturnAt: permitGates.expectedReturnAt,
            checklistId: permitGates.checklistId,
            contactName: permitGates.contactName,
          })
          .from(permitGates)
          .where(and(
            eq(permitGates.organizationId, orgId),
            sql`${permitGates.status} IN ('submitted', 'in_review')`,
            sql`${permitGates.expectedReturnAt} IS NOT NULL`,
            lte(permitGates.expectedReturnAt, today),
          ))
          .orderBy(asc(permitGates.expectedReturnAt));

        return res.json({
          count: stalled.length,
          stalled,
          asOf: today,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

// ----------------------------------------------------------------------------
// Helper
// ----------------------------------------------------------------------------

function isStalledGate(g: { status: string; expectedReturnAt: string | null }): boolean {
  if (!g.expectedReturnAt) return false;
  if (g.status !== "submitted" && g.status !== "in_review") return false;
  const today = new Date();
  const expected = new Date(g.expectedReturnAt);
  return expected.getTime() < today.getTime();
}
