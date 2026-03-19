// @ts-nocheck
/**
 * Founder Digital Twin — Sovereign Company Protocol v7
 *
 * The system learns the founder's communication style, decision patterns,
 * and priorities from every interaction. Then uses that to:
 *
 * 1. Draft investor updates in the founder's voice
 * 2. Write customer responses that sound like the CEO
 * 3. Compose board reports with the founder's framing
 * 4. Generate team announcements in the founder's tone
 *
 * Not generic AI text. Trained on YOUR patterns within the system.
 * The more you use the platform, the better it gets.
 */

import { db } from "../db";
import {
  founderTwinContext, founderDrafts,
  type FounderTwinContext, type FounderDraft,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";

// ─── Service ─────────────────────────────────────────────────────────────────

class FounderTwinService {

  /** Learn from a CEO interaction (call after every CEO action) */
  async learnFromInteraction(input: {
    type: "war_room_directive" | "initiative_notes" | "review_comment" | "command" | "message";
    content: string;
  }): Promise<void> {
    if (!input.content || input.content.length < 10) return;

    try {
      const response = await routeAITask({
        taskType: "twin_learning",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          {
            role: "system",
            content: `Analyze this CEO communication to extract style and pattern signals. Be specific.`,
          },
          {
            role: "user",
            content: `CEO ${input.type}: "${input.content}"

Extract patterns. Respond in JSON:
{
  "style_signals": [
    { "type": "communication_style|vocabulary|priority_signal|decision_pattern", "key": "brief_label", "value": "observation", "example": "exact quote" }
  ]
}

Look for: sentence length preference, formality level, specific vocabulary, priorities mentioned, decision speed, level of detail expected.`,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 200,
        temperature: 0.2,
      });

      const parsed = JSON.parse(response.content);
      const signals = parsed.style_signals || [];

      for (const signal of signals) {
        // Upsert: strengthen existing patterns, add new ones
        const existing = await db.query.founderTwinContext.findFirst({
          where: and(
            eq(founderTwinContext.contextType, signal.type),
            eq(founderTwinContext.key, signal.key),
          ),
        });

        if (existing) {
          const newCount = (existing.sourceCount || 0) + 1;
          const newConfidence = Math.min(0.99, Number(existing.confidence || 0.5) + (1 - Number(existing.confidence || 0.5)) * 0.2);
          const examples = [...((existing.examples as string[]) || [])];
          if (signal.example && examples.length < 10) examples.push(signal.example);

          await db.update(founderTwinContext)
            .set({
              value: { ...((existing.value as any) || {}), ...{ observation: signal.value } },
              confidence: newConfidence.toFixed(3),
              sourceCount: newCount,
              examples,
              updatedAt: new Date(),
            })
            .where(eq(founderTwinContext.id, existing.id));
        } else {
          await db.insert(founderTwinContext).values({
            contextType: signal.type,
            key: signal.key,
            value: { observation: signal.value },
            confidence: "0.5",
            sourceCount: 1,
            examples: signal.example ? [signal.example] : [],
          });
        }
      }
    } catch {}
  }

  /** Generate the founder's style profile for use in drafting */
  async getStyleProfile(): Promise<string> {
    const contexts = await db.query.founderTwinContext.findMany({
      orderBy: [desc(founderTwinContext.confidence)],
      limit: 30,
    });

    if (contexts.length === 0) {
      return "No founder style data yet. The system learns from your interactions over time.";
    }

    const byType: Record<string, FounderTwinContext[]> = {};
    for (const c of contexts) {
      byType[c.contextType] = byType[c.contextType] || [];
      byType[c.contextType].push(c);
    }

    let profile = "";
    for (const [type, items] of Object.entries(byType)) {
      profile += `\n## ${type.replace(/_/g, " ").toUpperCase()}\n`;
      for (const item of items.slice(0, 8)) {
        const value = (item.value as any)?.observation || JSON.stringify(item.value);
        const examples = (item.examples as string[]) || [];
        profile += `- ${item.key}: ${value}`;
        if (examples.length > 0) profile += ` (e.g. "${examples[0]}")`;
        profile += ` [confidence: ${Number(item.confidence || 0).toFixed(1)}, ${item.sourceCount} observations]\n`;
      }
    }

    return profile;
  }

  /** Draft a communication in the founder's voice */
  async generateDraft(input: {
    draftType: "investor_update" | "board_report" | "customer_response" | "team_announcement";
    context?: string;       // additional context from the CEO
    topic?: string;         // what the draft is about
  }): Promise<number> {
    const styleProfile = await this.getStyleProfile();

    // Gather live data from relevant agents
    const agentData: Record<string, any> = {};
    const relevantAgents = {
      investor_update: ["forge_revenue", "oracle_analytics", "ledger_finance"],
      board_report: ["forge_revenue", "oracle_analytics", "ledger_finance", "atlas_cto", "compass_pm"],
      customer_response: ["sophie_csm", "forge_revenue"],
      team_announcement: ["atlas_cto", "compass_pm"],
    };

    for (const agent of relevantAgents[input.draftType] || []) {
      agentData[agent] = await resolveAgentData(agent).catch(() => ({}));
    }

    const DRAFT_PROMPTS: Record<string, string> = {
      investor_update: `Write a monthly investor update email. Include: key metrics (MRR, growth, churn), highlights, challenges, and what's next. Keep it professional but personal. 300-500 words.`,
      board_report: `Write a board report summary. Include: financial overview, product progress, team updates, risks, and strategic priorities. Executive tone. 500-800 words.`,
      customer_response: `Write a CEO-level customer response. Empathetic, solution-oriented, and personal. Reference their specific situation. 100-200 words.`,
      team_announcement: `Write a team announcement. Motivating, transparent about challenges, clear on direction. 200-400 words.`,
    };

    try {
      const response = await routeAITask({
        taskType: "founder_draft",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are drafting a communication AS the CEO/founder. Match their voice exactly.

FOUNDER'S STYLE PROFILE:
${styleProfile}

RULES:
- Write in THEIR voice, not generic AI voice
- Use their vocabulary and sentence patterns
- Match their level of formality
- Include real data from the provided metrics
- If the style profile is sparse, default to professional-but-warm tone`,
          },
          {
            role: "user",
            content: `${DRAFT_PROMPTS[input.draftType]}

${input.topic ? `Topic/focus: ${input.topic}` : ""}
${input.context ? `CEO notes: ${input.context}` : ""}

Live business data:
${JSON.stringify(agentData, null, 2)}

Write the draft now. No preamble, just the content.`,
          },
        ],
        maxTokens: 1000,
        temperature: 0.4,
      });

      const dataSources = relevantAgents[input.draftType] || [];
      const title = input.topic
        ? `${input.draftType.replace(/_/g, " ")} — ${input.topic}`
        : `${input.draftType.replace(/_/g, " ")} — ${new Date().toLocaleDateString()}`;

      const [draft] = await db.insert(founderDrafts).values({
        draftType: input.draftType,
        title,
        content: response.content,
        dataSources,
        status: "draft",
      }).returning({ id: founderDrafts.id });

      return draft.id;
    } catch (err: any) {
      const [draft] = await db.insert(founderDrafts).values({
        draftType: input.draftType,
        title: `${input.draftType.replace(/_/g, " ")} — ${new Date().toLocaleDateString()}`,
        content: `Draft generation failed: ${err.message}`,
        dataSources: [],
        status: "draft",
      }).returning({ id: founderDrafts.id });

      return draft.id;
    }
  }

  /** CEO edits a draft — the twin learns from the edits */
  async saveDraftEdits(draftId: number, editedContent: string): Promise<void> {
    const draft = await db.query.founderDrafts.findFirst({
      where: eq(founderDrafts.id, draftId),
    });
    if (!draft) return;

    await db.update(founderDrafts)
      .set({
        content: editedContent,
        ceoEdits: editedContent,
        updatedAt: new Date(),
      })
      .where(eq(founderDrafts.id, draftId));

    // Learn from the edits — what did the CEO change?
    if (draft.content !== editedContent) {
      await this.learnFromInteraction({
        type: "message",
        content: editedContent,
      });
    }
  }

  /** Mark a draft as approved/sent */
  async approveDraft(draftId: number): Promise<void> {
    await db.update(founderDrafts)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(founderDrafts.id, draftId));
  }

  /** Get recent drafts */
  async getRecentDrafts(limit = 10): Promise<FounderDraft[]> {
    return db.query.founderDrafts.findMany({
      orderBy: [desc(founderDrafts.createdAt)],
      limit,
    });
  }

  /** Get draft by ID */
  async getDraft(id: number): Promise<FounderDraft | undefined> {
    return db.query.founderDrafts.findFirst({
      where: eq(founderDrafts.id, id),
    });
  }

  /** Get style context entries */
  async getStyleContext(): Promise<FounderTwinContext[]> {
    return db.query.founderTwinContext.findMany({
      orderBy: [desc(founderTwinContext.confidence)],
      limit: 30,
    });
  }
}

export const founderTwinService = new FounderTwinService();
