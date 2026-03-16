/**
 * T252 — Writing Style / AI Personalization Tests
 * Tests tone analysis, message length optimization, and forbidden phrase detection.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type Tone = "formal" | "casual" | "friendly" | "urgent" | "professional";

function detectToneKeywords(text: string): Record<Tone, number> {
  const lower = text.toLowerCase();
  const counts: Record<Tone, number> = {
    formal: 0, casual: 0, friendly: 0, urgent: 0, professional: 0,
  };

  const patterns: Record<Tone, string[]> = {
    formal: ["dear", "sincerely", "hereby", "pursuant", "enclosed", "regarding"],
    casual: ["hey", "hi there", "btw", "fyi", "thanks!", "awesome", "cool"],
    friendly: ["hope you're", "great to", "looking forward", "pleasure", "wonderful"],
    urgent: ["immediately", "asap", "urgent", "critical", "deadline", "time-sensitive"],
    professional: ["please find", "i wanted to", "following up", "per our", "as discussed"],
  };

  for (const [tone, words] of Object.entries(patterns)) {
    counts[tone as Tone] = words.filter(w => lower.includes(w)).length;
  }
  return counts;
}

function getDominantTone(text: string): Tone | "neutral" {
  const counts = detectToneKeywords(text);
  const max = Math.max(...Object.values(counts));
  if (max === 0) return "neutral";
  const entry = Object.entries(counts).find(([, v]) => v === max);
  return (entry?.[0] as Tone) ?? "neutral";
}

function suggestMessageLength(channel: "email" | "sms" | "voicemail" | "letter"): {
  minWords: number;
  maxWords: number;
  recommendation: string;
} {
  const config = {
    email: { minWords: 50, maxWords: 200, recommendation: "Keep emails concise—2-3 paragraphs" },
    sms: { minWords: 5, maxWords: 30, recommendation: "SMS should be 160 chars or less" },
    voicemail: { minWords: 30, maxWords: 75, recommendation: "Voicemails should be under 30 seconds" },
    letter: { minWords: 100, maxWords: 400, recommendation: "Letters can be more detailed" },
  };
  return config[channel];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function isMessageLengthOptimal(text: string, channel: "email" | "sms" | "voicemail" | "letter"): boolean {
  const wordCount = countWords(text);
  const { minWords, maxWords } = suggestMessageLength(channel);
  return wordCount >= minWords && wordCount <= maxWords;
}

function detectForbiddenPhrases(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase();
  return phrases.filter(phrase => lower.includes(phrase.toLowerCase()));
}

function personalizeTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\[${key}\\]`, "g"), value);
  }
  return result;
}

function calculateReadabilityScore(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0 || words.length === 0) return 0;
  const avgWordsPerSentence = words.length / sentences.length;
  // Simple Flesch-Kincaid approximation: lower AWpS = easier
  const score = Math.max(0, Math.min(100, 100 - (avgWordsPerSentence - 10) * 3));
  return Math.round(score);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("detectToneKeywords", () => {
  it("detects formal tone keywords", () => {
    const counts = detectToneKeywords("Dear Sir, hereby enclosed pursuant to your request.");
    expect(counts.formal).toBeGreaterThan(0);
  });

  it("detects casual tone keywords", () => {
    const counts = detectToneKeywords("Hey! BTW, that's awesome!");
    expect(counts.casual).toBeGreaterThan(0);
  });

  it("detects urgent keywords", () => {
    const counts = detectToneKeywords("This is urgent and time-sensitive, ASAP please.");
    expect(counts.urgent).toBeGreaterThan(0);
  });

  it("returns all zeros for neutral text", () => {
    const counts = detectToneKeywords("The property has 40 acres.");
    expect(Object.values(counts).every(v => v === 0)).toBe(true);
  });
});

describe("getDominantTone", () => {
  it("identifies formal tone", () => {
    expect(getDominantTone("Dear Mr. Smith, hereby enclosed sincerely pursuant to our agreement.")).toBe("formal");
  });

  it("returns neutral for no tone keywords", () => {
    expect(getDominantTone("The land is 40 acres.")).toBe("neutral");
  });
});

describe("suggestMessageLength", () => {
  it("SMS has tight constraints", () => {
    const s = suggestMessageLength("sms");
    expect(s.maxWords).toBeLessThanOrEqual(30);
  });

  it("letter allows longer content", () => {
    const l = suggestMessageLength("letter");
    expect(l.maxWords).toBeGreaterThan(200);
  });

  it("each channel has a recommendation string", () => {
    for (const ch of ["email", "sms", "voicemail", "letter"] as const) {
      expect(suggestMessageLength(ch).recommendation).toBeTruthy();
    }
  });
});

describe("countWords", () => {
  it("counts words correctly", () => {
    expect(countWords("Hello world")).toBe(2);
  });

  it("handles extra whitespace", () => {
    expect(countWords("  Hello   world  ")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("isMessageLengthOptimal", () => {
  it("returns false for too-short SMS", () => {
    expect(isMessageLengthOptimal("Hi", "sms")).toBe(false);
  });

  it("returns true for optimal email length", () => {
    const words = Array(100).fill("word").join(" ");
    expect(isMessageLengthOptimal(words, "email")).toBe(true);
  });

  it("returns false for too-long SMS", () => {
    const words = Array(50).fill("word").join(" ");
    expect(isMessageLengthOptimal(words, "sms")).toBe(false);
  });
});

describe("detectForbiddenPhrases", () => {
  it("detects TCPA-risk phrases", () => {
    const text = "You can get a cash price for your land today!";
    const forbidden = ["cash price", "act now", "limited time"];
    const found = detectForbiddenPhrases(text, forbidden);
    expect(found).toContain("cash price");
  });

  it("returns empty array when none found", () => {
    expect(detectForbiddenPhrases("Hello, I'm interested in your property.", ["spam", "guaranteed"])).toHaveLength(0);
  });

  it("is case insensitive", () => {
    expect(detectForbiddenPhrases("ACT NOW!", ["act now"])).toContain("act now");
  });
});

describe("personalizeTemplate", () => {
  it("replaces single variable", () => {
    expect(personalizeTemplate("Hi [NAME]!", { NAME: "John" })).toBe("Hi John!");
  });

  it("replaces multiple variables", () => {
    const result = personalizeTemplate("Hi [NAME], I want to buy [ADDRESS].", {
      NAME: "Jane",
      ADDRESS: "123 Main St",
    });
    expect(result).toBe("Hi Jane, I want to buy 123 Main St.");
  });

  it("replaces all occurrences of same variable", () => {
    expect(personalizeTemplate("[NAME] and [NAME]", { NAME: "Bob" })).toBe("Bob and Bob");
  });

  it("leaves unreplaced variables as-is", () => {
    expect(personalizeTemplate("Hi [NAME], your [PROPERTY] is ready.", { NAME: "Dave" }))
      .toBe("Hi Dave, your [PROPERTY] is ready.");
  });
});

describe("calculateReadabilityScore", () => {
  it("returns 100 for short simple sentences", () => {
    expect(calculateReadabilityScore("Buy land. Sell land.")).toBeGreaterThan(90);
  });

  it("returns lower score for very long sentences", () => {
    const longSentence = "This is a very long sentence with many many many many many many many many many many many many many many many many many many words in it.";
    expect(calculateReadabilityScore(longSentence)).toBeLessThan(80);
  });

  it("returns 0 for empty text", () => {
    expect(calculateReadabilityScore("")).toBe(0);
  });
});
