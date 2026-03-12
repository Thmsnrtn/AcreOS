/**
 * Integration Test: Negotiation Session Flow
 * start session → detect objection → generate response → close
 */
import { describe, it, expect, vi } from "vitest";

// Pure logic mirrors (no DB required for unit-level integration testing)
type SessionStatus = "active" | "closed_won" | "closed_lost" | "stalled";
type ObjectionType = "price" | "timeline" | "financing" | "condition" | "competition";
type StrategyType = "anchor_high" | "incremental_concession" | "package_deal" | "time_pressure" | "collaborative";

interface NegotiationSession {
  id: number;
  dealId: number;
  orgId: number;
  status: SessionStatus;
  strategy: StrategyType;
  moves: NegotiationMove[];
  context: { askingPrice: number; currentOffer: number; counterpartyType: string };
}

interface NegotiationMove {
  id: number;
  type: "offer" | "counter" | "objection_response" | "concession" | "close";
  content: string;
  amount?: number;
  reasoning?: string;
  timestamp: Date;
}

function createSession(dealId: number, orgId: number, askingPrice: number, strategy: StrategyType): NegotiationSession {
  return {
    id: Math.floor(Math.random() * 10000),
    dealId, orgId, status: "active", strategy,
    moves: [],
    context: { askingPrice, currentOffer: askingPrice * 0.85, counterpartyType: "motivated_seller" },
  };
}

function detectObjection(transcript: string): ObjectionType | null {
  const lower = transcript.toLowerCase();
  if (lower.includes("price") || lower.includes("too much") || lower.includes("expensive")) return "price";
  if (lower.includes("timeline") || lower.includes("closing date") || lower.includes("when")) return "timeline";
  if (lower.includes("financing") || lower.includes("loan") || lower.includes("cash")) return "financing";
  if (lower.includes("condition") || lower.includes("repair") || lower.includes("issue")) return "condition";
  if (lower.includes("other buyer") || lower.includes("competitor") || lower.includes("backup offer")) return "competition";
  return null;
}

function generateResponse(objection: ObjectionType, session: NegotiationSession): NegotiationMove {
  const responses: Record<ObjectionType, { content: string; reasoning: string }> = {
    price: {
      content: `I understand the price concern. Given comparable sales in ${session.context.counterpartyType === "motivated_seller" ? "the area" : "your market"}, our offer of $${session.context.currentOffer.toLocaleString()} reflects current market conditions. Could we explore a quick close to make this work?`,
      reasoning: "Address price objection with market data and close incentive",
    },
    timeline: {
      content: "We can work with your preferred timeline. Our team can close in as little as 14 days or extend to 45 days — whichever works best for you.",
      reasoning: "Offer timeline flexibility to remove objection",
    },
    financing: {
      content: "We're prepared to close this as an all-cash transaction with no financing contingency. You'll have certainty of closing.",
      reasoning: "Highlight cash offer certainty to reduce counterparty risk concerns",
    },
    condition: {
      content: "We're purchasing this as-is and have factored any condition considerations into our offer price. You won't need to make any repairs.",
      reasoning: "Remove condition contingency to simplify transaction",
    },
    competition: {
      content: "We're a serious buyer ready to move immediately. We can provide proof of funds today and sign a purchase agreement within 24 hours — certainty that a backup offer can't match.",
      reasoning: "Differentiate on speed and certainty vs competing offers",
    },
  };
  const r = responses[objection];
  const move: NegotiationMove = {
    id: Math.floor(Math.random() * 10000),
    type: "objection_response",
    content: r.content,
    reasoning: r.reasoning,
    timestamp: new Date(),
  };
  session.moves.push(move);
  return move;
}

function makeConcession(session: NegotiationSession, newAmount: number, reason: string): NegotiationMove {
  if (newAmount > session.context.askingPrice) throw new Error("Concession cannot exceed asking price");
  session.context.currentOffer = newAmount;
  const move: NegotiationMove = {
    id: Math.floor(Math.random() * 10000),
    type: "concession",
    content: `We're prepared to increase our offer to $${newAmount.toLocaleString()}.`,
    amount: newAmount,
    reasoning: reason,
    timestamp: new Date(),
  };
  session.moves.push(move);
  return move;
}

function closeSession(session: NegotiationSession, outcome: "won" | "lost"): void {
  session.status = outcome === "won" ? "closed_won" : "closed_lost";
}

