/**
 * F3b — Solene chat receipts (experience-legibility cluster).
 *
 * Pins the pure derivation layer behind the receipt chips + "Show the work"
 * disclosure on /founder/solene-chat:
 *
 *   - deriveReceipts: pairs tool_use ↔ tool_result and chips ONLY successful
 *     artifact creations (record_decision, enqueue_dispatch, witnessed-send
 *     freezes). Errors / refusals / read-only calls never chip.
 *   - buildRenderItems: segments a persisted conversation into bubbles +
 *     collapsed work groups + receipt rows; the turn runner's tool-output
 *     carrier rows (role "user", all tool_result blocks) never become bubbles,
 *     and chips land under the reply that follows the work.
 *
 * Fixture shapes mirror server/services/solene/chat/turnRunner.ts persistence
 * and server/services/solene/dispatchToolExecutor.ts result JSON verbatim.
 */
import { describe, it, expect } from "vitest";
import {
  buildRenderItems,
  deriveReceipts,
  isToolResultCarrier,
  type WorkStep,
} from "@/components/solene/chatWork";
import type { UiMessage } from "@/hooks/useSoleneChat";

function msg(partial: Partial<UiMessage> & Pick<UiMessage, "role" | "content">): UiMessage {
  return { id: 1, sentAt: new Date("2026-07-08T00:00:00Z"), ...partial };
}

const recordDecisionStep = (id: number, opts?: { isError?: boolean; content?: string }): WorkStep => ({
  toolUse: {
    type: "tool_use",
    id: `toolu_${id}`,
    name: "record_decision",
    input: { decision_kind: "policy", summary: "s", rationale: "r" },
  },
  result: {
    type: "tool_result",
    tool_use_id: `toolu_${id}`,
    content: opts?.content ?? JSON.stringify({ decision_id: id }),
    ...(opts?.isError ? { is_error: true } : {}),
  },
});

describe("deriveReceipts", () => {
  it("chips a successful record_decision with the created id", () => {
    const receipts = deriveReceipts([recordDecisionStep(214)]);
    expect(receipts).toEqual([
      { type: "decision", label: "Decision #214", href: "/founder/decisions" },
    ]);
  });

  it("chips a successful enqueue_dispatch as a queued dispatch", () => {
    const receipts = deriveReceipts([
      {
        toolUse: { type: "tool_use", id: "toolu_d", name: "enqueue_dispatch", input: {} },
        result: {
          type: "tool_result",
          tool_use_id: "toolu_d",
          content: JSON.stringify({ dispatch_id: 7 }),
        },
      },
    ]);
    expect(receipts).toEqual([
      { type: "dispatch", label: "Dispatch queued", href: "/founder/dispatches" },
    ]);
  });

  it("chips a witnessed-send freeze as an approval waiting on the founder", () => {
    const receipts = deriveReceipts([
      {
        toolUse: { type: "tool_use", id: "toolu_h", name: "send_email", input: {} },
        result: {
          type: "tool_result",
          tool_use_id: "toolu_h",
          content:
            "[WITNESSED-SEND] 'send_email' has been drafted and FROZEN for the " +
            "founder's approval (pending action #12). Nothing was sent. It executes " +
            "only when the founder taps Approve in /decisions.",
        },
      },
    ]);
    expect(receipts).toEqual([
      { type: "approval", label: "Waiting for your approval", href: "/founder/decisions" },
    ]);
  });

  it("never chips errors, refusals, malformed results, or read-only calls", () => {
    expect(deriveReceipts([recordDecisionStep(9, { isError: true })])).toEqual([]);
    expect(
      deriveReceipts([recordDecisionStep(9, { content: "Error: record_decision: dispatch context missing agent_role (cannot tag decision)." })]),
    ).toEqual([]);
    expect(deriveReceipts([recordDecisionStep(9, { content: "not json" })])).toEqual([]);
    expect(deriveReceipts([recordDecisionStep(9, { content: '{"decision_id":"nope"}' })])).toEqual([]);
    expect(
      deriveReceipts([
        {
          toolUse: { type: "tool_use", id: "t", name: "file_read", input: { path: "x" } },
          result: { type: "tool_result", tool_use_id: "t", content: "file body" },
        },
      ]),
    ).toEqual([]);
    // Result with no matching tool_use — nothing to attribute, nothing chips.
    expect(
      deriveReceipts([
        { result: { type: "tool_result", tool_use_id: "orphan", content: '{"decision_id":3}' } },
      ]),
    ).toEqual([]);
  });
});

