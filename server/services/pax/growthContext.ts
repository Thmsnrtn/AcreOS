/**
 * Two W5b blocks for Pax's system prompt, on BOTH chat paths (processChat and
 * processChatStream in server/ai/executive.ts):
 *
 *   - the reply language (shared/pax/replyLanguage.ts): the user's own setting
 *     (users.pax_language) or the language they wrote in;
 *   - the first-deal mentor brief (shared/growth/firstDeal.ts): the org's next
 *     concrete step, from its real records, until its first deal closes.
 *
 * Pax stays the ambient chat it is — this adds context, not a destination.
 * Both are best-effort: a failed read leaves the prompt as it was.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema";
import { paxLanguageDirective, paxReplyLanguage } from "@shared/pax/replyLanguage";
import { firstDealMentorBrief } from "@shared/growth/firstDeal";
import { logger } from "../../utils/logger";

export async function loadPaxLanguageContext(userId: string | null | undefined, message: string): Promise<string> {
  let setting: string | null = null;
  try {
    if (userId) {
      const [u] = await db.select({ paxLanguage: users.paxLanguage }).from(users).where(eq(users.id, userId)).limit(1);
      setting = u?.paxLanguage ?? null;
    }
  } catch (err) {
    logger.warn("[pax] reading the user's Pax language failed — matching the message instead", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
  return paxLanguageDirective(paxReplyLanguage(setting, message));
}

export async function loadFirstDealMentorContext(organizationId: number): Promise<string> {
  try {
    const { firstDealStepForOrg } = await import("../growth/firstDealProgram");
    const step = await firstDealStepForOrg(organizationId);
    if (!step || step.step === "done") return "";
    return `\n\n=== ${firstDealMentorBrief(step)}\n=== END FIRST-DEAL MENTOR CONTEXT ===`;
  } catch (err) {
    logger.warn("[pax] first-deal mentor context unavailable", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
    return "";
  }
}
