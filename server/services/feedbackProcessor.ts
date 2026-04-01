/**
 * Feedback Processor — categorizes and extracts actionable insights from user feedback.
 * Uses simple keyword matching (no AI dependency) so it runs reliably without external APIs.
 */

import { db } from "../storage";
import { sql } from "drizzle-orm";
import { userFeedback, processedFeedback } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  bug: ["bug", "broken", "crash", "error", "doesn't work", "not working", "fails", "wrong", "glitch"],
  feature: ["would be nice", "please add", "feature request", "wish", "could you add", "need", "want", "missing"],
  confusion: ["confused", "don't understand", "unclear", "how do", "where is", "can't find", "lost"],
  praise: ["love", "great", "awesome", "amazing", "thank", "perfect", "excellent", "helpful"],
  complaint: ["slow", "frustrating", "annoying", "bad", "hate", "terrible", "useless", "disappointed"],
};

const SEVERITY_KEYWORDS: Record<string, string[]> = {
  critical: ["crash", "data loss", "can't login", "security", "payment", "billing error", "lost data"],
  high: ["broken", "doesn't work", "blocking", "urgent", "can't use"],
  medium: ["slow", "annoying", "confusing", "hard to use"],
  low: ["would be nice", "minor", "suggestion", "cosmetic"],
};

const PRODUCT_AREA_KEYWORDS: Record<string, string[]> = {
  leads: ["lead", "leads", "prospect", "contact"],
  deals: ["deal", "deals", "offer", "purchase"],
  campaigns: ["campaign", "sequence", "outreach", "email", "sms"],
  maps: ["map", "maps", "gis", "parcel", "boundary"],
  ai: ["ai", "sophie", "assistant", "intelligence", "suggestion"],
  billing: ["billing", "payment", "subscription", "plan", "pricing", "credit"],
  import: ["import", "csv", "upload", "data"],
  documents: ["document", "contract", "agreement", "pdf"],
  onboarding: ["onboard", "setup", "getting started", "tutorial"],
};

function classify(text: string, keywords: Record<string, string[]>): string | null {
  const lower = text.toLowerCase();
  let best: string | null = null;
  let bestCount = 0;

  for (const [category, words] of Object.entries(keywords)) {
    const count = words.filter((w) => lower.includes(w)).length;
    if (count > bestCount) {
      bestCount = count;
      best = category;
    }
  }

  return best;
}

function extractCoreRequest(text: string): string {
  // Return the first sentence (up to 200 chars) as the core request
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() || text;
  return firstSentence.slice(0, 200);
}

/**
 * Process all unprocessed feedback entries.
 * Returns the number of entries processed.
 */
export async function processNewFeedback(): Promise<number> {
  // Find feedback that hasn't been processed yet
  const unprocessed = await db.execute(sql`
    SELECT uf.id, uf.feedback, uf.page
    FROM user_feedback uf
    LEFT JOIN processed_feedback pf ON pf.feedback_id = uf.id
    WHERE pf.id IS NULL
    ORDER BY uf.created_at ASC
    LIMIT 100
  `);

  const rows = (unprocessed as any).rows || [];
  if (rows.length === 0) return 0;

  let processed = 0;
  for (const row of rows) {
    const text = `${row.feedback} ${row.page || ""}`;
    const category = classify(row.feedback, CATEGORY_KEYWORDS) || "other";
    const severity = classify(row.feedback, SEVERITY_KEYWORDS) || "low";
    const productArea = classify(text, PRODUCT_AREA_KEYWORDS);
    const coreRequest = extractCoreRequest(row.feedback);

    await db.execute(sql`
      INSERT INTO processed_feedback (feedback_id, category, core_request, severity, product_area)
      VALUES (${row.id}, ${category}, ${coreRequest}, ${severity}, ${productArea})
      ON CONFLICT DO NOTHING
    `);
    processed++;
  }

  if (processed > 0) {
    logger.info(`[feedbackProcessor] Processed ${processed} new feedback entries`);
  }

  return processed;
}

/**
 * Get feedback summary grouped by category and severity.
 */
export async function getFeedbackSummary(): Promise<{
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byProductArea: Record<string, number>;
  total: number;
}> {
  const [catResult, sevResult, areaResult, totalResult] = await Promise.all([
    db.execute(sql`SELECT category, COUNT(*)::int as count FROM processed_feedback GROUP BY category`),
    db.execute(sql`SELECT severity, COUNT(*)::int as count FROM processed_feedback GROUP BY severity`),
    db.execute(sql`SELECT product_area, COUNT(*)::int as count FROM processed_feedback WHERE product_area IS NOT NULL GROUP BY product_area`),
    db.execute(sql`SELECT COUNT(*)::int as count FROM processed_feedback`),
  ]);

  const toMap = (rows: any[]): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      if (r.category || r.severity || r.product_area) {
        map[r.category || r.severity || r.product_area] = r.count;
      }
    }
    return map;
  };

  return {
    byCategory: toMap((catResult as any).rows || []),
    bySeverity: toMap((sevResult as any).rows || []),
    byProductArea: toMap((areaResult as any).rows || []),
    total: ((totalResult as any).rows?.[0]?.count) || 0,
  };
}

export const feedbackProcessor = {
  processNewFeedback,
  getFeedbackSummary,
};
