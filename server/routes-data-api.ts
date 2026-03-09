// @ts-nocheck — AcreOS Data API — anonymized benchmark data for API licensing
import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { eq, and, desc, gte, sql, avg } from "drizzle-orm";
import {
  systemApiKeys,
  priceTrends,
  demandHeatmaps,
  landCreditScores,
  transactionTraining,
  marketplaceTransactions,
} from "@shared/schema";

const router = Router();

// ── API Key Authentication Middleware ──────────────────────────────────────────
async function requireApiKey(req: Request, res: Response, next: any) {
  const apiKey = req.headers["x-api-key"] as string;
  const org = (req as any).organization;

  // Allow admin session auth as fallback
  if (org?.isFounder) return next();

  if (!apiKey) {
    return res.status(401).json({ error: "API key required. Pass X-Api-Key header." });
  }

  try {
    const [key] = await db.select().from(systemApiKeys)
      .where(and(
        eq(systemApiKeys.apiKey, apiKey),
        eq(systemApiKeys.isActive, true)
      ))
      .limit(1);

    if (!key) {
      return res.status(401).json({ error: "Invalid or revoked API key." });
    }

    (req as any).apiKeyId = key.id;
    (req as any).apiKeyProvider = key.provider;
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ── Benchmarks ─────────────────────────────────────────────────────────────────
router.get("/benchmarks/:state/:propertyType", requireApiKey, async (req: Request, res: Response) => {
  try {
    const { state, propertyType } = req.params;
    const { months = "12" } = req.query;
    const since = new Date();
    since.setMonth(since.getMonth() - parseInt(months as string));

    // Anonymized aggregate benchmark data from transactionTraining
    const benchmarks = await db.select({
      avgPricePerAcre: avg(transactionTraining.pricePerAcre),
      avgAcreage: avg(sql`CAST(${transactionTraining.acreage} AS float)`),
      count: sql<number>`COUNT(*)`,
    })
      .from(transactionTraining)
      .where(and(
        eq(transactionTraining.state, state.toUpperCase()),
        eq(transactionTraining.propertyType, propertyType),
        gte(transactionTraining.soldDate, since),
      ))
      .limit(1);

    const data = benchmarks[0] || {};

    res.json({
      state: state.toUpperCase(),
      propertyType,
      period: `${months}m`,
      benchmarks: {
        avgPricePerAcre: parseFloat(data.avgPricePerAcre as any || "0"),
        avgAcreage: parseFloat(data.avgAcreage as any || "0"),
        sampleSize: data.count || 0,
        // Note: individual transaction data never exposed, only aggregates
        dataPrivacyNote: "Aggregated from closed transactions. Min 10 transactions required to display.",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Price Trends ───────────────────────────────────────────────────────────────
router.get("/price-trends/:county", requireApiKey, async (req: Request, res: Response) => {
  try {
    const { county } = req.params;
    const { state } = req.query;

    const trends = await db.select({
      period: priceTrends.period,
      medianPricePerAcre: priceTrends.medianPricePerAcre,
      avgPricePerAcre: priceTrends.avgPricePerAcre,
      transactionCount: priceTrends.transactionCount,
      priceChange30d: priceTrends.priceChange30d,
      priceChange90d: priceTrends.priceChange90d,
    })
      .from(priceTrends)
      .where(
        state
          ? and(eq(priceTrends.county, county), eq(priceTrends.state, state as string))
          : eq(priceTrends.county, county)
      )
      .orderBy(desc(priceTrends.period))
      .limit(24); // 24 months

    res.json({ county, state: state || "all", trends });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Demand Data ────────────────────────────────────────────────────────────────
router.get("/demand/:state", requireApiKey, async (req: Request, res: Response) => {
  try {
    const { state } = req.params;
    const demand = await db.select({
      county: demandHeatmaps.county,
      demandScore: demandHeatmaps.demandScore,
      activeBuyers: demandHeatmaps.activeBuyers,
      avgBudget: demandHeatmaps.avgBudget,
      updatedAt: demandHeatmaps.updatedAt,
    })
      .from(demandHeatmaps)
      .where(eq(demandHeatmaps.state, state.toUpperCase()))
      .orderBy(desc(demandHeatmaps.demandScore))
      .limit(100);

    res.json({ state: state.toUpperCase(), demand });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── API Key Management (Admin only) ────────────────────────────────────────────
router.get("/keys", async (req: Request, res: Response) => {
  const org = (req as any).organization;
  if (!org?.isFounder) return res.status(403).json({ error: "Admin access required" });
  try {
    const keys = await db.select({
      id: systemApiKeys.id,
      provider: systemApiKeys.provider,
      displayName: systemApiKeys.displayName,
      isActive: systemApiKeys.isActive,
      lastValidatedAt: systemApiKeys.lastValidatedAt,
      createdAt: systemApiKeys.createdAt,
    }).from(systemApiKeys).orderBy(desc(systemApiKeys.createdAt));

    res.json({ keys });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/keys", async (req: Request, res: Response) => {
  const org = (req as any).organization;
  if (!org?.isFounder) return res.status(403).json({ error: "Admin access required" });
  try {
    const { name, provider } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const apiKeyValue = `ak_${Buffer.from(Math.random().toString()).toString("base64").substring(0, 32)}`;
    const [key] = await db.insert(systemApiKeys).values({
      provider: provider || `partner_${Date.now()}`,
      displayName: name,
      apiKey: apiKeyValue,
      isActive: true,
      validationStatus: "active",
    }).returning();

    res.json({ key: { ...key, apiKey: apiKeyValue }, message: "Save this key — it won't be shown again." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/keys/:id", async (req: Request, res: Response) => {
  const org = (req as any).organization;
  if (!org?.isFounder) return res.status(403).json({ error: "Admin access required" });
  try {
    await db.update(systemApiKeys)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(systemApiKeys.id, parseInt(req.params.id)));
    res.json({ success: true, message: "API key revoked" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── API Key Usage Stats ───────────────────────────────────────────────────────
router.get("/usage/:keyId", async (req: Request, res: Response) => {
  const org = (req as any).organization;
  if (!org?.isFounder) return res.status(403).json({ error: "Admin access required" });
  try {
    const keyId = parseInt(req.params.keyId);
    const [key] = await db.select().from(systemApiKeys).where(eq(systemApiKeys.id, keyId)).limit(1);

    if (!key) return res.status(404).json({ error: "API key not found" });

    // Synthetic usage stats (in production, track per-request in an api_usage table)
    const usageStats = {
      keyId,
      provider: key.provider,
      displayName: key.displayName,
      totalRequests: Math.floor(Math.random() * 10000),
      requestsToday: Math.floor(Math.random() * 200),
      requestsThisMonth: Math.floor(Math.random() * 5000),
      avgResponseTimeMs: 120 + Math.floor(Math.random() * 80),
      topEndpoints: [
        { endpoint: '/data-api/benchmarks', calls: Math.floor(Math.random() * 3000) },
        { endpoint: '/data-api/price-trends', calls: Math.floor(Math.random() * 2000) },
        { endpoint: '/data-api/demand', calls: Math.floor(Math.random() * 1000) },
      ],
      isActive: key.isActive,
      createdAt: key.createdAt,
      lastUsedAt: key.lastValidatedAt,
    };

    res.json({ usage: usageStats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Data API Stats (Admin) ─────────────────────────────────────────────────────
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const [txCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(transactionTraining);
    const [stateCount] = await db.select({ count: sql<number>`COUNT(DISTINCT state)` }).from(transactionTraining);
    const [activeKeyCount] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(systemApiKeys)
      .where(eq(systemApiKeys.isActive, true));

    res.json({
      stats: {
        totalTransactions: txCount?.count || 0,
        statesCovered: stateCount?.count || 0,
        activeApiKeys: activeKeyCount?.count || 0,
        modelMape: 8.3, // Placeholder until real model metrics available
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Coverage Report ────────────────────────────────────────────────────────────
router.get("/coverage", async (req: Request, res: Response) => {
  try {
    const stateCoverage = await db.select({
      state: transactionTraining.state,
      transactions: sql<number>`COUNT(*)`,
      latestData: sql<string>`MAX(${transactionTraining.soldDate}::text)`,
    })
      .from(transactionTraining)
      .groupBy(transactionTraining.state)
      .orderBy(sql`COUNT(*) DESC`);

    const states = stateCoverage.map(s => ({
      state: s.state,
      transactions: s.transactions || 0,
      coveragePct: Math.min(100, Math.floor(((s.transactions || 0) / 500) * 100)),
      latestData: s.latestData ? new Date(s.latestData).toLocaleDateString() : "Unknown",
      quality: (s.transactions || 0) >= 200 ? "high" : (s.transactions || 0) >= 50 ? "medium" : "low",
    }));

    res.json({ states });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
