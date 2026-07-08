import { describe, it, expect } from "vitest";
import { parseArtifactRef } from "../../server/services/autopilot/attribution";

describe("autopilot attribution — parseArtifactRef", () => {
  it("reads an artifact id from utm_content=art_<id>", () => {
    expect(parseArtifactRef("art_42", null)).toEqual({ byId: 42 });
    expect(parseArtifactRef("art_7", "/somewhere")).toEqual({ byId: 7 });
  });

  it("falls back to the field-notes slug from the landing path", () => {
    expect(parseArtifactRef(null, "/field-notes/brewster-county-land-101")).toEqual({ bySlug: "brewster-county-land-101" });
    expect(parseArtifactRef("", "/field-notes/abc-123/")).toEqual({ bySlug: "abc-123" });
  });

  it("prefers the explicit utm id over the path slug", () => {
    expect(parseArtifactRef("art_9", "/field-notes/some-slug")).toEqual({ byId: 9 });
  });

  it("returns {} for non-autopilot touches (no fabricated attribution)", () => {
    expect(parseArtifactRef(null, "/")).toEqual({});
    expect(parseArtifactRef("utm_from_google", "/pricing")).toEqual({});
    expect(parseArtifactRef("art_notanumber", "/blog/post")).toEqual({});
    expect(parseArtifactRef(null, null)).toEqual({});
  });
});
