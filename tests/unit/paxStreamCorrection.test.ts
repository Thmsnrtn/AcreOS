import { describe, it, expect } from "vitest";
import { reducePaxTextEvent, type PaxTextStreamState } from "@/components/pax-copilot-rail";

// Replays a sequence of SSE events through the pure Pax text reducer the way the
// client stream consumer does, returning the final accumulated state.
function replay(events: Array<{ type?: string; content?: unknown }>): PaxTextStreamState {
  return events.reduce(reducePaxTextEvent, { content: "", corrected: false });
}

describe("reducePaxTextEvent — Pax hallucination-guard correction", () => {
  it("appends successive content deltas", () => {
    const state = replay([
      { type: "content", content: "The parcel " },
      { type: "content", content: "is 5 acres." },
    ]);
    expect(state).toEqual({ content: "The parcel is 5 acres.", corrected: false });
  });

  it("replaces the in-progress text when a correction arrives", () => {
    const state = replay([
      { type: "content", content: "The parcel is 50 acres." },
      { type: "correction", content: "I don't have the acreage on file for that parcel." },
    ]);
    expect(state.content).toBe("I don't have the acreage on file for that parcel.");
    expect(state.corrected).toBe(true);
  });

  it("ignores pre-correction content deltas that arrive after the correction", () => {
    const state = replay([
      { type: "content", content: "The parcel is 50 acres" },
      { type: "correction", content: "Corrected: acreage is unknown." },
      // A late delta from the original (now-superseded) turn must not append.
      { type: "content", content: " and worth $100k." },
    ]);
    expect(state.content).toBe("Corrected: acreage is unknown.");
    expect(state.corrected).toBe(true);
  });

  it("is a no-op for unrelated event types", () => {
    const before: PaxTextStreamState = { content: "partial", corrected: false };
    expect(reducePaxTextEvent(before, { type: "tool_start" })).toBe(before);
    expect(reducePaxTextEvent(before, { type: "done" })).toBe(before);
    expect(reducePaxTextEvent(before, { type: "thinking", content: "hmm" })).toBe(before);
  });

  it("ignores empty / non-string content deltas", () => {
    const before: PaxTextStreamState = { content: "x", corrected: false };
    expect(reducePaxTextEvent(before, { type: "content", content: "" })).toBe(before);
    expect(reducePaxTextEvent(before, { type: "content", content: undefined })).toBe(before);
    expect(reducePaxTextEvent(before, { type: "content", content: 42 })).toBe(before);
  });

  it("accepts an empty-string correction (full deflection)", () => {
    const state = reducePaxTextEvent(
      { content: "bad claim", corrected: false },
      { type: "correction", content: "" },
    );
    expect(state).toEqual({ content: "", corrected: true });
  });
});
