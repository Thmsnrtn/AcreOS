import { db } from "../storage";
import { sql, eq, and, gte, desc, count } from "drizzle-orm";
import {
  pgTable, text, serial, integer, boolean, timestamp, jsonb,
} from "drizzle-orm/pg-core";

// ============================================
// TABLE DEFINITIONS (to be pushed via drizzle-kit)
// ============================================

// Note: These tables are defined in shared/schema.ts for migrations.
// We reference them by SQL name here for queries.

export interface PageView {
  path: string;
  timestamp: string;
}

export interface SessionRecord {
  id: number;
  userId: string;
  orgId: number;
  startedAt: Date;
  endedAt: Date | null;
  pageViews: PageView[];
}

export interface ActivationEvent {
  id: number;
  userId: string;
  orgId: number;
  eventName: string;
  occurredAt: Date;
}

export interface FeedbackRecord {
  id: number;
  userId: string;
  orgId: number;
  page: string;
  feedback: string;
  createdAt: Date;
}

// ============================================
// ACTIVATION EVENT NAMES
// ============================================

export const ACTIVATION_EVENTS = [
  "first_lead_created",
  "first_lead_imported",
  "first_campaign_created",
  "first_deal_created",
  "first_note_created",
  "first_pax_message",
  "first_enrichment_run",
] as const;

export type ActivationEventName = typeof ACTIVATION_EVENTS[number];

// ============================================
// BETA ANALYTICS SERVICE
// ============================================

class BetaAnalyticsService {
  // --- Session Tracking ---

  async startSession(userId: string, orgId: number): Promise<number> {
    const result = await db.execute(sql`
      INSERT INTO user_sessions (user_id, org_id, started_at, page_views)
      VALUES (${userId}, ${orgId}, NOW(), '[]'::jsonb)
      RETURNING id
    `);
    return (result as any).rows?.[0]?.id ?? 0;
  }

  async recordPageView(sessionId: number, path: string): Promise<void> {
    const pageView = JSON.stringify({ path, timestamp: new Date().toISOString() });
    await db.execute(sql`
      UPDATE user_sessions
      SET page_views = page_views || ${pageView}::jsonb
      WHERE id = ${sessionId}
    `);
  }

  async endSession(sessionId: number): Promise<void> {
    await db.execute(sql`
      UPDATE user_sessions SET ended_at = NOW() WHERE id = ${sessionId}
    `);
  }

  // --- Activation Events ---

  async trackActivation(userId: string, orgId: number, eventName: ActivationEventName): Promise<boolean> {
    // Only record first occurrence
    const existing = await db.execute(sql`
      SELECT id FROM user_activation_events
      WHERE user_id = ${userId} AND org_id = ${orgId} AND event_name = ${eventName}
      LIMIT 1
    `);
    if ((existing as any).rows?.length > 0) return false;

    await db.execute(sql`
      INSERT INTO user_activation_events (user_id, org_id, event_name, occurred_at)
      VALUES (${userId}, ${orgId}, ${eventName}, NOW())
    `);
    return true;
  }

  async getActivationEvents(orgId: number): Promise<ActivationEvent[]> {
    const result = await db.execute(sql`
      SELECT id, user_id as "userId", org_id as "orgId", event_name as "eventName", occurred_at as "occurredAt"
      FROM user_activation_events
      WHERE org_id = ${orgId}
      ORDER BY occurred_at ASC
    `);
    return (result as any).rows ?? [];
  }

  async getActivationRates(): Promise<Record<string, { total: number; rate: number }>> {
    const totalOrgs = await db.execute(sql`SELECT COUNT(DISTINCT id) as count FROM organizations`);
    const total = Number((totalOrgs as any).rows?.[0]?.count ?? 0) || 1;

    const events = await db.execute(sql`
      SELECT event_name, COUNT(DISTINCT org_id) as org_count
      FROM user_activation_events
      GROUP BY event_name
    `);

    const rates: Record<string, { total: number; rate: number }> = {};
    for (const event of ACTIVATION_EVENTS) {
      const row = (events as any).rows?.find((r: any) => r.event_name === event);
      const cnt = Number(row?.org_count ?? 0);
      rates[event] = { total: cnt, rate: Math.round((cnt / total) * 100) };
    }
    return rates;
  }

