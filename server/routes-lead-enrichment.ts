// @ts-nocheck
/**
 * T187 — Lead Enrichment Routes
 *
 * POST /api/leads/:id/enrich        — enrich a single lead
 * POST /api/leads/bulk-enrich       — enrich multiple leads (max 50)
 * GET  /api/leads/:id/completeness  — get contact completeness score
 */

import { Router, type Request, type Response } from "express";
import { getOrCreateOrg } from "./middleware/orgMiddleware";
import { enrichLead, batchEnrichLeads, calculateContactCompleteness } from "./services/leadEnrichment";
import { db } from "./db";
import { leads } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

function getOrg(req: Request) {
  return (req as any).org;
}

// POST /api/leads/:id/enrich — enrich a single lead
router.post("/:id/enrich", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });

    const result = await enrichLead(leadId, org.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/bulk-enrich — enrich multiple leads
router.post("/bulk-enrich", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { leadIds } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: "leadIds must be a non-empty array" });
    }
    if (leadIds.length > 50) {
      return res.status(400).json({ error: "Cannot enrich more than 50 leads at once" });
    }
    const ids = leadIds.map(Number).filter(n => !isNaN(n));
    if (ids.length !== leadIds.length) {
      return res.status(400).json({ error: "All leadIds must be valid integers" });
    }

    const result = await batchEnrichLeads(ids, org.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id/completeness — contact completeness score
router.get("/:id/completeness", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const leadId = parseInt(req.params.id);
    if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.organizationId, org.id)))
      .limit(1);

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const score = calculateContactCompleteness({
      email: lead.email,
      phone: lead.phone,
      firstName: lead.firstName,
      lastName: lead.lastName,
      address: (lead as any).mailingAddress ?? null,
      propertyAddress: lead.propertyAddress ?? null,
    });

    res.json({ leadId, completenessScore: score });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
