/**
 * Atlas meta-tools (Phase G/H/I batch 2).
 *
 * Currently: undo_last_action — the Tier-3 inverse of the most recent
 * destructive tool call. Reads the founder's most recent founder_audit
 * row that has a `metadata.rollbackRecipe` (stored under the `after`
 * jsonb field's rollbackRecipe key) and replays the reverseToolName /
 * reverseArgs through the registry.
 *
 * Always gated by the executor's destructive-confirmation flow + Tier-3
 * cooldown. Tom can't accidentally undo two things in a row.
 */

import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";

import { db } from "../../../db";
import { founderAudit } from "@shared/schema";
import { registerTool, getTool, type RollbackRecipe } from "../tool-registry";
import { runTool } from "../executor";

const TXT = (markdown: string) => ({
  artifact: { type: "text" as const, markdown },
});

function extractRecipe(row: any): RollbackRecipe | null {
  const after = row?.after;
  if (!after || typeof after !== "object") return null;
  const recipe = (after as { rollbackRecipe?: unknown }).rollbackRecipe;
  if (!recipe || typeof recipe !== "object") return null;
  if (!("humanLabel" in recipe)) return null;
  return recipe as RollbackRecipe;
}

registerTool({
  name: "undo_last_action",
  description:
    "Undo the most recent destructive Atlas action by replaying its rollback recipe. Tier 3 — requires confirmation so you can't accidentally undo two things in a row.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    reason: z.string().min(3).max(500).default("manual undo"),
  }),
  async handler(args, ctx) {
    // Find the most recent tool_call: row with a rollbackRecipe for this founder.
    // We scan a small window (last 20) and pick the first one with a recipe.
    const rows = await db
      .select()
      .from(founderAudit)
      .where(
        and(
          eq(founderAudit.founderId, ctx.founderUserId),
          like(founderAudit.action, "tool_call:%"),
        ),
      )
      .orderBy(desc(founderAudit.createdAt))
      .limit(20);

    const candidate = rows.find((r) => extractRecipe(r) !== null);
    if (!candidate) {
      return TXT(
        "No recent destructive action with a rollback recipe found in the last 20 audit rows. Nothing to undo.",
      );
    }
    const recipe = extractRecipe(candidate)!;

    if (!recipe.reverseToolName) {
      return TXT(
        `**No automatic undo available.** Last action: \`${candidate.action.replace(/^tool_call:/, "")}\`. ` +
          `Manual note: _${recipe.humanLabel}_`,
      );
    }
    const reverseTool = getTool(recipe.reverseToolName);
    if (!reverseTool) {
      return TXT(
        `Rollback recipe references unknown tool \`${recipe.reverseToolName}\`. ` +
          `Manual note: _${recipe.humanLabel}_`,
      );
    }

    // Replay through the executor as a confirmed call (Tom already
    // confirmed undo_last_action — we don't double-confirm the inner
    // tool). Cooldown still applies — same Tier-3 tool inside 5 min
    // bumps a fresh confirmation request through the executor.
    const outcome = await runTool({
      toolName: recipe.reverseToolName,
      args: recipe.reverseArgs ?? {},
      ctx,
      confirmed: true,
    });

    return {
      artifact: {
        type: "text",
        markdown: `Replayed undo: **${recipe.humanLabel}**.\n\nReverse tool \`${recipe.reverseToolName}\` returned a \`${outcome.artifact.type}\` artifact.`,
      },
      rollbackRecipe: null,
      // No verifyFn — the inner tool's verifyFn already fired through the executor.
    };
  },
});
