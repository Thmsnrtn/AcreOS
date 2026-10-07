/**
 * Pax's product facts are DERIVED from the constants the product enforces —
 * proven by changing the constants and watching the facts follow.
 *
 * A hand-typed "500 rows" doc would stay "500" when the constant moved; that
 * is the canonical-function-with-no-adoption trap in CLAUDE.md. This file
 * swaps the shared limits for sentinel values (777 rows, 9 exports, 12,345 job
 * rows) and requires Pax's facts to say exactly those. The sibling file
 * (paxProductFactsArePlaces.test.ts) proves the ENFORCING routes read the same
 * constants and that every place Pax names exists.
 *
 * Mutation recorded: hard-coding `rowsPerFile: 500` in paxProductFacts.ts
 * turns "the import cap follows the constant" red.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@shared/product-limits", () => ({
  CSV_IMPORT_MAX_ROWS_PER_FILE: 777,
  BULK_EXPORT_DAILY_CAP: 9,
  DATA_IMPORT_JOB_MAX_ROWS: 12345,
}));
vi.mock("@shared/billing/byok-tiers", () => ({
  byokTierAllows: (tier: string | null, channel?: string) => tier === "scale" && channel === "twilio",
}));
vi.mock("../../server/utils/permissions", () => ({
  getPermissionsForRole: (r: string) => ({
    viewOnlyAssignedLeads: r === "va",
    canImportData: false,
    canExportData: false,
    canManageTeam: false,
    canManageBilling: false,
    canAssignLeads: false,
    canEditLeads: true,
  }),
  getRoleLabel: (r: string) => r.toUpperCase(),
}));

import { getPaxProductFacts } from "../../server/services/paxProductFacts";

describe("facts follow the enforcing constants", () => {
  it("the import cap follows the constant", async () => {
    const f: any = await getPaxProductFacts("imports");
    expect(f.imports.rowsPerFile).toBe(777);
    expect(f.imports.rule).toContain("777");
    expect(f.imports.largeFiles).toContain("12,345");
    expect(JSON.stringify(f)).not.toContain("500 rows");
  });

  it("the export cap follows the constant", async () => {
    const f: any = await getPaxProductFacts("exports");
    expect(f.exports.perPersonPerDay).toBe(9);
    expect(f.exports.rule).toContain("9 per person");
  });

  it("the SMS plan requirement follows the BYO tier rule", async () => {
    const f: any = await getPaxProductFacts("sending");
    expect(f.sending.textsPlanRequirement).toEqual(["scale"]);
    expect(f.sending.texts).toContain("Scale plan");
  });

  it("roles follow the permission table", async () => {
    const f: any = await getPaxProductFacts("roles");
    const va = f.team.roles.find((r: any) => r.role === "va");
    expect(va).toMatchObject({ label: "VA", seesOnlyAssignedLeads: true });
    expect(f.team.roles.find((r: any) => r.role === "member").seesOnlyAssignedLeads).toBe(false);
  });
});
