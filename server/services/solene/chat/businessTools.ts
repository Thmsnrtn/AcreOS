/**
 * SOLENE CHAT — business tools that mirror the four founder doors (Stage 2,
 * task 3). Before this the chat model had only file / git / agent-message
 * tools: "stop spending money on ads" got a polite reply and changed nothing.
 *
 *   The Letter    → read_letter
 *   Decisions     → list_open_asks, answer_ask (approve / decline)
 *   Controls      → set_budget, pause, resume (a domain, or "ads")
 *
 * Each tool calls the SAME service the door's route calls, so the effect is the
 * door's effect (the settings row, the dispatch queue, the pending-action
 * queue) — never just the reply text.
 *
 * HARD-STOPS ARE UN-DELEGABLE. The chat is the founder talking, but the tool
 * call is a model's interpretation of it. So none of these tools can cross a
 * hard-stop (pricing, legal signing, spend over $500, customer-data deletion):
 * answer_ask refuses an ask that is a hard-stop or a legal / data-deletion
 * matter, and set_budget refuses any amount over the $500 limit. Those stay a
 * tap on the founder's own door.
 */
import { HARD_STOP_SPEND_LIMIT_USD } from "../../autopilot/hardStops";
import { founderOnlyClassForMove, hardStopForMove, isMoneyShaped } from "../../autopilot/hardStopMoves";
import { bindingFor, isKnownMoveKind } from "../../autopilot/act";
import { logger } from "../../../utils/logger";

export interface BusinessToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const PAUSE_TARGETS = ["growth", "support", "deploy", "ops", "finance", "ads"];

export const CHAT_BUSINESS_TOOL_SCHEMAS: BusinessToolSchema[] = [
  {
    name: "read_letter",
    description: "Read today's Letter (the founder's brief): the word, whether he is needed, the open decisions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_open_asks",
    description: "List the decisions waiting on the founder (Decisions door): id, summary, urgency, how many times it was raised again.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "answer_ask",
    description: "Approve or decline ONE pending yes/no decision by id, on the founder's explicit instruction. Refused for hard-stops (pricing, legal, spend over $500, customer-data deletion) — those stay the founder's own tap.",
    input_schema: {
      type: "object",
      properties: { ask_id: { type: "number" }, decision: { type: "string", enum: ["approve", "decline"] } },
      required: ["ask_id", "decision"],
    },
  },
  {
    name: "set_budget",
    description: `Set the autopilot's monthly spend cap in USD (Controls door). At most $${HARD_STOP_SPEND_LIMIT_USD} — a larger budget is a hard-stop the founder sets himself. Pass 0 to reset to the default.`,
    input_schema: { type: "object", properties: { monthly_usd: { type: "number" } }, required: ["monthly_usd"] },
  },
  {
    name: "pause",
    description: "Pause a part of the business (growth | support | deploy | ops | finance), or 'ads' to stop the AUTOPILOT's ad spending (campaigns the founder launched himself are not paused — the reply lists them). Mechanical: queued work and drafted actions are cancelled and nothing new starts until resumed.",
    input_schema: { type: "object", properties: { target: { type: "string", enum: PAUSE_TARGETS } }, required: ["target"] },
  },
  {
    name: "resume",
    description: "Resume a paused part of the business, or 'ads' to allow the autopilot's ad spending again — resuming ads waits for the founder's explicit confirmation (each ad still needs a witness and stays under its ceiling).",
    input_schema: { type: "object", properties: { target: { type: "string", enum: PAUSE_TARGETS } }, required: ["target"] },
  },
];

export const CHAT_BUSINESS_TOOL_NAMES: ReadonlySet<string> = new Set(CHAT_BUSINESS_TOOL_SCHEMAS.map((t) => t.name));

/** Asks the chat may never answer for the founder. Pure. */
const UNDELEGABLE_ASK_RE =
  /\b(held — founder-only|hard[- ]stop|legal|lawsuit|attorney|counsel|tcpa|cease and desist|cease-and-desist|demand letter|subpoena|dsar|data[- ]deletion|delete (?:my|their|customer|all) data|erasure|pricing|price change|raise prices?|lower prices?)\b/i;

