// @ts-nocheck
/**
 * T148 — Due Diligence Pods Routes
 *
 * POST /api/due-diligence/request/:propertyId      — request full dossier
 * GET  /api/due-diligence/dossier/:id              — get dossier by ID
 * GET  /api/due-diligence/property/:propertyId     — all dossiers for a property
 * POST /api/due-diligence/:id/run                  — run/refresh dossier
 * GET  /api/due-diligence/:propertyId/title        — title research only
 * GET  /api/due-diligence/:propertyId/tax          — tax research only
 * GET  /api/due-diligence/:propertyId/environmental — environmental research
 * GET  /api/due-diligence/:propertyId/zoning       — zoning research
 * GET  /api/due-diligence/:propertyId/access       — access research
 * GET  /api/due-diligence/:propertyId/comps        — comparable sales
 * GET  /api/due-diligence/:propertyId/owner        — owner research
 * GET  /api/due-diligence/dossier/:id/summary      — executive summary
 * GET  /api/due-diligence/dossier/:id/recommendation — go/no-go recommendation
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { dueDiligencePodService } from "./services/dueDiligencePods";

const router = Router();

// Request a full due diligence dossier
router.post("/request/:propertyId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = (req as any).organization;
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const dossier = await dueDiligencePodService.requestDossier(org.id, propertyId, req.body);
    res.status(201).json({ dossier });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get dossier by ID
router.get("/dossier/:id", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid dossier ID" });
    const dossier = await dueDiligencePodService.getDossier(id);
    if (!dossier) return res.status(404).json({ error: "Dossier not found" });
    res.json({ dossier });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all dossiers for a property
router.get("/property/:propertyId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = (req as any).organization;
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const dossiers = await dueDiligencePodService.getPropertyDossiers(org.id, propertyId);
    res.json({ dossiers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run/refresh a dossier
router.post("/:id/run", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid dossier ID" });
    const dossier = await dueDiligencePodService.runDossierPod(id);
    res.json({ dossier });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Title research
router.get("/:propertyId/title", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchTitle(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Tax research
router.get("/:propertyId/tax", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchTax(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Environmental research
router.get("/:propertyId/environmental", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchEnvironmental(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Zoning research
router.get("/:propertyId/zoning", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchZoning(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Access research
router.get("/:propertyId/access", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchAccess(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Comparable sales
router.get("/:propertyId/comps", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchComps(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Owner research
router.get("/:propertyId/owner", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const findings = await dueDiligencePodService.researchOwner(propertyId);
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Executive summary for a dossier
router.get("/dossier/:id/summary", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid dossier ID" });
    const dossier = await dueDiligencePodService.getDossier(id);
    if (!dossier) return res.status(404).json({ error: "Dossier not found" });
    const summary = await dueDiligencePodService.aggregateToExecutiveSummary(dossier);
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Go/No-go recommendation
router.get("/dossier/:id/recommendation", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid dossier ID" });
    const dossier = await dueDiligencePodService.getDossier(id);
    if (!dossier) return res.status(404).json({ error: "Dossier not found" });
    const recommendation = await dueDiligencePodService.generateRecommendation(dossier);
    res.json({ recommendation });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
