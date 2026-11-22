/**
 * Branding editor shape test.
 *
 * The company branding editor (Settings → Organization) must exist, wire the
 * two org brand affordances (accent color, logo URL) to
 * PATCH /api/tenant-theme, and gate writes behind owner/admin.
 *
 * Density is NOT a brand affordance (EL-P1 A2-12): the old picker wrote
 * organizations.brandDensity, which nothing applied — reading density is
 * the person's own accessibility setting. The picker and its payload are
 * pinned absent by clientHonestyBatch2.test.ts.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const EDITOR = fs.readFileSync(
  path.join(ROOT, "client/src/components/settings/branding-editor.tsx"),
  "utf8",
);
const SETTINGS = fs.readFileSync(path.join(ROOT, "client/src/pages/settings.tsx"), "utf8");

describe("BrandingEditor", () => {
  it("exists and covers the two brand affordances", () => {
    expect(EDITOR).toContain("brandAccentColor");
    expect(EDITOR).toContain("brandLogoUrl");
    expect(EDITOR).not.toContain("select-brand-density");
  });

  it("PATCHes /api/tenant-theme on save", () => {
    expect(EDITOR).toContain("/api/tenant-theme");
    expect(EDITOR).toContain("\"PATCH\"");
  });

  it("validates the accent as a 6-digit hex (server contract)", () => {
    expect(EDITOR).toMatch(/#\[0-9a-fA-F\]\{6\}/);
  });

  it("validates the logo as an absolute http(s) URL", () => {
    expect(EDITOR).toContain("new URL(");
  });

  it("gates writes behind owner/admin", () => {
    expect(EDITOR).toContain('"owner"');
    expect(EDITOR).toContain('"admin"');
  });

  it("offers reset-to-defaults (null = theme default)", () => {
    expect(EDITOR).toContain("Reset to defaults");
    expect(EDITOR).toContain("brandAccentColor: null");
  });

  it("is mounted in the Organization tab of Settings", () => {
    expect(SETTINGS).toContain("BrandingEditor");
    expect(SETTINGS).toMatch(/tab-content-organization[\s\S]*<BrandingEditor/);
  });
});