/**
 * FAIL CLOSED (audit H4): the chat may answer an ask for the founder ONLY when
 * the ask names a move the kernel knows (a catalog move kind, read from the
 * card's "…: <kind>" summary), that move is not finance-domain, and nothing on
 * the card is a hard-stop subject or money-shaped. Everything else — a net-new
 * move, any finance or money-shaped decision, anything touching pricing /
 * plans / tiers / fees, contracts / terms / signatures, deletion or
 * anonymization of customer data, and any ask that names no known move — is
 * the founder's own tap on the Decisions door.
 */
export function isUndelegableAsk(ask: { questionSummary: string; questionBody: string }): boolean {
  const text = `${ask.questionSummary}\n${ask.questionBody}`;
  if (UNDELEGABLE_ASK_RE.test(text)) return true;
  const kind = /:\s*([a-z][a-z0-9_]{3,})\s*\)?\s*$/i.exec(ask.questionSummary)?.[1];
  if (!kind || !isKnownMoveKind(kind)) return true;
  const domain = bindingFor(kind).domain;
  if (founderOnlyClassForMove({ kind, rationale: ask.questionBody, domain, isNetNew: false })) return true;
  // The card's own words, too: a "finance action" summary or any money/hard-stop subject anywhere.
  if (/\bfinance\b/i.test(ask.questionSummary)) return true;
  return hardStopForMove({ kind, rationale: text }) != null || isMoneyShaped(text);
}

export interface BusinessToolResult {
  ok: boolean;
  text: string;
}

/** True for a business-tool call that runs only after the founder confirms it explicitly. Pure. */
export function businessToolNeedsConfirmation(name: string, input: Record<string, unknown>): boolean {
  return name === "resume" && input.target === "ads";
}

