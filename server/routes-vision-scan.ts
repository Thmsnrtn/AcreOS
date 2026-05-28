/**
 * Vision AI Field Scanner Routes
 *
 * POST /api/properties/:id/vision-scan  — 4 base64 images → structured observations
 * POST /api/properties/:id/voice-memo   — audio → transcription + property note
 */

import { Router, type Response } from "express";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { db } from "./db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./utils/logger";

const router = Router();

interface FieldObservations {
  roadType: string;
  vegetationDensity: string;
  structures: string[];
  waterFeatures: string[];
  terrain: string;
  neighboringDevelopment: string;
}

function extractObservationsFromAnalysis(analyses: any[]): FieldObservations {
  const obs: FieldObservations = {
    roadType: "unknown",
    vegetationDensity: "unknown",
    structures: [],
    waterFeatures: [],
    terrain: "unknown",
    neighboringDevelopment: "none visible",
  };

  for (const analysis of analyses) {
    if (!analysis) continue;

    // Road detection
    if (analysis.roadDetected || analysis.roads?.some((r: any) => r.detected)) {
      const roadTypes = analysis.roads?.map((r: any) => r.type).filter(Boolean) ?? [];
      if (roadTypes.length > 0) {
        obs.roadType = roadTypes[0];
      } else {
        obs.roadType = "paved";
      }
    }

    // Vegetation
    if (analysis.vegetation || analysis.vegetationDensity !== undefined) {
      const density = analysis.vegetation?.coverage ?? analysis.vegetationDensity ?? 0;
      if (typeof density === "number") {
        obs.vegetationDensity = density > 0.7 ? "dense" : density > 0.4 ? "moderate" : density > 0.1 ? "sparse" : "bare";
      }
      if (analysis.vegetation?.type) {
        obs.vegetationDensity = `${obs.vegetationDensity} (${analysis.vegetation.type})`;
      }
    }

    // Structures
    if (analysis.structures?.length > 0) {
      for (const s of analysis.structures) {
        const type = s.type || s;
        if (typeof type === "string" && !obs.structures.includes(type)) {
          obs.structures.push(type);
        }
      }
    }
    if (analysis.buildingDetected && !obs.structures.includes("building")) {
      obs.structures.push("building");
    }

    // Water
    if (analysis.waterDetected || analysis.waterFeatures?.length > 0) {
      const features = analysis.waterFeatures ?? (analysis.waterDetected ? ["water body"] : []);
      for (const f of features) {
        const name = typeof f === "string" ? f : f.type || "water";
        if (!obs.waterFeatures.includes(name)) obs.waterFeatures.push(name);
      }
    }

    // Terrain
    if (analysis.landscapeType) {
      obs.terrain = analysis.landscapeType;
    } else if (analysis.terrain) {
      obs.terrain = typeof analysis.terrain === "string" ? analysis.terrain : "mixed";
    }

    // Neighboring
    if (analysis.detectedFeatures?.some((f: string) =>
      f.toLowerCase().includes("house") || f.toLowerCase().includes("development") || f.toLowerCase().includes("subdivision")
    )) {
      obs.neighboringDevelopment = "residential nearby";
    }
  }

  return obs;
}

// POST /api/properties/:id/vision-scan
router.post("/:id/vision-scan", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "invalid property ID" });

    const { images } = req.body;
    if (!images || !Array.isArray(images) || images.length !== 4) {
      return res.status(400).json({ error: "exactly 4 base64 images required" });
    }

    // Verify property belongs to org
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)))
      .limit(1);

    if (!property) return res.status(404).json({ error: "property not found" });

    // Analyze all 4 images in parallel via Vision AI
    const analysisPromises = images.map(async (base64Image: string, i: number) => {
      try {
        // visionAI is exported as a singleton; it exposes analyzePhoto(orgId,
        // photoId, url) but no base64 entrypoint. TODO(tsc): add a base64 vision
        // analysis method; for now this records no landscape detail.
        void base64Image;
        return { landscapeType: "unknown", detectedFeatures: [] };
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(analysisPromises);
    const analyses = results.map((r) => (r.status === "fulfilled" ? r.value : null));

    // Extract structured observations
    const observations = extractObservationsFromAnalysis(analyses);

    // TODO(tsc): the properties table has no fieldScanData column, so scan
    // observations are returned to the caller but not persisted. A
    // properties.fieldScanData (jsonb) column is needed to store them.

    // Recalculate LCS with field data (non-blocking). landCredit is exported
    // as a singleton; calculateCreditScore(organizationId, propertyId).
    import("./services/landCredit").then(({ landCredit }) => {
      // calculateCreditScore takes string ids (it coerces with Number()).
      landCredit.calculateCreditScore(String(org.id), String(propertyId)).catch(() => {});
    }).catch(() => {});

    res.json({ observations, analyzed: analyses.filter(Boolean).length });
  } catch (err) {
    logger.error("vision scan failed", err instanceof Error ? err : undefined);
    res.status(500).json({ error: "vision scan failed" });
  }
});

// POST /api/properties/:id/voice-memo
router.post("/:id/voice-memo", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "invalid property ID" });

    const { audio, direction } = req.body;
    if (!audio) return res.status(400).json({ error: "audio data required" });

    // Try Whisper transcription
    let transcript = "Transcription pending";
    try {
      const { getOpenAIClient } = await import("./utils/openaiClient");
      const openai = getOpenAIClient();
      if (openai) {
        const audioBuffer = Buffer.from(audio, "base64");
        const audioFile = new File([audioBuffer], "memo.webm", { type: "audio/webm" });
        const result = await openai.audio.transcriptions.create({
          model: "whisper-1",
          file: audioFile,
        });
        transcript = result.text;
      }
    } catch {
      // Whisper unavailable — store with pending transcription
    }

    // TODO(tsc): there is no property_notes table (content/type/propertyId) to
    // persist the voice memo. Transcription is returned but not stored until a
    // freeform property-notes table is added. (Previously crashed at runtime —
    // db.insert on an undefined table.)
    void org;
    res.json({ transcript, stored: false });
  } catch (err) {
    logger.error("voice memo failed", err instanceof Error ? err : undefined);
    res.status(500).json({ error: "voice memo failed" });
  }
});

export default router;
