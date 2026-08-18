/**
 * T187 — Lead Enrichment Routes
 *
 * POST /api/leads/:id/enrich        — enrich a single lead
 * POST /api/leads/bulk-enrich       — enrich multiple leads (max 50)
 * GET  /api/leads/:id/completeness  — get contact completeness score
 */

import { Router, type Request, type Response } from "express";
import { enrichLead, batchEnrichLeads, calculateContactCompleteness } from "./services/leadEnrichment";
import { db } from "./db";
import { leads } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { Errors } from "./utils/errors";

const router = Router();


// POST /api/leads/:id/enrich — enrich a single lead
router.post("/:id/enrich", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");

    const result = await enrichLead(org.id, leadId);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /api/leads/bulk-enrich — enrich multiple leads
router.post("/bulk-enrich", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { leadIds } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return Errors.badRequest(res, "leadIds must be a non-empty array");
    }
    if (leadIds.length > 50) {
      return Errors.badRequest(res, "Cannot enrich more than 50 leads at once");
    }
    const ids = leadIds.map(Number).filter(n => !isNaN(n));
    if (ids.length !== leadIds.length) {
      return Errors.badRequest(res, "All leadIds must be valid integers");
    }

    const result = await batchEnrichLeads(ids, org.id);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /api/leads/:id/completeness — contact completeness score
router.get("/:id/completeness", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, org.id)))
      .limit(1);

    if (!lead) return Errors.notFound(res, "Lead");

    // The leads table has a single `address` column (no separate mailing vs
    // property address). TODO(tsc): add leads.propertyAddress (or a property
    // join) to score property-address completeness independently.
    const score = calculateContactCompleteness({
      email: lead.email,
      phone: lead.phone,
      firstName: lead.firstName,
      lastName: lead.lastName,
      address: lead.address,
    });

    res.json({ leadId, completenessScore: score });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