describe("buildRenderItems", () => {
  it("treats turn-runner tool-output rows as carriers, not user bubbles", () => {
    const carrier = msg({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"decision_id":214}' }],
    });
    expect(isToolResultCarrier(carrier)).toBe(true);
    expect(isToolResultCarrier(msg({ role: "user", content: [{ type: "text", text: "hi" }] }))).toBe(false);
    expect(isToolResultCarrier(msg({ role: "tool", content: [] }))).toBe(true);
  });

  it("segments a persisted record_decision turn into bubble → work → reply → chips", () => {
    const messages: UiMessage[] = [
      msg({ id: 1, role: "user", content: [{ type: "text", text: "Record this decision." }] }),
      msg({
        id: 2,
        role: "assistant",
        content: [
          { type: "text", text: "I'll record that now." },
          { type: "tool_use", id: "toolu_1", name: "record_decision", input: { decision_kind: "policy", summary: "s", rationale: "r" } },
        ],
      }),
      msg({
        id: 3,
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"decision_id":214}' }],
      }),
      msg({ id: 4, role: "assistant", content: [{ type: "text", text: "Done — recorded." }] }),
    ];

    const items = buildRenderItems(messages);
    expect(items.map((i) => i.kind)).toEqual([
      "message", // user prompt
      "message", // "I'll record that now."
      "work", // the tool run, collapsed
      "message", // "Done — recorded."
      "receipts", // Decision #214 chip under the reply
    ]);

    const work = items[2];
    if (work.kind !== "work") throw new Error("expected work item");
    expect(work.steps).toHaveLength(1);
    expect(work.steps[0].toolUse?.name).toBe("record_decision");
    expect(work.steps[0].result?.content).toBe('{"decision_id":214}');

    const receipts = items[4];
    if (receipts.kind !== "receipts") throw new Error("expected receipts item");
    expect(receipts.receipts).toEqual([
      { type: "decision", label: "Decision #214", href: "/founder/decisions" },
    ]);
  });

  it("closes an open tool run before the next real user message", () => {
    const messages: UiMessage[] = [
      msg({
        id: 1,
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "record_decision", input: {} }],
      }),
      msg({
        id: 2,
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"decision_id":5}' }],
      }),
      msg({ id: 3, role: "user", content: [{ type: "text", text: "next question" }] }),
    ];
    const items = buildRenderItems(messages);
    // Tool-only assistant hop renders no bubble; chips land right after the
    // work when no reply follows it.
    expect(items.map((i) => i.kind)).toEqual(["work", "receipts", "message"]);
  });

  it("drops empty-placeholder assistant rows and keeps failed calls chip-free", () => {
    const messages: UiMessage[] = [
      msg({
        id: 1,
        role: "assistant",
        content: [
          { type: "text", text: "Trying." },
          { type: "tool_use", id: "toolu_1", name: "record_decision", input: {} },
        ],
      }),
      msg({
        id: 2,
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "Error: record_decision: dispatch context missing agent_role (cannot tag decision).",
          },
        ],
      }),
      msg({ id: 3, role: "assistant", content: [{ type: "text", text: "" }] }),
    ];
    const items = buildRenderItems(messages);
    expect(items.map((i) => i.kind)).toEqual(["message", "work"]);
  });
});
