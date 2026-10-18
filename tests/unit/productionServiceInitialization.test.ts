import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { integer, pgSchema, pgTable, serial, text } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const nativeRequire = createRequire(import.meta.url);
// Independent small catalog: primary-key chains, spread columns, a table
// re-exported from a domain module and a non-public table. No source AST.
const barrelTable = pgTable("barrel_table", { id: serial("id").primaryKey(), status: text("status").notNull() });
const domainTable = pgTable("domain_table", { id: serial("id").primaryKey(), ...{ organizationId: integer("organization_id").notNull() } });
const privateTable = pgSchema("private").table("private_table", { id: serial("id").primaryKey() });

function loadCjs(file: string, overrides: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const code = transformSync(readFileSync(resolve(file), "utf8"), { loader: "ts", format: "cjs", platform: "node", logLevel: "silent" }).code;
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, process: { env, cwd: () => "/app" },
    require(id: string) {
      if (id in overrides) return overrides[id];
      if (id.includes("/logger")) return { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
      return nativeRequire(id);
    },
  };
  vm.runInNewContext(code, context, { filename: file, timeout: 2000 });
  return module.exports as Record<string, (...args: unknown[]) => unknown>;
}

describe("services in the actual production CommonJS format", () => {
  it("loads the land-status service and refuses to infer fee-simple without an overlay", () => {
    const exists = vi.fn(() => false);
    const service = loadCjs("server/services/landStatusLAR.ts", { fs: { existsSync: exists, readFileSync: vi.fn() } });
    expect(service.detectLandStatusFromCoords(38, -104)).toMatchObject({ status: "unknown", source: "no_overlay_loaded" });
    expect(exists).toHaveBeenCalledWith("/app/data/bia-lar.geojson");
  });
  it("keeps the operator's explicit overlay path", () => {
    const exists = vi.fn(() => false);
    const service = loadCjs("server/services/landStatusLAR.ts", { fs: { existsSync: exists, readFileSync: vi.fn() } }, { BIA_LAR_GEOJSON_PATH: "/mounted/bia.geojson" });
    service.detectLandStatusFromCoords(38, -104);
    expect(exists).toHaveBeenCalledWith("/mounted/bia.geojson");
  });
  it("compares all public compiled tables and chained/spread columns without source files", async () => {
    const execute = vi.fn(async () => ({ rows: [{ table_name: "barrel_table", column_name: "id" }] }));
    const service = loadCjs("server/services/schemaDriftDetector.ts", {
      "../db": { db: { execute } }, "@shared/schema": { barrelTable, domainTable, privateTable },
    });
    const findings = await service.detectSchemaDrift();
    expect(findings).toEqual([
      { kind: "missing_column", table: "barrel_table", column: "status", message: expect.any(String) },
      { kind: "missing_table", table: "domain_table", message: expect.any(String) },
    ]);
    execute.mockResolvedValue({ rows: [
      { table_name: "barrel_table", column_name: "id" }, { table_name: "barrel_table", column_name: "status" },
      { table_name: "domain_table", column_name: "id" }, { table_name: "domain_table", column_name: "organization_id" },
    ] });
    expect(await service.detectSchemaDrift()).toEqual([]);
  });
  it("does not report a healthy schema when the live catalog cannot be read", async () => {
    const service = loadCjs("server/services/schemaDriftDetector.ts", {
      "../db": { db: { execute: vi.fn().mockRejectedValue(new Error("catalog unavailable")) } },
      "@shared/schema": { barrelTable, domainTable },
    });
    await expect(service.detectSchemaDrift()).rejects.toThrow("catalog unavailable");
  });
});