  // --- Feedback ---

  async submitFeedback(userId: string, orgId: number, page: string, feedback: string): Promise<number> {
    const result = await db.execute(sql`
      INSERT INTO user_feedback (user_id, org_id, page, feedback, created_at)
      VALUES (${userId}, ${orgId}, ${page}, ${feedback}, NOW())
      RETURNING id
    `);
    return (result as any).rows?.[0]?.id ?? 0;
  }

  async getAllFeedback(limit = 100, offset = 0): Promise<FeedbackRecord[]> {
    const result = await db.execute(sql`
      SELECT id, user_id as "userId", org_id as "orgId", page, feedback, created_at as "createdAt"
      FROM user_feedback
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return (result as any).rows ?? [];
  }

  // --- Founder Dashboard Aggregates ---

  async getSignupCount(since?: Date): Promise<number> {
    const whereClause = since
      ? sql`WHERE created_at >= ${since}`
      : sql``;
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM organizations ${whereClause}
    `);
    return Number((result as any).rows?.[0]?.count ?? 0);
  }

  async getOnboardingCompletionRate(): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE onboarding_completed = true) as completed,
        COUNT(*) as total
      FROM organizations
    `);
    const row = (result as any).rows?.[0];
    const total = Number(row?.total ?? 0);
    if (total === 0) return 0;
    return Math.round((Number(row?.completed ?? 0) / total) * 100);
  }

  async getUserTimelines(): Promise<any[]> {
    const result = await db.execute(sql`
      SELECT
        o.id as "orgId",
        o.name,
        o.created_at as "signedUpAt",
        o.onboarding_completed as "onboardingCompleted",
        o.subscription_tier as "tier",
        o.subscription_status as "subscriptionStatus",
        o.trial_started_at as "trialStartedAt",
        o.trial_ends_at as "trialEndsAt",
        (SELECT MAX(s.started_at) FROM user_sessions s WHERE s.org_id = o.id) as "lastActive",
        (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) as "leadCount",
        (SELECT COUNT(*) FROM deals d WHERE d.organization_id = o.id) as "dealCount",
        (SELECT COUNT(*) FROM notes n WHERE n.organization_id = o.id) as "noteCount"
      FROM organizations o
      WHERE o.is_founder = false
      ORDER BY o.created_at DESC
    `);
    return (result as any).rows ?? [];
  }

  async getUserHealthIndicators(): Promise<any[]> {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const result = await db.execute(sql`
      SELECT
        o.id as "orgId",
        o.name,
        (SELECT MAX(s.started_at) FROM user_sessions s WHERE s.org_id = o.id) as "lastActive"
      FROM organizations o
      WHERE o.is_founder = false
      ORDER BY o.created_at DESC
    `);

    return ((result as any).rows ?? []).map((row: any) => {
      const lastActive = row.lastActive ? new Date(row.lastActive) : null;
      let health: "green" | "yellow" | "red" = "red";
      if (lastActive && lastActive >= twoDaysAgo) health = "green";
      else if (lastActive && lastActive >= sevenDaysAgo) health = "yellow";
      return { ...row, health };
    });
  }

  async getPageVisitFrequency(): Promise<Record<string, number>> {
    const result = await db.execute(sql`
      SELECT pv->>'path' as path, COUNT(*) as visits
      FROM user_sessions, jsonb_array_elements(page_views) as pv
      GROUP BY pv->>'path'
      ORDER BY visits DESC
      LIMIT 50
    `);
    const freq: Record<string, number> = {};
    for (const row of (result as any).rows ?? []) {
      freq[row.path] = Number(row.visits);
    }
    return freq;
  }
}

export const betaAnalytics = new BetaAnalyticsService();
