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
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { addMonths } from "./utils/dateUtils";

const router = Router();

// Founder-session middleware for the ADMIN subset (roadmap W1.6). This router
// mounts WITHOUT session middleware (partner calls carry only x-api-key), so
// `req.organization` was always undefined here — the founder key-management
// endpoints failed closed (safe but unreachable) and /stats + /coverage were
// wide open. The admin routes now mount the session chain explicitly.
const founderOnly = [isAuthenticated, getOrCreateOrg, requireFounder] as const;

// ── API Key Authentication Middleware ──────────────────────────────────────────
// Hash-at-rest verification via services/dataApiKeys (W1.6): the presented
// key is hashed and looked up — no stored plaintext participates. Legacy
// plaintext rows verify once and upgrade themselves.
async function requireApiKey(req: Request, res: Response, next: any) {
  const apiKey = req.headers["x-api-key"] as string;

  if (!apiKey) {
    return Errors.unauthorized(res);
  }

  try {
    const { verifyApiKey } = await import("./services/dataApiKeys");
    const key = await verifyApiKey(apiKey);
    if (!key) {
      return Errors.unauthorized(res);
    }
    const keyedReq = req as Request & { apiKeyId?: number; apiKeyProvider?: string };
    keyedReq.apiKeyId = key.id;
    keyedReq.apiKeyProvider = key.provider;
    next();
  } catch (err: any) {
    logger.error("API key validation error", err);
    Errors.internal(res, err);
  }
}

