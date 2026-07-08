import { describe, it, expect } from "vitest";
import { buildIndexNowPayload, INDEXNOW_KEY_PATH } from "../../server/services/autopilot/searchEngineSubmit";

const BASE = "https://acre.os";
const KEY = "abc12345def";

describe("buildIndexNowPayload — pure IndexNow body builder", () => {
  it("normalizes site-relative paths to absolute on-host URLs", () => {
    const p = buildIndexNowPayload(BASE, KEY, ["/field-notes/foo"]);
    expect(p?.urlList).toEqual(["https://acre.os/field-notes/foo"]);
    expect(p?.host).toBe("acre.os");
    expect(p?.keyLocation).toBe(`${BASE}${INDEXNOW_KEY_PATH}`);
    expect(p?.key).toBe(KEY);
  });

  it("keeps absolute on-host URLs and dedupes", () => {
    const p = buildIndexNowPayload(BASE, KEY, [
      "https://acre.os/p/tx/travis/123",
      "/p/tx/travis/123", // same as above after normalization
      "/field-notes/bar",
    ]);
    expect(p?.urlList).toEqual([
      "https://acre.os/p/tx/travis/123",
      "https://acre.os/field-notes/bar",
    ]);
  });

  it("drops off-host URLs (IndexNow rejects a mixed-host batch)", () => {
    const p = buildIndexNowPayload(BASE, KEY, [
      "https://evil.example.com/x",
      "/field-notes/ok",
    ]);
    expect(p?.urlList).toEqual(["https://acre.os/field-notes/ok"]);
  });

  it("returns null when nothing valid resolves", () => {
    expect(buildIndexNowPayload(BASE, KEY, [])).toBeNull();
    expect(buildIndexNowPayload(BASE, KEY, ["https://other.com/a", ""])).toBeNull();
  });

  it("returns null for an unparseable base URL", () => {
    expect(buildIndexNowPayload("not a url", KEY, ["/x"])).toBeNull();
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: 250 }, (_, i) => `/p/tx/travis/${i}`);
    const p = buildIndexNowPayload(BASE, KEY, many, 100);
    expect(p?.urlList.length).toBe(100);
  });
});
