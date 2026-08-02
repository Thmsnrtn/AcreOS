import { describe, it, expect } from "vitest";
// @ts-expect-error — pure-Node .mjs helper, no type decls
import { extractPgTableNames, declaredTableNames, missingTables } from "../../scripts/verify-schema-boot.mjs";

/**
 * Unit coverage for the boot-and-SELECT verifier's pure helpers (the DB step is
 * exercised by .github/workflows/migration-boot-check.yml against a live pgvector).
 */
describe("verify-schema-boot helpers", () => {
  it("extracts pgTable SQL names, ignoring the const name", () => {
    const src = `
      export const users = pgTable("users", { id: text("id") });
      export const orgTbl = pgTable('organizations', {});
      const x = notPgTable("nope", {});
    `;
    const names: Set<string> = extractPgTableNames(src);
    expect(names.has("users")).toBe(true);
    expect(names.has("organizations")).toBe(true);
    expect(names.has("nope")).toBe(false);
  });

  it("declares the real schema incl. the users table (via the unified discovery)", () => {
    const declared: Set<string> = declaredTableNames();
    expect(declared.has("users")).toBe(true);
    expect(declared.size).toBeGreaterThan(700); // ~748 tables
  });

  it("reports declared tables absent from the live set", () => {
    const declared = new Set(["a", "b", "c"]);
    expect(missingTables(declared, new Set(["a", "c"]))).toEqual(["b"]);
    expect(missingTables(declared, ["a", "b", "c"])).toEqual([]);
  });
});