// ── Benchmarks ─────────────────────────────────────────────────────────────────
router.get("/benchmarks/:state/:propertyType", requireApiKey, async (req: Request, res: Response) => {
  try {
    const { state, propertyType } = req.params;
    const { months = "12" } = req.query;
    const since = addMonths(new Date(), -parseInt(months as string));

    // Anonymized aggregate benchmark data from transactionTraining
    const benchmarks = await db.select({
      avgPricePerAcre: avg(transactionTraining.pricePerAcre),
      avgAcreage: avg(sql`CAST(${transactionTraining.sizeAcres} AS float)`),
      count: sql<number>`COUNT(*)`,
    })
      .from(transactionTraining)
      .where(and(
        eq(transactionTraining.state, state.toUpperCase()),
        eq(transactionTraining.propertyType, propertyType),
        gte(transactionTraining.saleDate, since),
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
    logger.error("Benchmarks error", err);
    Errors.internal(res, err);
  }
});

// ── Price Trends ───────────────────────────────────────────────────────────────
router.get("/price-trends/:county", requireApiKey, async (req: Request, res: Response) => {
  try {
    const { county } = req.params;
    const { state } = req.query;

    // Column mapping: price_trends exposes periodStart and a single
    // priceChange (%) column (no 30d/90d split).
    const trends = await db.select({
      period: priceTrends.periodStart,
      medianPricePerAcre: priceTrends.medianPricePerAcre,
      avgPricePerAcre: priceTrends.avgPricePerAcre,
      transactionCount: priceTrends.transactionCount,
      priceChange: priceTrends.priceChange,
    })
      .from(priceTrends)
      .where(
        state
          ? and(eq(priceTrends.county, county), eq(priceTrends.state, state as string))
          : eq(priceTrends.county, county)
      )
      .orderBy(desc(priceTrends.periodStart))
      .limit(24); // 24 months

    res.json({ county, state: state || "all", trends });
  } catch (err: any) {
    logger.error("Price trends error", err);
    Errors.internal(res, err);
  }
});

// ── Demand Data ────────────────────────────────────────────────────────────────
router.get("/demand/:state", requireApiKey, async (req: Request, res: Response) => {
  try {
    const { state } = req.params;
    // Column mapping: demand_heatmaps tracks engagement counts, not buyer
    // budgets. activeBuyers→inquiryCount (best proxy); no avgBudget column;
    // freshness via createdAt.
    const demand = await db.select({
      county: demandHeatmaps.county,
      demandScore: demandHeatmaps.demandScore,
      activeBuyers: demandHeatmaps.inquiryCount,
      avgBudget: sql<null>`NULL`,
      updatedAt: demandHeatmaps.createdAt,
    })
      .from(demandHeatmaps)
      .where(eq(demandHeatmaps.state, state.toUpperCase()))
      .orderBy(desc(demandHeatmaps.demandScore))
      .limit(100);

    res.json({ state: state.toUpperCase(), demand });
  } catch (err: any) {
    logger.error("Demand data error", err);
    Errors.internal(res, err);
  }
});

// ── API Key Management (founder only — session chain mounted per-route) ───────
router.get("/keys", ...founderOnly, async (req: Request, res: Response) => {
  try {
    const keys = await db.select({
      id: systemApiKeys.id,
      provider: systemApiKeys.provider,
      displayName: systemApiKeys.displayName,
      keyLast4: systemApiKeys.keyLast4,
      isActive: systemApiKeys.isActive,
      lastValidatedAt: systemApiKeys.lastValidatedAt,
      createdAt: systemApiKeys.createdAt,
    }).from(systemApiKeys).orderBy(desc(systemApiKeys.createdAt));

    res.json({ keys });
  } catch (err: any) {
    logger.error("List API keys error", err);
    Errors.internal(res, err);
  }
});

router.post("/keys", ...founderOnly, async (req: Request, res: Response) => {
  try {
    const { name, provider } = req.body;
    if (!name) return Errors.badRequest(res, "Name is required");

    // W1.6: CSPRNG key, hash-at-rest. The plaintext exists exactly once —
    // in this response.
    const { generateApiKey } = await import("./services/dataApiKeys");
    const generated = generateApiKey();
    const [key] = await db.insert(systemApiKeys).values({
      provider: provider || `partner_${Date.now()}`,
      displayName: name,
      apiKey: null,
      keyHash: generated.hash,
      keyLast4: generated.last4,
      isActive: true,
      validationStatus: "active",
    }).returning({
      id: systemApiKeys.id,
      provider: systemApiKeys.provider,
      displayName: systemApiKeys.displayName,
      keyLast4: systemApiKeys.keyLast4,
      isActive: systemApiKeys.isActive,
      createdAt: systemApiKeys.createdAt,
    });

    res.json({ key: { ...key, apiKey: generated.plaintext }, message: "Save this key — it won't be shown again." });
  } catch (err: any) {
    logger.error("Create API key error", err);
    Errors.internal(res, err);
  }
});

router.delete("/keys/:id", ...founderOnly, async (req: Request, res: Response) => {
  try {
    await db.update(systemApiKeys)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(systemApiKeys.id, parseInt(req.params.id)));
    res.json({ success: true, message: "API key revoked" });
  } catch (err: any) {
    logger.error("Delete API key error", err);
    Errors.internal(res, err);
  }
});

// ── API Key Usage Stats ───────────────────────────────────────────────────────
router.get("/usage/:keyId", ...founderOnly, async (req: Request, res: Response) => {
  try {
    const keyId = parseInt(req.params.keyId);
    const [key] = await db.select().from(systemApiKeys).where(eq(systemApiKeys.id, keyId)).limit(1);

    if (!key) return Errors.notFound(res, "API key");

    // Per-partner-key request usage is not yet instrumented: there is no
    // per-request log keyed by systemApiKeys.id (api_usage_logs tracks internal
    // service spend per organization, not partner Data-API calls). Rather than
    // fabricate counts, report honest zeros with an explicit "not tracked yet"
    // marker so no founder/partner mistakes invented numbers for real usage.
    const usageStats = {
      keyId,
      provider: key.provider,
      displayName: key.displayName,
      tracked: false,
      trackingNote: "Per-key request metering is not instrumented yet — counts will populate once Data-API request logging ships.",
      totalRequests: 0,
      requestsToday: 0,
      requestsThisMonth: 0,
      avgResponseTimeMs: null as number | null,
      topEndpoints: [] as Array<{ endpoint: string; calls: number }>,
      isActive: key.isActive,
      createdAt: key.createdAt,
      lastUsedAt: key.lastValidatedAt,
    };

    res.json({ usage: usageStats });
  } catch (err: any) {
    logger.error("API key usage stats error", err);
    Errors.internal(res, err);
  }
});

// ── Data API Stats (founder only — was UNAUTHENTICATED before W1.6) ───────────
router.get("/stats", ...founderOnly, async (req: Request, res: Response) => {
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
    logger.error("Data API stats error", err);
    Errors.internal(res, err);
  }
});

// ── Coverage Report (founder only — was UNAUTHENTICATED before W1.6) ──────────
router.get("/coverage", ...founderOnly, async (req: Request, res: Response) => {
  try {
    const stateCoverage = await db.select({
      state: transactionTraining.state,
      transactions: sql<number>`COUNT(*)`,
      latestData: sql<string>`MAX(${transactionTraining.saleDate}::text)`,
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
    logger.error("Coverage report error", err);
    Errors.internal(res, err);
  }
});

export default router;
