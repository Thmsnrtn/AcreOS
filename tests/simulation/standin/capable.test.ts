/**
 * The capable brain's work clears the product's own gates — otherwise a run
 * with it would measure the brain's mistakes, not the business.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs brain, no declarations
import { answer } from "./brains/capable.mjs";
import { parsePublishable, screenForPublish } from "../../../server/services/autopilot/publishArtifact";
import { screenFabrication } from "../../../server/services/autopilot/contentHonesty";

const req = (system: string, user: string, more: Array<{ role: string; content: string }> = []) => ({ system, messages: [{ role: "user", content: user }, ...more], tools: [], forced: null, schema: null });

describe("capable brain", () => {
  it("writes articles the publish gate accepts, and does not repeat a published title", () => {
    const first = answer(req("AcreOS role worker — Writer\n...", "Write.\n## Already published\nNothing yet — this is the first piece."));
    const p = parsePublishable(first.content);
    expect(p).not.toBeNull();
    const s = screenForPublish(p!);
    expect(s.ok, JSON.stringify(s)).toBe(true);
    const second = answer(req("AcreOS role worker — Writer", `Write.\n## Already published — do not repeat these topics\n- ${p!.subject}`));
    expect(parsePublishable(second.content)!.subject).not.toBe(p!.subject);
    for (let i = 0; i < 40; i++) {
      const titles: string[] = [];
      const a = answer(req("AcreOS role worker — Writer", `## Already published\n${titles.map((t) => `- ${t}`).join("\n")}`));
      const pp = parsePublishable(a.content)!;
      expect(screenForPublish(pp).ok).toBe(true);
    }
  });

  it("refunds a $30 purchase it can match, escalates an $80 one, and its replies pass the honesty screen", () => {
    const brief = (id: number, subj: string, wrote: string) => `Work it.\n\n## The ticket you are working (one ticket per run)\n\n### Ticket #${id} — ${subj}\n- Organization: #9 "X" (pro, active)\n- Category: billing; opened now\n- Customer wrote: ${wrote}`;
    const sys = "AcreOS role worker — Support";
    const t0 = answer(req(sys, brief(4, "Refund request", "I was charged $30 for a pack I never used.")));
    expect(t0.tool_calls[0].name).toBe("list_recent_purchases");
    const purchases = JSON.stringify([{ amount_cents: 3000, description: "Skip-trace credit pack", payment_intent_id: "pi_1", at: "x" }]);
    const t1 = answer(req(sys, brief(4, "Refund request", "I was charged $30 for a pack I never used."), [{ role: "assistant", content: "" }, { role: "tool", content: purchases }]));
    expect(t1.tool_calls.map((c: any) => c.name)).toEqual(["refund_purchase", "reply_to_ticket"]);
    expect(screenFabrication(t1.tool_calls[1].arguments.message, { allowDollarFigures: ["$30", "$30.00"] })).toEqual([]);
    const big = answer(req(sys, brief(5, "Please refund $80", "Refund one of the $80 charges."), [{ role: "assistant", content: "" }, { role: "tool", content: JSON.stringify([{ amount_cents: 8000, description: "Comps add-on", payment_intent_id: "pi_2", at: "x" }]) }]));
    expect(big.tool_calls.map((c: any) => c.name)).toEqual(["escalate_to_founder", "reply_to_ticket"]);
    const howto = answer(req(sys, brief(6, "How do I import?", "How do I import a CSV of leads?")));
    expect(howto.tool_calls[0].arguments.resolve).toBe(true);
    expect(screenFabrication(howto.tool_calls[0].arguments.message)).toEqual([]);
  });
});