export async function executeBusinessChatTool(
  name: string,
  input: Record<string, unknown>,
  founderUserId: string,
  opts: { confirmed?: boolean } = {},
): Promise<BusinessToolResult> {
  try {
    switch (name) {
      case "read_letter": {
        const { composeFounderBrief } = await import("../../autopilot/narrate");
        const b = await composeFounderBrief();
        return { ok: true, text: JSON.stringify({ neededLine: b.neededLine, theWord: b.theWord, isFounderNeeded: b.isFounderNeeded }) };
      }
      case "list_open_asks": {
        const { listOpenAsks } = await import("../founderCollab");
        const asks = await listOpenAsks();
        return {
          ok: true,
          text: JSON.stringify(
            asks.map((a) => ({ id: a.id, summary: a.questionSummary, urgency: a.urgency, format: a.answerFormat, raisedAgain: a.foldCount ?? 0, founderOnly: isUndelegableAsk(a) })),
          ),
        };
      }
      case "answer_ask": {
        const askId = typeof input.ask_id === "number" ? Math.floor(input.ask_id) : NaN;
        const decision = input.decision === "approve" ? "yes" : input.decision === "decline" ? "no" : null;
        if (!Number.isFinite(askId) || !decision) return { ok: false, text: "answer_ask needs ask_id and decision approve|decline." };
        const { getAsk, answerFounderAsk } = await import("../founderCollab");
        const ask = await getAsk(askId);
        if (!ask) return { ok: false, text: `Ask #${askId} does not exist.` };
        if (ask.status !== "open") return { ok: false, text: `Ask #${askId} is already ${ask.status}.` };
        if (ask.answerFormat !== "yes_no") return { ok: false, text: `Ask #${askId} needs a written answer — answer it on the Decisions door.` };
        // STRUCTURAL: the chat answers only an ask the server bound to a
        // server-authored catalog move on the allow-list (chat_approvable,
        // set by planAndAct — never by a model). Whatever words a model wrote
        // into an ask, it is the founder's own tap. The classifier below is
        // defence in depth.
        if (ask.chatApprovable !== true || isUndelegableAsk(ask)) {
          return { ok: false, text: `Ask #${askId} ("${ask.questionSummary}") is founder-only and un-delegable (a hard-stop, a net-new move, a money or finance decision, or a legal/data matter). I did not answer it; tap it yourself on the Decisions door.` };
        }
        await answerFounderAsk({ askId, answerText: decision, expectedBodyHash: ask.bodyHash ?? undefined });
        logger.info("[soleneChat] business tool answered an ask", { metadata: { askId, decision, founderUserId } });
        return { ok: true, text: `Ask #${askId} ${decision === "yes" ? "approved — an approved autopilot move is queued to run" : "declined — it stays held"}.` };
      }
      case "set_budget": {
        const usd = typeof input.monthly_usd === "number" ? input.monthly_usd : NaN;
        if (!Number.isFinite(usd) || usd < 0) return { ok: false, text: "set_budget needs monthly_usd ≥ 0." };
        if (usd > HARD_STOP_SPEND_LIMIT_USD) {
          return { ok: false, text: `$${usd} is over the $${HARD_STOP_SPEND_LIMIT_USD} hard-stop — a budget that large is founder-only and un-delegable. Set it yourself on the Controls door.` };
        }
        const { setGrowthBudgetOverrideUsd } = await import("../../autopilot/settings");
        const s = await setGrowthBudgetOverrideUsd(usd === 0 ? null : usd, founderUserId);
        return { ok: true, text: `Monthly autopilot budget ${s.growthBudgetOverrideUsd == null ? "reset to the default" : `set to $${s.growthBudgetOverrideUsd}`}.` };
      }
      case "pause":
      case "resume": {
        const { isPausable, setPaused } = await import("../../autopilot/founderControls");
        if (!isPausable(input.target)) return { ok: false, text: `Unknown target — use one of ${PAUSE_TARGETS.join(", ")}.` };
        // Turning ad spending back ON is never a model's reading of a chat
        // line: it runs only after the founder's explicit confirmation (the
        // chat surface's approve control — toolExecutor / the approve route).
        if (name === "resume" && input.target === "ads" && opts.confirmed !== true) {
          return { ok: false, text: "Resuming ad spending needs your explicit confirmation — nothing changed. Confirm it with the approve control on this message." };
        }
        const r = await setPaused(input.target, name === "pause", founderUserId);
        if (r.target === "ads") {
          // Say exactly what was switched and what was NOT, read from real state:
          // the switch governs the AUTOPILOT's ads; campaigns the founder
          // launched himself keep running until he pauses them.
          const { liveFounderCampaigns } = await import("../../autopilot/founderControls");
          const live = await liveFounderCampaigns();
          const own =
            live == null
              ? "I could not read the campaigns you launched yourself, so I cannot tell you whether any are still spending — check them where they run; this switch did not pause them."
              : live.length === 0
                ? "No campaign you launched yourself is marked active in AcreOS."
                : `NOT paused: ${live.length} campaign(s) you launched yourself are still marked active and keep spending until you pause them where they run — ${live.map((c) => `"${c.name}" (${c.platform}, $${(c.dailyBudgetCents / 100).toFixed(2)}/day)`).join("; ")}.`;
          if (r.paused) {
            return {
              ok: true,
              text: `The autopilot's ad spending is OFF: it will not launch or run an ad. Cancelled ${r.dispatchesCancelled.length} queued/in-flight ad task(s); rejected ${r.pendingActionsRejected.length} pending autopilot ad draft(s). ${own}`,
            };
          }
          return { ok: true, text: `The autopilot may propose ads again (each still needs a witness and stays under its ceiling). ${own}` };
        }
        return {
          ok: true,
          text: `${r.target} is ${r.paused ? "paused" : "running again"}. Cancelled ${r.dispatchesCancelled.length} queued/in-flight task(s); rejected ${r.pendingActionsRejected.length} drafted action(s) waiting in ${r.target}.`,
        };
      }
      default:
        return { ok: false, text: `unknown business tool ${name}` };
    }
  } catch (err) {
    logger.warn(`[soleneChat] business tool ${name} failed`, err instanceof Error ? err : undefined);
    return { ok: false, text: `${name} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
