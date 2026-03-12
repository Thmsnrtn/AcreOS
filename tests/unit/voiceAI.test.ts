/**
 * Voice AI Unit Tests
 *
 * Tests voice AI processing logic:
 * - Call transcription processing and storage
 * - Sentiment extraction from transcript text
 * - Lead linking by phone number
 * - Post-call summary generation
 * - TCPA consent checking
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallDirection = "inbound" | "outbound";
type CallStatus = "initiated" | "in_progress" | "completed" | "failed" | "no_answer";
type Sentiment = "positive" | "neutral" | "negative";

interface TranscriptSegment {
  speaker: "agent" | "lead";
  text: string;
  startSeconds: number;
  endSeconds: number;
}

interface SentimentResult {
  overall: Sentiment;
  score: number; // -1 (negative) to +1 (positive)
  signals: string[];
}

interface CallSummary {
  duration: number;
  keyPoints: string[];
  nextSteps: string[];
  sentiment: Sentiment;
  leadInterestLevel: "high" | "medium" | "low" | "not_interested";
  followUpRequired: boolean;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

const POSITIVE_KEYWORDS = [
  "interested", "love", "great", "yes", "perfect", "definitely", "absolutely",
  "sounds good", "let's move forward", "when can we", "tell me more",
];

const NEGATIVE_KEYWORDS = [
  "not interested", "no thank you", "remove me", "stop calling", "take off",
  "don't call", "not now", "too expensive", "can't afford", "already sold",
];

function extractSentiment(transcript: TranscriptSegment[]): SentimentResult {
  const leadSegments = transcript.filter(s => s.speaker === "lead");
  const combinedText = leadSegments.map(s => s.text.toLowerCase()).join(" ");

  let score = 0;
  const signals: string[] = [];

  for (const kw of POSITIVE_KEYWORDS) {
    if (combinedText.includes(kw)) {
      score += 0.2;
      signals.push(`Positive: "${kw}"`);
    }
  }

  for (const kw of NEGATIVE_KEYWORDS) {
    if (combinedText.includes(kw)) {
      score -= 0.3;
      signals.push(`Negative: "${kw}"`);
    }
  }

  score = Math.max(-1, Math.min(1, score));

  const overall: Sentiment =
    score > 0.1 ? "positive" : score < -0.1 ? "negative" : "neutral";

  return { overall, score: Math.round(score * 100) / 100, signals };
}

function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function checkTcpaConsent(
  phone: string,
  consentRecords: Array<{ phone: string; consentGiven: boolean; consentDate: Date; source: string }>
): { allowed: boolean; reason: string; consentDate?: Date } {
  const normalized = normalizePhoneNumber(phone);
  const record = consentRecords.find(r => normalizePhoneNumber(r.phone) === normalized);

  if (!record) {
    return { allowed: false, reason: "No consent record found — cannot contact" };
  }

  if (!record.consentGiven) {
    return { allowed: false, reason: "Consent explicitly revoked" };
  }

  // Consent expires after 18 months
  const eighteenMonthsMs = 18 * 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - record.consentDate.getTime() > eighteenMonthsMs) {
    return { allowed: false, reason: "Consent expired (>18 months)" };
  }

  return { allowed: true, reason: "Valid consent on record", consentDate: record.consentDate };
}

function generateCallSummary(
  transcript: TranscriptSegment[],
  durationSeconds: number
): CallSummary {
  const sentiment = extractSentiment(transcript);

  const combinedText = transcript.map(s => s.text.toLowerCase()).join(" ");

  // Simple heuristic for interest level
  let leadInterestLevel: CallSummary["leadInterestLevel"] = "low";
  if (sentiment.overall === "negative" || combinedText.includes("not interested")) {
    leadInterestLevel = "not_interested";
  } else if (
    sentiment.score > 0.4 ||
    combinedText.includes("tell me more") ||
    combinedText.includes("when can")
  ) {
    leadInterestLevel = "high";
  } else if (sentiment.score > 0.1) {
    leadInterestLevel = "medium";
  }

  const followUpRequired =
    leadInterestLevel !== "not_interested" && durationSeconds > 30;

  // Extract basic key points from transcript
  const keyPoints = transcript
    .filter(s => s.text.length > 30 && s.speaker === "lead")
    .slice(0, 3)
    .map(s => s.text.slice(0, 100));

  return {
    duration: durationSeconds,
    keyPoints,
    nextSteps: followUpRequired ? ["Schedule follow-up call", "Send property details"] : [],
    sentiment: sentiment.overall,
    leadInterestLevel,
    followUpRequired,
  };
}

function findLeadByPhone(
  phone: string,
  leads: Array<{ id: number; phone: string; name: string }>
): { found: boolean; leadId?: number; name?: string } {
  const normalized = normalizePhoneNumber(phone);
  const lead = leads.find(l => normalizePhoneNumber(l.phone) === normalized);
  if (lead) return { found: true, leadId: lead.id, name: lead.name };
  return { found: false };
}

function computeCallDuration(startTime: Date, endTime: Date): number {
  return Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Sentiment Extraction from Transcript", () => {
  it("returns positive sentiment for interested lead", () => {
    const transcript: TranscriptSegment[] = [
      { speaker: "agent", text: "Would you be interested in selling your land?", startSeconds: 0, endSeconds: 5 },
      { speaker: "lead", text: "Yes, I'm definitely interested, sounds great!", startSeconds: 5, endSeconds: 10 },
    ];
    const result = extractSentiment(transcript);
    expect(result.overall).toBe("positive");
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns negative sentiment for opt-out language", () => {
    const transcript: TranscriptSegment[] = [
      { speaker: "agent", text: "Are you interested in selling?", startSeconds: 0, endSeconds: 3 },
      { speaker: "lead", text: "No thank you, stop calling me, remove me from your list.", startSeconds: 3, endSeconds: 8 },
    ];
    const result = extractSentiment(transcript);
    expect(result.overall).toBe("negative");
    expect(result.score).toBeLessThan(0);
  });

  it("returns neutral sentiment for non-committal lead", () => {
    const transcript: TranscriptSegment[] = [
      { speaker: "agent", text: "Would you consider selling?", startSeconds: 0, endSeconds: 3 },
      { speaker: "lead", text: "Maybe, I would need to think about it.", startSeconds: 3, endSeconds: 7 },
    ];
    const result = extractSentiment(transcript);
    expect(result.overall).toBe("neutral");
  });

  it("only analyzes lead segments (not agent)", () => {
    // Agent uses negative keywords — should not affect score negatively
    const transcript: TranscriptSegment[] = [
      { speaker: "agent", text: "If you are not interested just say no thank you.", startSeconds: 0, endSeconds: 5 },
      { speaker: "lead", text: "I am definitely interested, let's move forward.", startSeconds: 5, endSeconds: 10 },
    ];
    const result = extractSentiment(transcript);
    expect(result.overall).toBe("positive");
  });

  it("returns neutral for empty transcript", () => {
    const result = extractSentiment([]);
    expect(result.overall).toBe("neutral");
    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it("caps score between -1 and +1", () => {
    const transcript: TranscriptSegment[] = [
      {
        speaker: "lead",
        text: "yes definitely absolutely love it sounds great perfect interested tell me more",
        startSeconds: 0,
        endSeconds: 10,
      },
    ];
    const result = extractSentiment(transcript);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(-1);
  });

  it("includes detected signals in result", () => {
    const transcript: TranscriptSegment[] = [
      { speaker: "lead", text: "yes I'm interested", startSeconds: 0, endSeconds: 5 },
    ];
    const result = extractSentiment(transcript);
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe("Phone Number Normalization", () => {
  it("normalizes 10-digit US number", () => {
    expect(normalizePhoneNumber("5125550100")).toBe("+15125550100");
  });

  it("normalizes formatted number with dashes", () => {
    expect(normalizePhoneNumber("512-555-0100")).toBe("+15125550100");
  });

  it("normalizes number with parentheses", () => {
    expect(normalizePhoneNumber("(512) 555-0100")).toBe("+15125550100");
  });

  it("normalizes 11-digit US number starting with 1", () => {
    expect(normalizePhoneNumber("15125550100")).toBe("+15125550100");
  });

  it("preserves E.164 format for already-normalized numbers", () => {
    expect(normalizePhoneNumber("+15125550100")).toBe("+15125550100");
  });
});

describe("TCPA Consent Checking", () => {
  const validConsent = {
    phone: "5125550100",
    consentGiven: true,
    consentDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    source: "web_form",
  };

  it("allows contact when valid consent on record", () => {
    const result = checkTcpaConsent("5125550100", [validConsent]);
    expect(result.allowed).toBe(true);
  });

  it("blocks contact when no consent record exists", () => {
    const result = checkTcpaConsent("5129990000", [validConsent]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No consent");
  });

  it("blocks contact when consent was revoked", () => {
    const revoked = { ...validConsent, consentGiven: false };
    const result = checkTcpaConsent("5125550100", [revoked]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("revoked");
  });

  it("blocks contact when consent is older than 18 months", () => {
    const expired = {
      ...validConsent,
      consentDate: new Date(Date.now() - 20 * 30 * 24 * 60 * 60 * 1000), // 20 months ago
    };
    const result = checkTcpaConsent("5125550100", [expired]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("matches phone numbers across different formats", () => {
    const result = checkTcpaConsent("(512) 555-0100", [validConsent]);
    expect(result.allowed).toBe(true);
  });

  it("returns consent date when allowed", () => {
    const result = checkTcpaConsent("5125550100", [validConsent]);
    expect(result.consentDate).toBeDefined();
  });
});

describe("Lead Linking by Phone Number", () => {
  const leads = [
    { id: 1, phone: "5125550100", name: "John Smith" },
    { id: 2, phone: "+15129990200", name: "Jane Doe" },
    { id: 3, phone: "(737) 555-0300", name: "Bob Johnson" },
  ];

  it("finds lead by matching phone number", () => {
    const result = findLeadByPhone("5125550100", leads);
    expect(result.found).toBe(true);
    expect(result.leadId).toBe(1);
    expect(result.name).toBe("John Smith");
  });

  it("finds lead across different phone formats", () => {
    const result = findLeadByPhone("512-555-0100", leads);
    expect(result.found).toBe(true);
    expect(result.leadId).toBe(1);
  });

  it("returns not found for unknown number", () => {
    const result = findLeadByPhone("5559990000", leads);
    expect(result.found).toBe(false);
    expect(result.leadId).toBeUndefined();
  });

  it("handles E.164 formatted stored numbers", () => {
    const result = findLeadByPhone("5129990200", leads);
    expect(result.found).toBe(true);
    expect(result.leadId).toBe(2);
  });

  it("handles formatted stored numbers", () => {
    const result = findLeadByPhone("7375550300", leads);
    expect(result.found).toBe(true);
    expect(result.leadId).toBe(3);
  });
});

describe("Post-Call Summary Generation", () => {
  const interestedTranscript: TranscriptSegment[] = [
    { speaker: "agent", text: "Hi, I'm calling about your land in Travis County.", startSeconds: 0, endSeconds: 5 },
    { speaker: "lead", text: "Yes, I've been thinking about selling. Tell me more about your offer.", startSeconds: 5, endSeconds: 12 },
    { speaker: "agent", text: "We can close in 30 days with cash.", startSeconds: 12, endSeconds: 16 },
    { speaker: "lead", text: "That sounds great! When can we meet?", startSeconds: 16, endSeconds: 20 },
  ];

  it("sets high interest for enthusiastic lead", () => {
    const summary = generateCallSummary(interestedTranscript, 120);
    expect(summary.leadInterestLevel).toBe("high");
  });

  it("flags follow-up required for interested lead with sufficient call duration", () => {
    const summary = generateCallSummary(interestedTranscript, 120);
    expect(summary.followUpRequired).toBe(true);
  });

  it("sets not_interested for opt-out lead", () => {
    const optOut: TranscriptSegment[] = [
      { speaker: "agent", text: "Hi, interested in selling?", startSeconds: 0, endSeconds: 3 },
      { speaker: "lead", text: "No, not interested, stop calling.", startSeconds: 3, endSeconds: 6 },
    ];
    const summary = generateCallSummary(optOut, 10);
    expect(summary.leadInterestLevel).toBe("not_interested");
    expect(summary.followUpRequired).toBe(false);
  });

  it("includes call duration in summary", () => {
    const summary = generateCallSummary(interestedTranscript, 95);
    expect(summary.duration).toBe(95);
  });

  it("includes sentiment in summary", () => {
    const summary = generateCallSummary(interestedTranscript, 120);
    expect(["positive", "neutral", "negative"]).toContain(summary.sentiment);
  });

  it("does not require follow-up for very short calls (<30s)", () => {
    const summary = generateCallSummary(interestedTranscript, 20);
    expect(summary.followUpRequired).toBe(false);
  });
});

describe("Call Duration Computation", () => {
  it("computes duration in seconds", () => {
    const start = new Date("2024-01-01T10:00:00Z");
    const end = new Date("2024-01-01T10:05:30Z");
    expect(computeCallDuration(start, end)).toBe(330);
  });

  it("returns 0 for same start and end time", () => {
    const t = new Date();
    expect(computeCallDuration(t, t)).toBe(0);
  });

  it("returns 0 when end is before start (clock drift)", () => {
    const start = new Date("2024-01-01T10:05:00Z");
    const end = new Date("2024-01-01T10:00:00Z");
    expect(computeCallDuration(start, end)).toBe(0);
  });
});
