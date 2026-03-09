/**
 * Vision AI Unit Tests
 *
 * Tests visual intelligence processing logic:
 * - Photo quality scoring
 * - Structure detection logic
 * - Vegetation analysis
 * - Before/after comparison
 * - Batch processing
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

type PhotoQuality = "excellent" | "good" | "fair" | "poor";
type LandscapeType = "forest" | "grassland" | "desert" | "mixed" | "mountainous" | "wetland" | "agricultural";

interface PhotoAnalysisResult {
  detectedFeatures: string[];
  landscapeType: LandscapeType;
  buildingDetected: boolean;
  roadDetected: boolean;
  waterDetected: boolean;
  photoQuality: PhotoQuality;
  isUsableForMarketing: boolean;
  aiDescription: string;
  estimatedAcreageVisible: number | null;
  vegetationDensity: number; // 0-100
  confidence: number; // 0-100
}

interface ChangeDetectionResult {
  changeDetected: boolean;
  changeType: string | null;
  changeSeverity: "none" | "minor" | "moderate" | "major" | null;
  confidence: number;
}

interface BatchResult {
  photoId: number;
  status: "success" | "failed" | "skipped";
  result?: PhotoAnalysisResult;
  error?: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function scorePhotoQuality(
  metadata: {
    resolution: { width: number; height: number };
    blurScore: number; // 0-100 (100 = sharp)
    brightnessScore: number; // 0-100 (50 = ideal)
    hasWatermark: boolean;
  }
): { quality: PhotoQuality; score: number; isUsable: boolean } {
  let score = 0;

  // Resolution
  const megapixels = (metadata.resolution.width * metadata.resolution.height) / 1_000_000;
  if (megapixels >= 8) score += 30;
  else if (megapixels >= 4) score += 20;
  else if (megapixels >= 1) score += 10;

  // Sharpness
  if (metadata.blurScore >= 80) score += 30;
  else if (metadata.blurScore >= 60) score += 20;
  else if (metadata.blurScore >= 40) score += 10;

  // Brightness (penalize very dark or very bright)
  const brightnessDeviation = Math.abs(metadata.brightnessScore - 50);
  if (brightnessDeviation <= 10) score += 25;
  else if (brightnessDeviation <= 20) score += 15;
  else if (brightnessDeviation <= 35) score += 5;

  // Watermark penalty
  if (metadata.hasWatermark) score -= 20;

  score = Math.max(0, Math.min(100, score));

  const quality: PhotoQuality =
    score >= 75 ? "excellent" :
    score >= 55 ? "good" :
    score >= 35 ? "fair" :
    "poor";

  return { quality, score, isUsable: score >= 35 && !metadata.hasWatermark };
}

function detectStructures(
  features: string[]
): { hasBuildingOrStructure: boolean; structureTypes: string[] } {
  const buildingKeywords = ["house", "barn", "shed", "silo", "cabin", "garage", "outbuilding", "warehouse"];
  const detected = features.filter(f =>
    buildingKeywords.some(kw => f.toLowerCase().includes(kw))
  );
  return {
    hasBuildingOrStructure: detected.length > 0,
    structureTypes: detected,
  };
}

function analyzeVegetation(
  vegetationDensity: number,
  features: string[]
): {
  category: "sparse" | "moderate" | "dense";
  dominantType: string;
  hasTimber: boolean;
} {
  const category =
    vegetationDensity >= 70 ? "dense" :
    vegetationDensity >= 30 ? "moderate" :
    "sparse";

  const timberKeywords = ["pine", "oak", "timber", "forest", "trees", "woodland"];
  const hasTimber = features.some(f =>
    timberKeywords.some(kw => f.toLowerCase().includes(kw))
  );

  const grassKeywords = ["grass", "pasture", "hay", "meadow"];
  const isGrass = features.some(f => grassKeywords.some(kw => f.toLowerCase().includes(kw)));

  const dominantType = hasTimber ? "timber/trees" : isGrass ? "grass/pasture" : "mixed vegetation";

  return { category, dominantType, hasTimber };
}

function compareBeforeAfter(
  before: Pick<PhotoAnalysisResult, "vegetationDensity" | "detectedFeatures" | "buildingDetected">,
  after: Pick<PhotoAnalysisResult, "vegetationDensity" | "detectedFeatures" | "buildingDetected">
): ChangeDetectionResult {
  const vegDelta = Math.abs(after.vegetationDensity - before.vegetationDensity);

  const newBuilding = after.buildingDetected && !before.buildingDetected;
  const removedBuilding = before.buildingDetected && !after.buildingDetected;

  const newFeatures = after.detectedFeatures.filter(f => !before.detectedFeatures.includes(f));
  const removedFeatures = before.detectedFeatures.filter(f => !after.detectedFeatures.includes(f));
  const featureChangeCount = newFeatures.length + removedFeatures.length;

  if (vegDelta < 5 && !newBuilding && !removedBuilding && featureChangeCount === 0) {
    return { changeDetected: false, changeType: null, changeSeverity: "none", confidence: 90 };
  }

  let changeType = "vegetation_change";
  if (newBuilding) changeType = "structure_added";
  else if (removedBuilding) changeType = "structure_removed";
  else if (featureChangeCount > 3) changeType = "significant_land_change";

  const changeSeverity =
    (vegDelta >= 30 || newBuilding || removedBuilding || featureChangeCount > 5) ? "major" :
    (vegDelta >= 15 || featureChangeCount > 2) ? "moderate" :
    "minor";

  return {
    changeDetected: true,
    changeType,
    changeSeverity,
    confidence: 75,
  };
}

function processBatch(
  photos: Array<{ id: number; url: string; skip?: boolean }>,
  analyzePhoto: (url: string) => PhotoAnalysisResult | null
): BatchResult[] {
  return photos.map(photo => {
    if (photo.skip) {
      return { photoId: photo.id, status: "skipped" };
    }
    try {
      const result = analyzePhoto(photo.url);
      if (!result) throw new Error("Analysis returned null");
      return { photoId: photo.id, status: "success", result };
    } catch (err: any) {
      return { photoId: photo.id, status: "failed", error: err.message };
    }
  });
}

function isUsableForMarketing(analysis: PhotoAnalysisResult): boolean {
  if (analysis.photoQuality === "poor") return false;
  if (analysis.vegetationDensity < 5 && analysis.detectedFeatures.length === 0) return false;
  if (analysis.confidence < 30) return false;
  return true;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Photo Quality Scoring", () => {
  it("scores excellent for high-res, sharp, well-lit photo", () => {
    const result = scorePhotoQuality({
      resolution: { width: 4000, height: 3000 }, // 12MP
      blurScore: 90,
      brightnessScore: 50,
      hasWatermark: false,
    });
    expect(result.quality).toBe("excellent");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.isUsable).toBe(true);
  });

  it("scores poor for low-res, blurry photo", () => {
    const result = scorePhotoQuality({
      resolution: { width: 320, height: 240 }, // 0.077MP
      blurScore: 15,
      brightnessScore: 10,
      hasWatermark: false,
    });
    expect(result.quality).toBe("poor");
    expect(result.isUsable).toBe(false);
  });

  it("penalizes watermarked photos", () => {
    const noWatermark = scorePhotoQuality({
      resolution: { width: 2000, height: 1500 },
      blurScore: 75,
      brightnessScore: 50,
      hasWatermark: false,
    });
    const watermarked = scorePhotoQuality({
      resolution: { width: 2000, height: 1500 },
      blurScore: 75,
      brightnessScore: 50,
      hasWatermark: true,
    });
    expect(noWatermark.score).toBeGreaterThan(watermarked.score);
    expect(watermarked.isUsable).toBe(false);
  });

  it("penalizes photos that are too dark or too bright", () => {
    const ideal = scorePhotoQuality({ resolution: { width: 2000, height: 1500 }, blurScore: 80, brightnessScore: 50, hasWatermark: false });
    const tooDark = scorePhotoQuality({ resolution: { width: 2000, height: 1500 }, blurScore: 80, brightnessScore: 5, hasWatermark: false });
    const tooBright = scorePhotoQuality({ resolution: { width: 2000, height: 1500 }, blurScore: 80, brightnessScore: 95, hasWatermark: false });
    expect(ideal.score).toBeGreaterThan(tooDark.score);
    expect(ideal.score).toBeGreaterThan(tooBright.score);
  });

  it("classifies correctly at each tier boundary", () => {
    expect(scorePhotoQuality({ resolution: { width: 4000, height: 3000 }, blurScore: 90, brightnessScore: 50, hasWatermark: false }).quality).toBe("excellent");
    expect(scorePhotoQuality({ resolution: { width: 2000, height: 1000 }, blurScore: 65, brightnessScore: 55, hasWatermark: false }).quality).toBe("good");
  });
});

describe("Structure Detection Logic", () => {
  it("detects barn in feature list", () => {
    const result = detectStructures(["grass", "trees", "old barn", "fence"]);
    expect(result.hasBuildingOrStructure).toBe(true);
    expect(result.structureTypes.some(s => s.includes("barn"))).toBe(true);
  });

  it("detects house in feature list", () => {
    const result = detectStructures(["farmhouse", "pasture", "pond"]);
    expect(result.hasBuildingOrStructure).toBe(true);
  });

  it("returns no structure for natural land features", () => {
    const result = detectStructures(["grass", "trees", "creek", "rolling hills"]);
    expect(result.hasBuildingOrStructure).toBe(false);
    expect(result.structureTypes).toHaveLength(0);
  });

  it("detects multiple structures", () => {
    const result = detectStructures(["house", "barn", "shed", "pasture"]);
    expect(result.structureTypes.length).toBeGreaterThanOrEqual(3);
  });

  it("is case-insensitive for feature matching", () => {
    const result = detectStructures(["BARN", "SILO"]);
    expect(result.hasBuildingOrStructure).toBe(true);
  });
});

describe("Vegetation Analysis", () => {
  it("classifies dense vegetation at 70%+", () => {
    const result = analyzeVegetation(80, ["oak trees", "dense forest"]);
    expect(result.category).toBe("dense");
  });

  it("classifies moderate vegetation at 30-69%", () => {
    const result = analyzeVegetation(50, ["scattered trees", "pasture"]);
    expect(result.category).toBe("moderate");
  });

  it("classifies sparse vegetation below 30%", () => {
    const result = analyzeVegetation(10, ["rocky terrain", "sparse brush"]);
    expect(result.category).toBe("sparse");
  });

  it("identifies timber presence from features", () => {
    const result = analyzeVegetation(65, ["pine trees", "timber stand"]);
    expect(result.hasTimber).toBe(true);
  });

  it("identifies grass/pasture as dominant type", () => {
    const result = analyzeVegetation(30, ["green pasture", "hay field"]);
    expect(result.dominantType).toContain("grass");
    expect(result.hasTimber).toBe(false);
  });

  it("uses mixed vegetation when type is ambiguous", () => {
    const result = analyzeVegetation(40, ["scrub brush", "rocky outcrops"]);
    expect(result.dominantType).toBe("mixed vegetation");
  });
});

describe("Before/After Comparison", () => {
  const baseBefore = {
    vegetationDensity: 60,
    detectedFeatures: ["grass", "trees", "fence"],
    buildingDetected: false,
  };

  it("detects no change when features are identical", () => {
    const result = compareBeforeAfter(baseBefore, { ...baseBefore });
    expect(result.changeDetected).toBe(false);
    expect(result.changeSeverity).toBe("none");
  });

  it("detects major change when new building added", () => {
    const after = { ...baseBefore, buildingDetected: true };
    const result = compareBeforeAfter(baseBefore, after);
    expect(result.changeDetected).toBe(true);
    expect(result.changeType).toBe("structure_added");
    expect(result.changeSeverity).toBe("major");
  });

  it("detects building removal", () => {
    const before = { ...baseBefore, buildingDetected: true };
    const after = { ...baseBefore, buildingDetected: false };
    const result = compareBeforeAfter(before, after);
    expect(result.changeType).toBe("structure_removed");
  });

  it("detects major vegetation change (>30% delta)", () => {
    const after = { ...baseBefore, vegetationDensity: 15 };
    const result = compareBeforeAfter(baseBefore, after);
    expect(result.changeDetected).toBe(true);
    expect(result.changeSeverity).toBe("major");
  });

  it("detects minor vegetation change", () => {
    const after = { ...baseBefore, vegetationDensity: 65 }; // +5 points
    const result = compareBeforeAfter(baseBefore, after);
    expect(result.changeDetected).toBe(true);
    expect(result.changeSeverity).toBe("minor");
  });

  it("detects significant feature change when many features added/removed", () => {
    const after = {
      ...baseBefore,
      detectedFeatures: ["water", "pond", "wetland", "marsh", "reeds", "herons", "cattails"],
    };
    const result = compareBeforeAfter(baseBefore, after);
    expect(result.changeDetected).toBe(true);
    expect(result.changeType).toBe("significant_land_change");
  });
});

describe("Batch Processing", () => {
  const makeAnalysis = (): PhotoAnalysisResult => ({
    detectedFeatures: ["grass", "trees"],
    landscapeType: "grassland",
    buildingDetected: false,
    roadDetected: false,
    waterDetected: false,
    photoQuality: "good",
    isUsableForMarketing: true,
    aiDescription: "Rolling grassland with scattered trees.",
    estimatedAcreageVisible: 50,
    vegetationDensity: 60,
    confidence: 85,
  });

  it("processes all photos and returns results", () => {
    const photos = [
      { id: 1, url: "https://example.com/1.jpg" },
      { id: 2, url: "https://example.com/2.jpg" },
    ];
    const results = processBatch(photos, () => makeAnalysis());
    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === "success")).toBe(true);
  });

  it("marks photo as failed when analysis throws", () => {
    const photos = [{ id: 99, url: "https://example.com/bad.jpg" }];
    const results = processBatch(photos, () => { throw new Error("API timeout"); });
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("API timeout");
  });

  it("skips photos flagged with skip=true", () => {
    const photos = [
      { id: 1, url: "https://example.com/1.jpg", skip: true },
      { id: 2, url: "https://example.com/2.jpg" },
    ];
    const results = processBatch(photos, () => makeAnalysis());
    expect(results.find(r => r.photoId === 1)?.status).toBe("skipped");
    expect(results.find(r => r.photoId === 2)?.status).toBe("success");
  });

  it("continues processing remaining photos after a failure", () => {
    let callCount = 0;
    const photos = [
      { id: 1, url: "bad" },
      { id: 2, url: "good" },
      { id: 3, url: "good" },
    ];
    const results = processBatch(photos, url => {
      callCount++;
      if (url === "bad") throw new Error("fail");
      return makeAnalysis();
    });
    expect(results[0].status).toBe("failed");
    expect(results[1].status).toBe("success");
    expect(results[2].status).toBe("success");
    expect(callCount).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(processBatch([], () => makeAnalysis())).toHaveLength(0);
  });
});

describe("Marketing Usability Check", () => {
  const baseAnalysis: PhotoAnalysisResult = {
    detectedFeatures: ["grass", "trees"],
    landscapeType: "grassland",
    buildingDetected: false,
    roadDetected: false,
    waterDetected: false,
    photoQuality: "good",
    isUsableForMarketing: true,
    aiDescription: "Lush green pastureland.",
    estimatedAcreageVisible: 20,
    vegetationDensity: 55,
    confidence: 80,
  };

  it("marks good-quality photo as usable", () => {
    expect(isUsableForMarketing(baseAnalysis)).toBe(true);
  });

  it("marks poor-quality photo as not usable", () => {
    expect(isUsableForMarketing({ ...baseAnalysis, photoQuality: "poor" })).toBe(false);
  });

  it("marks low-confidence analysis as not usable", () => {
    expect(isUsableForMarketing({ ...baseAnalysis, confidence: 20 })).toBe(false);
  });

  it("marks featureless photo with zero vegetation as not usable", () => {
    expect(isUsableForMarketing({ ...baseAnalysis, vegetationDensity: 0, detectedFeatures: [] })).toBe(false);
  });
});
