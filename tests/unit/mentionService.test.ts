/**
 * T281 — Mention Service Tests
 * Tests @mention token extraction from note bodies.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

function extractMentionHandles(body: string): string[] {
  // Match @word, @word.word, @word_word, @"multi word"
  const quoted = body.match(/@"([^"]+)"/g) ?? [];
  const simple = body.match(/@([A-Za-z0-9_.]+)/g) ?? [];

  const handles = [
    ...quoted.map(m => m.slice(2, -1).toLowerCase()),
    ...simple.map(m => m.slice(1).toLowerCase()),
  ];

  return [...new Set(handles)];
}

function renderMentions(body: string, resolvedHandles: Record<string, string>): string {
  // Replace @handle with [Name] for preview
  return body.replace(/@([A-Za-z0-9_.]+)/g, (match, handle) => {
    const resolved = resolvedHandles[handle.toLowerCase()];
    return resolved ? `[@${resolved}]` : match;
  });
}

function stripMentions(body: string): string {
  return body.replace(/@"[^"]+"|@[A-Za-z0-9_.]+/g, "").replace(/\s+/g, " ").trim();
}

function countMentions(body: string): number {
  return extractMentionHandles(body).length;
}

function hasMention(body: string, handle: string): boolean {
  return extractMentionHandles(body).includes(handle.toLowerCase());
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("extractMentionHandles", () => {
  it("extracts simple @handle", () => {
    expect(extractMentionHandles("Hello @jane please review this")).toEqual(["jane"]);
  });

  it("extracts dotted handle", () => {
    expect(extractMentionHandles("Assigned to @jane.doe")).toEqual(["jane.doe"]);
  });

  it("extracts underscore handle", () => {
    expect(extractMentionHandles("CC @john_smith")).toEqual(["john_smith"]);
  });

  it('extracts quoted multi-word handles', () => {
    expect(extractMentionHandles('@"Jane Doe" please approve')).toEqual(["jane doe"]);
  });

  it("extracts multiple distinct handles", () => {
    const handles = extractMentionHandles("@alice and @bob should review");
    expect(handles).toContain("alice");
    expect(handles).toContain("bob");
    expect(handles).toHaveLength(2);
  });

  it("deduplicates repeated mentions", () => {
    const handles = extractMentionHandles("@alice @alice again");
    expect(handles).toHaveLength(1);
    expect(handles[0]).toBe("alice");
  });

  it("returns empty array when no mentions", () => {
    expect(extractMentionHandles("No mentions here")).toEqual([]);
  });

  it("is case-insensitive (lowercases all handles)", () => {
    expect(extractMentionHandles("@ALICE")).toEqual(["alice"]);
    expect(extractMentionHandles("@Jane")).toEqual(["jane"]);
  });

  it("handles mixed simple and quoted mentions", () => {
    const handles = extractMentionHandles('@"John Smith" and @alice');
    expect(handles).toContain("john smith");
    expect(handles).toContain("alice");
  });
});

describe("renderMentions", () => {
  it("replaces known handles with resolved names", () => {
    const resolved = { alice: "Alice Johnson" };
    const result = renderMentions("Hello @alice", resolved);
    expect(result).toBe("Hello [@Alice Johnson]");
  });

  it("leaves unknown handles unchanged", () => {
    const result = renderMentions("Hello @unknown", {});
    expect(result).toBe("Hello @unknown");
  });
});

describe("stripMentions", () => {
  it("removes @handle from text", () => {
    expect(stripMentions("Hello @alice please review")).toBe("Hello please review");
  });

  it("removes quoted mentions", () => {
    const result = stripMentions('@"Jane Doe" please approve');
    expect(result).not.toContain("Jane Doe");
  });

  it("returns clean text for mention-free body", () => {
    expect(stripMentions("Just a note")).toBe("Just a note");
  });
});

describe("countMentions", () => {
  it("counts unique mentions", () => {
    expect(countMentions("@alice and @bob meet with @alice")).toBe(2);
  });

  it("returns 0 for no mentions", () => {
    expect(countMentions("No one mentioned")).toBe(0);
  });
});

describe("hasMention", () => {
  it("returns true for present handle", () => {
    expect(hasMention("Ping @alice", "alice")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasMention("Ping @Alice", "alice")).toBe(true);
  });

  it("returns false for absent handle", () => {
    expect(hasMention("Ping @alice", "bob")).toBe(false);
  });
});
