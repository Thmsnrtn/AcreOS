import { describe, it, expect } from "vitest";
// @ts-expect-error — pure-Node .mjs helper, no type decls
import { discoverSchemaFiles, discoverSchemaFilesRelative } from "../../scripts/schema-files.mjs";

/**
 * Schema-guard coverage regression (Phase 0 audit §3 / INV-SCHEMA-1).
 *
 * The users-table drift outages were possible in part because all three schema
 * guards (runtime drift detector, CI column-ref validator, org-index lint)
 * parsed different subsets of the schema and NONE watched shared/models/auth.ts
 * — the file that defines the `users` table. They now share this discovery
 * helper. This pins the property that the helper covers the models directory,
 * so the users table can never fall out of coverage again.
 */
describe("schema-guard coverage is unified and watches the users table", () => {
  const rel: string[] = discoverSchemaFilesRelative();

  it("includes shared/models/auth.ts (where `users` is defined)", () => {
    expect(rel).toContain("shared/models/auth.ts");
  });

  it("includes the barrel and the split-module directory", () => {
    expect(rel).toContain("shared/schema.ts");
    expect(rel.some((f) => f.startsWith("shared/schema/") && f.endsWith(".ts"))).toBe(true);
    expect(rel.some((f) => f.startsWith("shared/models/") && f.endsWith(".ts"))).toBe(true);
  });

  it("excludes test/spec files and returns absolute, de-dupable paths", () => {
    expect(rel.every((f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"))).toBe(true);
    const abs: string[] = discoverSchemaFiles();
    expect(abs.every((f) => f.startsWith("/"))).toBe(true);
    expect(new Set(abs).size).toBe(abs.length); // no duplicates
  });
});
