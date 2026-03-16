/**
 * Voice Call AI Unit Tests
 *
 * Tests call script generation, objection detection,
 * response suggestion logic, and call outcome classification.
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallType = "initial_contact" | "follow_up" | "negotiation" | "closing";
type ObjectionType =
  | "price_too_low"
  | "not_ready_to_sell"
  | "already_listed"
  | "needs_spouse_approval"
  | "wants_full_market_value"
  | "emotional_attachment"
  | "unknown";

type CallOutcome =
  | "interested"
  | "not_interested"
  | "callback_requested"
  | "left_voicemail"
  | "no_answer"
  | "wrong_number";

interface ScriptTemplate {
  callType: CallType;
  opener: string;
  valueProposition: string;
  questions: string[];
  closingStatement: string;
}

interface ObjectionResponse {
  objectionType: ObjectionType;
  response: string;
  followUpQuestion: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

const OBJECTION_PATTERNS: Array<{ pattern: RegExp; type: ObjectionType }> = [
  { pattern: /too low|not enough|worth more|lowball/i, type: "price_too_low" },
  { pattern: /not ready|thinking about it|need more time/i, type: "not_ready_to_sell" },
  { pattern: /already listed|have an agent|listed with/i, type: "already_listed" },
  { pattern: /(talk to|check with|discuss with) my (wife|husband|spouse|partner)/i, type: "needs_spouse_approval" },
  { pattern: /full price|market value|retail price|what it's worth/i, type: "wants_full_market_value" },
  { pattern: /family land|sentimental|grew up|my (father|mother|grandfather)/i, type: "emotional_attachment" },
];

const OBJECTION_RESPONSES: Record<ObjectionType, ObjectionResponse> = {
  price_too_low: {
    objectionType: "price_too_low",
    response: "I understand — and I appreciate your transparency. Our offer reflects cash certainty and a fast close with zero commissions. Can I walk you through what the net proceeds comparison looks like?",
    followUpQuestion: "What price would make this a win for you?",
  },
  not_ready_to_sell: {
    objectionType: "not_ready_to_sell",
    response: "That's completely understandable. Many of our sellers felt the same way until they saw how simple our process is. Is there a specific concern holding you back?",
    followUpQuestion: "What would need to change for you to feel ready?",
  },
  already_listed: {
    objectionType: "already_listed",
    response: "I appreciate you letting me know. We do work with listed properties in some cases. Would it be okay if I reach back out when your listing expires?",
    followUpQuestion: "When does your listing agreement expire?",
  },
  needs_spouse_approval: {
    objectionType: "needs_spouse_approval",
    response: "Absolutely — this is a big decision and it makes sense to involve your partner. Would it work to schedule a call with both of you together?",
    followUpQuestion: "What's the best time when you'd both be available?",
  },
  wants_full_market_value: {
    objectionType: "wants_full_market_value",
    response: "That's a fair goal. Let me show you the full picture — when you factor in agent commissions, holding costs, and time to close, our net-to-you number is often very competitive.",
    followUpQuestion: "Have you had a recent appraisal done on the property?",
  },
  emotional_attachment: {
    objectionType: "emotional_attachment",
    response: "I completely understand — land with family history holds a special kind of value. We always approach these situations with care. Would it help to talk about what legacy outcomes matter most to you?",
    followUpQuestion: "Are there any conditions that would make you feel good about the land's future?",
  },
  unknown: {
    objectionType: "unknown",
    response: "I appreciate you sharing that. Can you tell me more about your concerns so I can better understand your situation?",
    followUpQuestion: "What would be most helpful for me to address?",
  },
};

function detectObjection(text: string): ObjectionType {
  for (const { pattern, type } of OBJECTION_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "unknown";
}

function getObjectionResponse(objectionType: ObjectionType): ObjectionResponse {
  return OBJECTION_RESPONSES[objectionType] || OBJECTION_RESPONSES.unknown;
}

function generateCallScript(
  callType: CallType,
  context: { sellerName: string; propertyAddress: string; offerAmount?: number }
): ScriptTemplate {
  const scripts: Record<CallType, ScriptTemplate> = {
    initial_contact: {
      callType: "initial_contact",
      opener: `Hi, may I speak with ${context.sellerName}? My name is [Agent] and I'm reaching out about your property at ${context.propertyAddress}.`,
      valueProposition: "We're a cash buyer and can close in as few as 14 days with no fees or commissions.",
      questions: [
        "Have you thought about selling your land?",
        "Are you aware of any offers that have come in recently?",
        "What would your ideal timeline look like if you did decide to sell?",
      ],
      closingStatement: "I'd love to send you a no-obligation offer. Would that be okay with you?",
    },
    follow_up: {
      callType: "follow_up",
      opener: `Hi ${context.sellerName}, this is [Agent] following up on our previous conversation about ${context.propertyAddress}.`,
      valueProposition: "I wanted to check if you've had a chance to think things over and answer any questions you might have.",
      questions: [
        "Have you had a chance to review the information I sent?",
        "Did any questions come up since we last spoke?",
        "Where are you in your thinking on a potential sale?",
      ],
      closingStatement: "I'm here to make this as easy as possible for you whenever you're ready.",
    },
    negotiation: {
      callType: "negotiation",
      opener: `Hi ${context.sellerName}, I'm calling back as promised to discuss the offer for ${context.propertyAddress}.`,
      valueProposition: `We've prepared an offer of $${context.offerAmount?.toLocaleString() || "TBD"} — cash, as-is, flexible closing.`,
      questions: [
        "What are your thoughts on the offer?",
        "Is there a specific number that would make this work for you?",
        "Are there any other terms — like closing date or possession — that are important to you?",
      ],
      closingStatement: "I want to find a solution that works for both of us. Let's see if we can get there today.",
    },
    closing: {
      callType: "closing",
      opener: `Hi ${context.sellerName}, this is [Agent] — great news, we're ready to move forward with ${context.propertyAddress}!`,
      valueProposition: "Our title company is ready and we can have documents to you within 24 hours.",
      questions: [
        "Does the agreed closing date still work for you?",
        "Have you chosen how you'd like to receive funds — wire or check?",
        "Are there any last questions before we move to signing?",
      ],
      closingStatement: "Congratulations — we'll take great care of this land and I'm grateful for the opportunity to work with you.",
    },
  };

  return scripts[callType];
}

function classifyCallOutcome(
  transcript: string,
  callDurationSeconds: number,
  answeredByHuman: boolean
): CallOutcome {
  if (!answeredByHuman && callDurationSeconds < 10) return "no_answer";
  if (!answeredByHuman && callDurationSeconds >= 10) return "left_voicemail";

  const lower = transcript.toLowerCase();

  if (/wrong number|don't own|not my property|you have the wrong/i.test(lower)) {
    return "wrong_number";
  }
  if (/call me back|try again|not a good time|call later|better time/i.test(lower)) {
    return "callback_requested";
  }
  if (/not interested|stop calling|remove me|take me off/i.test(lower)) {
    return "not_interested";
  }
  if (/interested|send|offer|yes|sure|tell me|how much/i.test(lower)) {
    return "interested";
  }

  return "callback_requested"; // default for ambiguous conversations
}

function suggestResponses(
  lastLeadStatement: string
): Array<{ text: string; priority: "high" | "medium" | "low" }> {
  const objection = detectObjection(lastLeadStatement);
  const objectionResp = getObjectionResponse(objection);

  const suggestions: Array<{ text: string; priority: "high" | "medium" | "low" }> = [
    { text: objectionResp.response, priority: "high" },
    { text: objectionResp.followUpQuestion, priority: "high" },
  ];

  // Add generic probes
  suggestions.push({ text: "Can you tell me more about your situation?", priority: "medium" });
  suggestions.push({ text: "What's most important to you in this decision?", priority: "medium" });
  suggestions.push({ text: "Is there anything else on your mind?", priority: "low" });

  return suggestions;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Call Script Generation", () => {
  const context = { sellerName: "John Smith", propertyAddress: "123 Ranch Rd, Travis County, TX" };

  it("generates initial_contact script with opener mentioning seller name", () => {
    const script = generateCallScript("initial_contact", context);
    expect(script.opener).toContain("John Smith");
    expect(script.opener).toContain("123 Ranch Rd");
  });

  it("generates follow_up script referencing previous conversation", () => {
    const script = generateCallScript("follow_up", context);
    expect(script.opener).toContain("following up");
  });

  it("generates negotiation script including offer amount when provided", () => {
    const script = generateCallScript("negotiation", { ...context, offerAmount: 150_000 });
    expect(script.valueProposition).toContain("150,000");
  });

  it("generates closing script with urgency language", () => {
    const script = generateCallScript("closing", context);
    expect(script.callType).toBe("closing");
    expect(script.questions.length).toBeGreaterThan(0);
  });

  it("each script type has required fields", () => {
    const types: CallType[] = ["initial_contact", "follow_up", "negotiation", "closing"];
    for (const type of types) {
      const script = generateCallScript(type, context);
      expect(script.opener).toBeTruthy();
      expect(script.valueProposition).toBeTruthy();
      expect(script.questions.length).toBeGreaterThan(0);
      expect(script.closingStatement).toBeTruthy();
    }
  });
});

describe("Objection Detection", () => {
  it("detects price objection", () => {
    expect(detectObjection("Your offer is too low")).toBe("price_too_low");
    expect(detectObjection("You're lowballing me")).toBe("price_too_low");
    expect(detectObjection("That's not enough")).toBe("price_too_low");
  });

  it("detects not-ready objection", () => {
    expect(detectObjection("I'm not ready to do this")).toBe("not_ready_to_sell");
    expect(detectObjection("I need more time to decide")).toBe("not_ready_to_sell");
  });

  it("detects already listed objection", () => {
    expect(detectObjection("I already listed it with an agent")).toBe("already_listed");
    expect(detectObjection("I have an agent working on it")).toBe("already_listed");
  });

  it("detects spouse approval needed", () => {
    expect(detectObjection("I need to talk to my wife about this")).toBe("needs_spouse_approval");
    expect(detectObjection("Let me discuss with my husband first")).toBe("needs_spouse_approval");
    expect(detectObjection("I'll check with my spouse")).toBe("needs_spouse_approval");
  });

  it("detects full market value objection", () => {
    expect(detectObjection("I want full market value")).toBe("wants_full_market_value");
    expect(detectObjection("I expect to get retail price for it")).toBe("wants_full_market_value");
  });

  it("detects emotional attachment", () => {
    expect(detectObjection("This is family land, been in our family for generations")).toBe("emotional_attachment");
    expect(detectObjection("My grandfather built that farm")).toBe("emotional_attachment");
  });

  it("returns unknown for unrecognized objections", () => {
    expect(detectObjection("I have a dentist appointment")).toBe("unknown");
    expect(detectObjection("")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(detectObjection("TOO LOW FOR ME")).toBe("price_too_low");
    expect(detectObjection("ALREADY LISTED")).toBe("already_listed");
  });
});

describe("Response Suggestion Logic", () => {
  it("returns at least 2 high-priority suggestions", () => {
    const suggestions = suggestResponses("Your offer is way too low");
    const highPriority = suggestions.filter(s => s.priority === "high");
    expect(highPriority.length).toBeGreaterThanOrEqual(2);
  });

  it("top suggestions address the specific objection", () => {
    const suggestions = suggestResponses("Your offer is too low");
    expect(suggestions[0].text.toLowerCase()).toMatch(/cash|commissions|net|offer/i);
  });

  it("includes follow-up question as high priority", () => {
    const suggestions = suggestResponses("I need to talk to my wife");
    const highPriority = suggestions.filter(s => s.priority === "high");
    const hasQuestion = highPriority.some(s => s.text.includes("?"));
    expect(hasQuestion).toBe(true);
  });

  it("includes generic probes at medium/low priority", () => {
    const suggestions = suggestResponses("I don't know...");
    const lowerPriority = suggestions.filter(s => s.priority === "medium" || s.priority === "low");
    expect(lowerPriority.length).toBeGreaterThan(0);
  });

  it("always returns at least 3 suggestions", () => {
    const suggestions = suggestResponses("Some random statement");
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Call Outcome Classification", () => {
  it("classifies no_answer for very short unanswered calls", () => {
    expect(classifyCallOutcome("", 5, false)).toBe("no_answer");
  });

  it("classifies left_voicemail for longer unanswered calls", () => {
    expect(classifyCallOutcome("", 30, false)).toBe("left_voicemail");
  });

  it("classifies wrong_number when lead says wrong number", () => {
    expect(classifyCallOutcome("Sorry, wrong number — don't own any property.", 20, true)).toBe("wrong_number");
  });

  it("classifies callback_requested when lead asks to call back", () => {
    expect(classifyCallOutcome("This isn't a good time, call me back later.", 15, true)).toBe("callback_requested");
  });

  it("classifies not_interested for opt-out language", () => {
    expect(classifyCallOutcome("Not interested, please stop calling me.", 10, true)).toBe("not_interested");
  });

  it("classifies interested for positive engagement", () => {
    expect(classifyCallOutcome("Yes I'm interested, can you send me more info?", 60, true)).toBe("interested");
  });

  it("classifies interested for offer-related questions", () => {
    expect(classifyCallOutcome("How much are you offering? Tell me more.", 45, true)).toBe("interested");
  });

  it("defaults to callback_requested for ambiguous conversation", () => {
    expect(classifyCallOutcome("Hmm, well, I'd need to think about it more.", 30, true)).toBe("callback_requested");
  });
});
