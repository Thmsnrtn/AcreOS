/**
 * Accessibility preferences sync to the account.
 *
 * The preferences endpoint (/api/me/preferences) must accept, validate, and
 * merge the accessibility blob the client sends; garbage must 422, and the
 * serialized response must carry defaults for missing fields.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { preferencesSchema, serializePreferences } from "../../server/routes-preferences";

describe("preferencesSchema — accessibility", () => {
  it("accepts a full accessibility blob", () => {
    const parsed = preferencesSchema.safeParse({
      accessibility: {
        fontFamily: "lexend",
        readingDensity: "spacious",
        cognitiveA11yMode: true,
        largerTapsMode: true,
        pictureFirstParcels: false,
        focusMode: false,
        quietHours: { enabled: true, start: "22:00", end: "07:00" },
        reduceMotion: true,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a partial accessibility update (merge semantics)", () => {
    const parsed = preferencesSchema.safeParse({
      accessibility: { fontFamily: "lexend" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.accessibility).toEqual({ fontFamily: "lexend" });
    }
  });

  it("accepts reduceMotion as boolean or 'system'", () => {
    for (const reduceMotion of [true, false, "system"] as const) {
      const parsed = preferencesSchema.safeParse({ accessibility: { reduceMotion } });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects garbage enum values", () => {
    const parsed = preferencesSchema.safeParse({
      accessibility: { fontFamily: "comic-sans" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed quiet-hours times", () => {
    const parsed = preferencesSchema.safeParse({
      accessibility: { quietHours: { start: "25:00" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown top-level keys inside accessibility (strict)", () => {
    const parsed = preferencesSchema.safeParse({
      accessibility: { fontFamily: "system", bogus: true },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("serializePreferences — accessibility defaults", () => {
  it("fills accessibility defaults when the stored blob has none", () => {
    const out = serializePreferences({ theme: "fieldstone", mode: "auto" });
    expect(out.accessibility).toMatchObject({
      fontFamily: "system",
      readingDensity: "comfortable",
      reduceMotion: "system",
    });
  });

  it("keeps stored accessibility values", () => {
    const out = serializePreferences({
      accessibility: { fontFamily: "lexend", cognitiveA11yMode: true },
    });
    expect(out.accessibility?.fontFamily).toBe("lexend");
    expect(out.accessibility?.cognitiveA11yMode).toBe(true);
    // Defaults still fill the rest.
    expect(out.accessibility?.readingDensity).toBe("comfortable");
  });
});