describe("Negotiation Integration", () => {
  describe("Session Creation", () => {
    it("creates session with correct initial state", () => {
      const session = createSession(1, 1, 100000, "incremental_concession");
      expect(session.status).toBe("active");
      expect(session.strategy).toBe("incremental_concession");
      expect(session.context.currentOffer).toBe(85000); // 85% of asking
      expect(session.moves).toHaveLength(0);
    });

    it("supports different negotiation strategies", () => {
      const strategies: StrategyType[] = ["anchor_high", "incremental_concession", "package_deal", "time_pressure", "collaborative"];
      strategies.forEach(strategy => {
        const session = createSession(1, 1, 50000, strategy);
        expect(session.strategy).toBe(strategy);
      });
    });
  });

  describe("Objection Detection", () => {
    it("detects price objections", () => {
      expect(detectObjection("That price is too much for me")).toBe("price");
      expect(detectObjection("This seems too expensive")).toBe("price");
    });

    it("detects timeline objections", () => {
      expect(detectObjection("The closing date doesn't work for me")).toBe("timeline");
      expect(detectObjection("When would we need to close?")).toBe("timeline");
    });

    it("detects financing objections", () => {
      expect(detectObjection("Are you getting a loan or is this cash?")).toBe("financing");
    });

    it("detects condition objections", () => {
      expect(detectObjection("The property has some issues I need to repair")).toBe("condition");
    });

    it("detects competition objections", () => {
      expect(detectObjection("I have another buyer with a backup offer")).toBe("competition");
    });

    it("returns null for no objection", () => {
      expect(detectObjection("This sounds great, let's move forward")).toBeNull();
    });
  });

  describe("Response Generation", () => {
    it("generates contextual response for price objection", () => {
      const session = createSession(1, 1, 100000, "incremental_concession");
      const move = generateResponse("price", session);
      expect(move.type).toBe("objection_response");
      expect(move.content).toBeTruthy();
      expect(move.reasoning).toBeTruthy();
      expect(session.moves).toHaveLength(1);
    });

    it("generates response for each objection type", () => {
      const objections: ObjectionType[] = ["price", "timeline", "financing", "condition", "competition"];
      objections.forEach(objType => {
        const session = createSession(1, 1, 100000, "collaborative");
        const move = generateResponse(objType, session);
        expect(move.content.length).toBeGreaterThan(20);
      });
    });
  });

  describe("Concession Logic", () => {
    it("records concession and updates current offer", () => {
      const session = createSession(1, 1, 100000, "incremental_concession");
      const concession = makeConcession(session, 92000, "Meeting halfway");
      expect(concession.type).toBe("concession");
      expect(concession.amount).toBe(92000);
      expect(session.context.currentOffer).toBe(92000);
    });

    it("rejects concession above asking price", () => {
      const session = createSession(1, 1, 100000, "anchor_high");
      expect(() => makeConcession(session, 110000, "Overpay")).toThrow("Concession cannot exceed asking price");
    });
  });

  describe("Session Close", () => {
    it("closes session as won", () => {
      const session = createSession(1, 1, 100000, "collaborative");
      closeSession(session, "won");
      expect(session.status).toBe("closed_won");
    });

    it("closes session as lost", () => {
      const session = createSession(1, 1, 100000, "collaborative");
      closeSession(session, "lost");
      expect(session.status).toBe("closed_lost");
    });
  });

  describe("Full Session Flow", () => {
    it("runs complete negotiation: start → objection → response → concession → close", () => {
      const session = createSession(1, 1, 80000, "incremental_concession");

      // Detect objection from seller transcript
      const objection = detectObjection("Your price seems too low, I was expecting more");
      expect(objection).toBe("price");

      // Generate response
      const response = generateResponse(objection!, session);
      expect(response.type).toBe("objection_response");

      // Make strategic concession
      const concession = makeConcession(session, 72000, "Responding to price objection");
      expect(concession.amount).toBe(72000);

      // Another objection
      const objection2 = detectObjection("When would you need to close by?");
      expect(objection2).toBe("timeline");
      generateResponse(objection2!, session);

      // Close won
      closeSession(session, "won");
      expect(session.status).toBe("closed_won");
      expect(session.moves).toHaveLength(3); // 2 responses + 1 concession
    });
  });
});
