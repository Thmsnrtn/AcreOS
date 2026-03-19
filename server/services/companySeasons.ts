// @ts-nocheck
/**
 * Company Seasons — Sovereign Company Protocol v8
 *
 * "Switch to efficiency mode" → everything changes.
 * Agent trust, spend authority, briefing frequency, risk tolerance,
 * initiative encouragement, failure tolerance — all cascade.
 *
 * Four seasons: Growth, Efficiency, Crisis, Exploration.
 * The system also suggests transitions based on data.
 */

import { db } from "../db";
import { companySeasons, type CompanySeason } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { strategicCompassService } from "./strategicCompass";

// ─── Season Configurations ───────────────────────────────────────────────────

const SEASON_CONFIGS: Record<string, CompanySeason["config"]> = {
  growth: {
    trustBoostAll: 10,
    approvalThreshold: "loose",
    briefingFrequency: "daily",
    spendMultiplier: 1.5,
    riskTolerance: "high",
    initiativeEncouragement: "encouraged",
    failureTolerance: "medium",
    autoEscalateThreshold: "high",
  },
  efficiency: {
    trustBoostAll: 0,
    approvalThreshold: "strict",
    briefingFrequency: "daily",
    spendMultiplier: 0.7,
    riskTolerance: "low",
    initiativeEncouragement: "normal",
    failureTolerance: "low",
    autoEscalateThreshold: "low",
  },
  crisis: {
    trustBoostAll: 20,
    approvalThreshold: "strict",
    briefingFrequency: "hourly",
    spendMultiplier: 0.3,
    riskTolerance: "low",
    initiativeEncouragement: "discouraged",
    failureTolerance: "zero",
    autoEscalateThreshold: "low",
  },
  exploration: {
    trustBoostAll: 5,
    approvalThreshold: "loose",
    briefingFrequency: "daily",
    spendMultiplier: 1.2,
    riskTolerance: "high",
    initiativeEncouragement: "encouraged",
    failureTolerance: "high",
    autoEscalateThreshold: "high",
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

class CompanySeasonService {

  /** Activate a new season */
  async activate(season: string, reason?: string): Promise<number> {
    const config = SEASON_CONFIGS[season] || SEASON_CONFIGS.growth;

    // Deactivate current season
    await this.deactivateCurrent();

    const [record] = await db.insert(companySeasons).values({
      season,
      isActive: true,
      activatedAt: new Date(),
      activatedBy: "ceo",
      reason: reason || `CEO activated ${season} season`,
      config,
      results: { startMetrics: {} },
    }).returning({ id: companySeasons.id });

    // Also update the strategic compass to match
    await strategicCompassService.switchMode(
      season === "crisis" ? "crisis" : season === "exploration" ? "exploration" : season === "efficiency" ? "efficiency" : season === "growth" ? "growth" : "balanced",
      `Season changed to ${season}`,
    );

    return record.id;
  }

  /** Deactivate the current season */
  async deactivateCurrent(): Promise<void> {
    const current = await this.getActive();
    if (current) {
      await db.update(companySeasons)
        .set({
          isActive: false,
          deactivatedAt: new Date(),
        })
        .where(eq(companySeasons.id, current.id));
    }
  }

  /** Get the active season */
  async getActive(): Promise<CompanySeason | null> {
    return db.query.companySeasons.findFirst({
      where: eq(companySeasons.isActive, true),
      orderBy: [desc(companySeasons.createdAt)],
    }) as any;
  }

  /** Get season history */
  async getHistory(limit = 10): Promise<CompanySeason[]> {
    return db.query.companySeasons.findMany({
      orderBy: [desc(companySeasons.createdAt)],
      limit,
    });
  }

  /** Get current season config (or default) */
  async getCurrentConfig(): Promise<CompanySeason["config"]> {
    const active = await this.getActive();
    return (active?.config as any) || SEASON_CONFIGS.growth;
  }
}

export const companySeasonService = new CompanySeasonService();
