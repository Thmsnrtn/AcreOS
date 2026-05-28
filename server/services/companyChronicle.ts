/**
 * Company Chronicle — Sovereign Company Protocol v8
 *
 * Auto-generated narrative history of the company.
 * Not logs — storytelling.
 *
 * "March 2026: Launched v2 pricing. Churn spiked 3.2%, Sophie's
 * retention campaign recovered 78%. Key learning: grandfather existing
 * customers. This pattern codified into Playbook #7."
 *
 * Searchable, browsable. The kind of knowledge that makes a
 * 10-person company feel like it has 10 years of wisdom.
 */

import { db } from "../db";
import {
  companyChronicle, agentActionLog, agentPerformanceReviews,
  warRooms, agentWorkflowRuns,
  type CompanyChronicleEntry,
} from "@shared/schema";
import { eq, desc, gte, lte, and, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";

// ─── Service ─────────────────────────────────────────────────────────────────

class CompanyChronicleService {

  /** Generate a chronicle entry for a given period */
  async generateEntry(periodType: "week" | "month" | "quarter", periodEnd?: Date): Promise<number> {
    const end = periodEnd || new Date();
    let start: Date;
    let label: string;

    switch (periodType) {
      case "week":
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        label = `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        break;
      case "month":
        start = new Date(end.getFullYear(), end.getMonth(), 1);
        label = end.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        break;
      case "quarter":
        const quarter = Math.floor(end.getMonth() / 3);
        start = new Date(end.getFullYear(), quarter * 3, 1);
        label = `Q${quarter + 1} ${end.getFullYear()}`;
        break;
    }

    // Gather data for the period
    const [actionCountResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(and(
        gte(agentActionLog.createdAt, start),
        lte(agentActionLog.createdAt, end),
      ));
    const agentActions = Number(actionCountResult?.n || 0);

    const [warRoomCountResult] = await db.select({ n: count() })
      .from(warRooms)
      .where(and(
        gte(warRooms.createdAt, start),
        lte(warRooms.createdAt, end),
      ));
    const warRoomCount = Number(warRoomCountResult?.n || 0);

    // Get top agent from reviews
    const reviews = await db.query.agentPerformanceReviews.findMany({
      where: and(
        gte(agentPerformanceReviews.periodStart, start),
        lte(agentPerformanceReviews.periodEnd, end),
      ),
      orderBy: [agentPerformanceReviews.overallGrade],
      limit: 1,
    });
    const topAgent = reviews[0]?.agentCodename;
    const topAgentGrade = reviews[0]?.overallGrade;

    // Get revenue data
    const revenueData = await resolveAgentData("forge_revenue").catch(() => ({}));

    const metrics = {
      deals: 0,
      warRooms: warRoomCount,
      ceoDecisions: 0,
      agentActions,
      topAgent,
      topAgentGrade,
    };

    // Generate the narrative
    try {
      const response = await routeAITask({
        taskType: "chronicle_narrative",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are writing a company chronicle entry — a narrative history of what happened during this period. Write like a historian, not a report generator. Include specific numbers, agent names, key events, and lessons learned. Be concise but vivid. 200-400 words.`,
          },
          {
            role: "user",
            content: `Period: ${label} (${periodType})

Data:
- Agent actions: ${agentActions}
- War rooms convened: ${warRoomCount}
- Top performer: ${topAgent || "N/A"} (Grade: ${topAgentGrade || "N/A"})
- Revenue data: ${JSON.stringify(revenueData)}

Write the chronicle entry. Also identify 3-5 highlights and 2-3 key learnings.

Respond in JSON:
{
  "narrative": "The full narrative text",
  "highlights": [
    { "type": "win|challenge|learning|milestone|decision", "description": "...", "impact": "..." }
  ],
  "keyLearnings": ["learning 1", "learning 2"]
}`,
          },
        ],
        responseFormat: "json",
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.content);

      const [entry] = await db.insert(companyChronicle).values({
        periodType,
        periodLabel: label,
        periodStart: start,
        periodEnd: end,
        narrative: parsed.narrative,
        highlights: parsed.highlights || [],
        metrics,
        keyLearnings: parsed.keyLearnings || [],
        searchableText: `${label} ${parsed.narrative} ${(parsed.keyLearnings || []).join(" ")}`,
      }).returning({ id: companyChronicle.id });

      return entry.id;
    } catch (err: any) {
      const [entry] = await db.insert(companyChronicle).values({
        periodType,
        periodLabel: label,
        periodStart: start,
        periodEnd: end,
        narrative: `${label}: ${agentActions} agent actions, ${warRoomCount} war rooms. Chronicle generation needs more data.`,
        highlights: [],
        metrics,
        keyLearnings: [],
      }).returning({ id: companyChronicle.id });

      return entry.id;
    }
  }

  /** Get recent chronicle entries */
  async getRecent(limit = 10): Promise<CompanyChronicleEntry[]> {
    return db.query.companyChronicle.findMany({
      orderBy: [desc(companyChronicle.periodStart)],
      limit,
    });
  }

  /** Get chronicle entries by period type */
  async getByType(periodType: string, limit = 10): Promise<CompanyChronicleEntry[]> {
    return db.query.companyChronicle.findMany({
      where: eq(companyChronicle.periodType, periodType),
      orderBy: [desc(companyChronicle.periodStart)],
      limit,
    });
  }

  /** Search chronicle entries */
  async search(query: string): Promise<CompanyChronicleEntry[]> {
    return db.query.companyChronicle.findMany({
      where: sql`${companyChronicle.searchableText} ILIKE ${"%" + query + "%"}`,
      orderBy: [desc(companyChronicle.periodStart)],
      limit: 10,
    });
  }

  /** Get entry by ID */
  async getById(id: number): Promise<CompanyChronicleEntry | undefined> {
    return db.query.companyChronicle.findFirst({
      where: eq(companyChronicle.id, id),
    });
  }
}

export const companyChronicleService = new CompanyChronicleService();
