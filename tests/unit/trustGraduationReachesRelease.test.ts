import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { trustGraduationReleaseDDL } from "../helpers/trustGraduationReleaseDDL";

describe("the live retract query's stores reach the actual release command", () => {
  it("executes the complete historical table and index definitions in the release array", () => {
    const ddl = trustGraduationReleaseDDL();
    const historical = readFileSync(resolve(__dirname, "../../migrations/0078_pillar_r_trust_graduation.sql"), "utf8")
      .replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    const canonical = (s: string) => s.replace(/"/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    expect(historical).toHaveLength(7); expect(ddl).toHaveLength(7);
    expect(ddl.map(canonical).sort()).toEqual(historical.map(canonical).sort());
    expect(readFileSync(resolve(__dirname, "../../fly.toml"), "utf8")).toMatch(/release_command\s*=\s*"node scripts\/migrate\.mjs"/);
  });
});
