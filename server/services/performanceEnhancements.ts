/**
 * Performance & Technical Enhancements — Items 201-220
 * Query optimization hints, caching, health checks, monitoring, etc.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// Item 201: Identify slow queries
export async function getSlowQuerySuggestions(): Promise<Array<{ table: string; suggestion: string }>> {
  return [
    { table: "leads", suggestion: "CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads (organization_id, status)" },
    { table: "deals", suggestion: "CREATE INDEX IF NOT EXISTS idx_deals_org_status ON deals (organization_id, status)" },
    { table: "properties", suggestion: "CREATE INDEX IF NOT EXISTS idx_props_org_county ON properties (organization_id, county)" },
    { table: "payments", suggestion: "CREATE INDEX IF NOT EXISTS idx_payments_org_date ON payments (organization_id, paid_at)" },
    { table: "agent_action_log", suggestion: "CREATE INDEX IF NOT EXISTS idx_aal_agent_created ON agent_action_log (agent_codename, created_at)" },
    { table: "activity_log", suggestion: "CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log (entity_type, entity_id)" },
    { table: "campaigns", suggestion: "CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON campaigns (organization_id, status)" },
    { table: "notes", suggestion: "CREATE INDEX IF NOT EXISTS idx_notes_org_status ON notes (organization_id, status)" },
    { table: "marketplace_listings", suggestion: "CREATE INDEX IF NOT EXISTS idx_listings_status ON marketplace_listings (status)" },
    { table: "daily_deal_feed", suggestion: "CREATE INDEX IF NOT EXISTS idx_feed_org_score ON daily_deal_feed (organization_id, composite_score DESC)" },
  ];
}

// Item 206: ETag generation for caching
export function generateETag(data: any): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

// Item 216: Request ID generation
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// Item 220: Deep health check
export async function deepHealthCheck(): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  services: Record<string, { status: string; latencyMs: number }>;
}> {
  const services: Record<string, { status: string; latencyMs: number }> = {};

  // Database check
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    services.database = { status: "healthy", latencyMs: Date.now() - start };
  } catch {
    services.database = { status: "unhealthy", latencyMs: -1 };
  }

  // Check if Stripe is configured
  services.stripe = { status: process.env.STRIPE_SECRET_KEY ? "configured" : "not_configured", latencyMs: 0 };

  // Check if email is configured
  services.email = { status: process.env.AWS_SES_REGION || process.env.SENDGRID_API_KEY ? "configured" : "not_configured", latencyMs: 0 };

  // Check if AI is configured
  services.ai = { status: process.env.OPENAI_API_KEY ? "configured" : "not_configured", latencyMs: 0 };

  // Check if Clerk is configured
  services.auth = { status: process.env.CLERK_SECRET_KEY ? "configured" : "not_configured", latencyMs: 0 };

  const allHealthy = Object.values(services).every(s => s.status !== "unhealthy");
  const anyUnhealthy = Object.values(services).some(s => s.status === "unhealthy");

  return {
    status: anyUnhealthy ? "unhealthy" : allHealthy ? "healthy" : "degraded",
    services,
  };
}

// Item 209: Background job monitoring stats
export async function getJobMonitoringStats(): Promise<{
  totalJobs: number;
  failedLast24h: number;
  avgDurationMs: number;
}> {
  const { jobHealthLogs } = await import("@shared/schema");
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total] = await db.select({ count: sql<number>`COUNT(*)` }).from(jobHealthLogs);
  const [failed] = await db.select({ count: sql<number>`COUNT(*)` }).from(jobHealthLogs)
    .where(and(sql`${jobHealthLogs.status} = 'failed'`, sql`${jobHealthLogs.createdAt} > ${oneDayAgo}`));
  const [avgDuration] = await db.select({ avg: sql<number>`AVG(${jobHealthLogs.durationMs})` }).from(jobHealthLogs)
    .where(sql`${jobHealthLogs.createdAt} > ${oneDayAgo}`);

  return {
    totalJobs: Number(total?.count || 0),
    failedLast24h: Number(failed?.count || 0),
    avgDurationMs: Math.round(Number(avgDuration?.avg || 0)),
  };
}
