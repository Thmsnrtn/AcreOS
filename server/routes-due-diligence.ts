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
import {
  dueDiligencePodService,
  DueDiligenceNotInOrgError,
} from "./services/dueDiligencePods";
import { Errors } from "./utils/errors";
import { getOrganizationId } from "./types/request";

const router = Router();

/**
 * A dossier or property id that is not this org's answers 404, not 403.
 *
 * Four handlers below carried `isAuthenticated` and NOTHING ELSE — no
 * `getOrCreateOrg` — while seven others in this same file had it and passed
 * `org.id`. The split ran along the URL parameter: handlers keyed by
 * `:propertyId` were gated, handlers keyed by a dossier `:id` were not.
 */
function refuse(res: Response, err: unknown, fallback: (message: string) => void): void {
  if (err instanceof DueDiligenceNotInOrgError) {
    Errors.notFound(res, "Dossier");
    return;
  }
  fallback(err instanceof Error ? err.message : "Bad request");
}

// Request a full due diligence dossier
router.post("/request/:propertyId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const dossier = await dueDiligencePodService.requestDossier(org.id, propertyId, req.body);
    res.status(201).json({ dossier });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Get dossier by ID
router.get("/dossier/:id", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid dossier ID");
    const dossier = await dueDiligencePodService.getDossier(id, getOrganizationId(req));
    if (!dossier) return Errors.notFound(res, "Dossier");
    res.json({ dossier });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Get all dossiers for a property
router.get("/property/:propertyId", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const dossiers = await dueDiligencePodService.getPropertyDossiers(org.id, propertyId);
    res.json({ dossiers });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Run/refresh a dossier
router.post("/:id/run", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid dossier ID");
    const dossier = await dueDiligencePodService.runDossierPod(id, getOrganizationId(req));
    res.json({ dossier });
  } catch (err: any) {
    // runDossierPod is the only method here that THROWS on a foreign id — the
    // research methods return their "Property not found" default, which is the
    // same answer a genuinely missing property gets, and the reads return null
    // into an existing 404. Without this branch the refusal would surface as a
    // 400 carrying the words "not found in this organization".
    refuse(res, err, (m) => Errors.badRequest(res, m));
  }
});

// Title research
router.get("/:propertyId/title", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchTitle(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Tax research
router.get("/:propertyId/tax", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchTax(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Environmental research
router.get("/:propertyId/environmental", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchEnvironmental(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Zoning research
router.get("/:propertyId/zoning", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchZoning(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Access research
router.get("/:propertyId/access", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchAccess(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Comparable sales
router.get("/:propertyId/comps", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchComps(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Owner research
router.get("/:propertyId/owner", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const findings = await dueDiligencePodService.researchOwner(propertyId, getOrganizationId(req));
    res.json({ findings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Executive summary for a dossier
router.get("/dossier/:id/summary", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid dossier ID");
    const dossier = await dueDiligencePodService.getDossier(id, getOrganizationId(req));
    if (!dossier) return Errors.notFound(res, "Dossier");
    const summary = await dueDiligencePodService.aggregateToExecutiveSummary(dossier);
    res.json({ summary });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Go/No-go recommendation
router.get("/dossier/:id/recommendation", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid dossier ID");
    const dossier = await dueDiligencePodService.getDossier(id, getOrganizationId(req));
    if (!dossier) return Errors.notFound(res, "Dossier");
    // generateRecommendation takes the calculated scores + findings, both
    // persisted on the dossier row (was incorrectly called with the whole row).
    const scores = {
      investabilityScore: dossier.investabilityScore ?? 0,
      riskScore: dossier.riskScore ?? 0,
      breakdown: dossier.scoreBreakdown ?? {},
    } as Parameters<typeof dueDiligencePodService.generateRecommendation>[0];
    const recommendation = await dueDiligencePodService.generateRecommendation(
      scores,
      (dossier.findings ?? {}) as Parameters<typeof dueDiligencePodService.generateRecommendation>[1],
    );
    res.json({ recommendation });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// =====================
// FULL DD REPORT PDF (6 pages)
// =====================

router.get("/:propertyId/dd-report", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.propertyId);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    const { generateFullReport } = await import("./services/dueDiligenceReportGenerator");
    const result = await generateFullReport(propertyId, org.id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=dd-report-${propertyId}.pdf`);
    res.send(result.pdf);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// =====================
// PUBLIC DD PREVIEW (lead magnet) — no auth, rate limited
// =====================

const previewRateLimits = new Map<string, { count: number; date: string }>();

router.post("/public/dd-preview", async (req: Request, res: Response) => {
  try {
    const { apn, state, email } = req.body;
    if (!apn || !state) return Errors.badRequest(res, "apn and state are required");

    // Rate limit: 3/day per IP, 10/day per email
    const ip = req.ip || "unknown";
    const today = new Date().toISOString().slice(0, 10);
    const ipKey = `ip:${ip}`;
    const ipEntry = previewRateLimits.get(ipKey);

    if (ipEntry && ipEntry.date === today && ipEntry.count >= 3) {
      return res.status(429).json({ error: "Preview limit reached. Sign up for unlimited reports." });
    }

    if (!ipEntry || ipEntry.date !== today) {
      previewRateLimits.set(ipKey, { count: 1, date: today });
    } else {
      ipEntry.count++;
    }

    if (email) {
      const emailKey = `email:${email}`;
      const emailEntry = previewRateLimits.get(emailKey);
      if (emailEntry && emailEntry.date === today && emailEntry.count >= 10) {
        return res.status(429).json({ error: "Email preview limit reached." });
      }
      if (!emailEntry || emailEntry.date !== today) {
        previewRateLimits.set(emailKey, { count: 1, date: today });
      } else {
        emailEntry.count++;
      }
    }

    const { generatePreviewReport } = await import("./services/dueDiligenceReportGenerator");
    const pdf = await generatePreviewReport(apn, state);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=dd-preview-${apn}.pdf`);
    res.send(pdf);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
