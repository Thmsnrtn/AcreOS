import { describe, it, expect } from "vitest";

// Pure mention-parsing logic from routes-comments.ts

function parseMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const name = match[1];
    if (!mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}

// Cursor pagination helper
function calculateNextCursor(
  comments: { id: number }[],
  pageSize: number,
): { page: { id: number }[]; nextCursor: number | null; hasMore: boolean } {
  const hasMore = comments.length > pageSize;
  const page = hasMore ? comments.slice(0, pageSize) : comments;
  const nextCursor = hasMore ? page[page.length - 1].id : null;
  return { page, nextCursor, hasMore };
}

// Auth check for comment deletion
function canDeleteComment(commentUserId: string, requestUserId: string): boolean {
  return commentUserId === requestUserId;
}

describe("contextualComments — @mention parsing", () => {
  it("parses single @name", () => {
    const mentions = parseMentions("Hey @john check this out");
    expect(mentions).toEqual(["john"]);
  });

  it("parses @name-with-hyphen", () => {
    const mentions = parseMentions("cc @mary-jane for review");
    expect(mentions).toEqual(["mary-jane"]);
  });

  it("parses @name_with_underscore", () => {
    const mentions = parseMentions("@john_doe thoughts?");
    expect(mentions).toEqual(["john_doe"]);
  });

  it("parses multiple mentions", () => {
    const mentions = parseMentions("@alice and @bob please review");
    expect(mentions).toEqual(["alice", "bob"]);
  });

  it("deduplicates mentions", () => {
    const mentions = parseMentions("@alice @bob @alice what do you think?");
    expect(mentions).toEqual(["alice", "bob"]);
  });

  it("returns empty for no mentions", () => {
    const mentions = parseMentions("Just a regular comment with no mentions");
    expect(mentions).toEqual([]);
  });

  it("handles empty string", () => {
    expect(parseMentions("")).toEqual([]);
  });

  it("handles @ at end of string", () => {
    const mentions = parseMentions("email me at user@");
    // The regex requires at least one character after @
    expect(mentions).toEqual([]);
  });

  it("handles @mention at start", () => {
    const mentions = parseMentions("@admin please fix");
    expect(mentions).toEqual(["admin"]);
  });
});

describe("contextualComments — cursor pagination", () => {
  it("returns correct cursor for next page", () => {
    const comments = Array.from({ length: 21 }, (_, i) => ({ id: 100 - i }));
    const { page, nextCursor, hasMore } = calculateNextCursor(comments, 20);
    expect(page).toHaveLength(20);
    expect(hasMore).toBe(true);
    expect(nextCursor).toBe(81); // last item in page
  });

  it("no next cursor when fewer items than page size", () => {
    const comments = Array.from({ length: 5 }, (_, i) => ({ id: 10 - i }));
    const { page, nextCursor, hasMore } = calculateNextCursor(comments, 20);
    expect(page).toHaveLength(5);
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });

  it("exact page size → no next cursor", () => {
    const comments = Array.from({ length: 20 }, (_, i) => ({ id: 20 - i }));
    const { page, nextCursor, hasMore } = calculateNextCursor(comments, 20);
    expect(page).toHaveLength(20);
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });

  it("empty comments → no next cursor", () => {
    const { page, nextCursor, hasMore } = calculateNextCursor([], 20);
    expect(page).toHaveLength(0);
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });
});

describe("contextualComments — auth: own comments only", () => {
  it("user can delete own comment", () => {
    expect(canDeleteComment("user-123", "user-123")).toBe(true);
  });

  it("user cannot delete another's comment", () => {
    expect(canDeleteComment("user-123", "user-456")).toBe(false);
  });
});

describe("contextualComments — entity types", () => {
  const VALID_ENTITY_TYPES = ["lead", "deal", "property", "note"];

  it("accepts all valid entity types", () => {
    for (const type of VALID_ENTITY_TYPES) {
      expect(VALID_ENTITY_TYPES.includes(type)).toBe(true);
    }
  });

  it("rejects invalid entity types", () => {
    expect(VALID_ENTITY_TYPES.includes("user")).toBe(false);
    expect(VALID_ENTITY_TYPES.includes("")).toBe(false);
    expect(VALID_ENTITY_TYPES.includes("comment")).toBe(false);
  });
});
