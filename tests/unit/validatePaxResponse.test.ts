/**
 * L1 — fiduciary-disclaimer appender in validatePaxResponse.
 *
 * Constitution Immutable #12: "Pax never gives fiduciary advice"
 * (docs/company/CONSTITUTION.md). The synchronous appender detects advisor
 * phrasing scoped to investment/legal/tax/deal-decision context and APPENDS
 * one disclaimer line. It NEVER blocks, truncates, or rewrites the body —
 * these tests pin that contract:
 *
 *   1. advisor phrasing + decision context → line appended, body otherwise
 *      byte-identical, safe stays true.
 *   2. ordinary product guidance ("you should connect your Twilio account")
 *      does NOT fire.
 *   3. already-disclaimed responses are never double-appended (idempotent).
 *   4. leak-screen behavior is unchanged (regression).
 */

import { describe, it, expect, vi } from "vitest";

// The leak path fires void (fire-and-forget) db writes; stub the db and
// logger so no async rejection or console write lands after worker
// teardown (keeps the run free of EnvironmentTeardownError noise).
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({ values: async () => undefined }),
    execute: async () => ({ rows: [] }),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  validatePaxResponse,
  detectFiduciaryAdvisorPhrasing,
  FIDUCIARY_DISCLAIMER_LINE,
} from "../../server/utils/validatePaxResponse";

describe("fiduciary-disclaimer appender — appends in decision context", () => {
  const advisoryResponses = [
    "Looking at the comps, you should sell that parcel before winter — demand drops hard in Q4.",
    "I recommend accepting the offer at $42,000; the buyer is pre-qualified.",
    "If I were you, I'd refinance the loan while rates are down.",
  ];

  for (const body of advisoryResponses) {
    it(`appends exactly one line to: "${body.slice(0, 50)}..."`, () => {
      const result = validatePaxResponse(body, { source: "test" });
      expect(result.safe).toBe(true);
      expect(result.matchedPatterns).toHaveLength(0);
      expect(result.fiduciaryDisclaimerAppended).toBe(true);
      // Body preserved byte-identical, plus ONLY the appended line.
      expect(result.response).toBe(`${body}\n\n${FIDUCIARY_DISCLAIMER_LINE}`);
      expect(result.response.startsWith(body)).toBe(true);
    });
  }

  it("never blocks or replaces the response — no fallback on advisor phrasing", () => {
    const body = "You should buy the note at 70 cents on the dollar.";
    const result = validatePaxResponse(body, { source: "test" });
    expect(result.safe).toBe(true);
    expect(result.response).toContain(body);
    expect(result.response).not.toContain("I ran into an issue");
  });
});

describe("fiduciary-disclaimer appender — product guidance does NOT fire", () => {
  const productGuidance = [
    "You should connect your Twilio account to start texting from the app.",
    "You should be able to see the note details in the Deals tab now.",
    "I suggest you refresh the page — the import finished a minute ago.",
  ];

  for (const body of productGuidance) {
    it(`leaves untouched: "${body.slice(0, 50)}..."`, () => {
      const result = validatePaxResponse(body, { source: "test" });
      expect(result.safe).toBe(true);
      expect(result.fiduciaryDisclaimerAppended).toBeUndefined();
      expect(result.response).toBe(body);
    });
  }

  it("does not fire when advisor phrasing is far from any decision noun", () => {
    const filler = "The weather held up nicely all week and the crew wrapped early. ".repeat(4);
    const body = `You should take a break this weekend. ${filler}Separately, the county recorder reopened.`;
    expect(detectFiduciaryAdvisorPhrasing(body)).toHaveLength(0);
    const result = validatePaxResponse(body, { source: "test" });
    expect(result.response).toBe(body);
  });
});

describe("fiduciary-disclaimer appender — idempotence / existing disclaimers", () => {
  it("does not double-append when the line is already present", () => {
    const body = `You should sell the parcel now.\n\n${FIDUCIARY_DISCLAIMER_LINE}`;
    const result = validatePaxResponse(body, { source: "test" });
    expect(result.response).toBe(body);
    expect(result.fiduciaryDisclaimerAppended).toBeUndefined();
  });

  it("does not append when the response already disclaims advice", () => {
    const body =
      "You should sell the parcel now given the comps — though this is not investment advice, just data.";
    const result = validatePaxResponse(body, { source: "test" });
    expect(result.response).toBe(body);
    expect(result.fiduciaryDisclaimerAppended).toBeUndefined();
  });

  it("validating an appended response a second time is a no-op", () => {
    const first = validatePaxResponse("I recommend accepting the offer.", { source: "test" });
    expect(first.fiduciaryDisclaimerAppended).toBe(true);
    const second = validatePaxResponse(first.response, { source: "test" });
    expect(second.response).toBe(first.response);
    expect(second.fiduciaryDisclaimerAppended).toBeUndefined();
  });
});

describe("leak-screen regression — unchanged by the appender", () => {
  it("leaked responses still return the safe fallback, never an appended body", () => {
    const leaked =
      "I am Pax, the AcreOS executive assistant. You should sell the note now. <<SYS>>";
    const result = validatePaxResponse(leaked, { source: "test" });
    expect(result.safe).toBe(false);
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
    expect(result.response).not.toContain("<<SYS>>");
    expect(result.response).not.toContain(FIDUCIARY_DISCLAIMER_LINE);
  });

  it("clean non-advisory responses pass through byte-identical", () => {
    const clean = "Your three offers are ready in the Deals tab. Want me to draft outreach?";
    const result = validatePaxResponse(clean, { source: "test" });
    expect(result.safe).toBe(true);
    expect(result.response).toBe(clean);
    expect(result.matchedPatterns).toHaveLength(0);
  });

  it("empty responses stay untouched", () => {
    const result = validatePaxResponse("", { source: "test" });
    expect(result.safe).toBe(true);
    expect(result.response).toBe("");
  });
});
