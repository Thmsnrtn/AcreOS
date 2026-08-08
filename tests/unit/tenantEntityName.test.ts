/**
 * Wave 2 pass B — tenant display-name honesty across person + entity tenants.
 *
 * Making tenants.firstName/lastName nullable (so a COMPANY tenant can omit the
 * person names) created a blast radius: any surface that interpolated
 * `${firstName} ${lastName}` blindly would render the literal "null null" for an
 * entity tenant — a fabricated name shown as real. This suite pins:
 *   1. the ONE shared helper (@shared/rental/tenantName) resolves every case
 *      honestly and NEVER produces "null" for a company tenant;
 *   2. the two server surfaces that render tenant names (the deposit
 *      disposition letter + the lease signing packet) go through that helper and
 *      no longer carry a raw `${...firstName} ${...lastName}` interpolation.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { tenantDisplayName } from "../../shared/rental/tenantName";

describe("tenantDisplayName — the shared, honest resolver", () => {
  it("an entity tenant (isEntity, companyName, person names null) renders its companyName — never 'null null'", () => {
    const name = tenantDisplayName({
      isEntity: true,
      companyName: "Acme Holdings LLC",
      firstName: null,
      lastName: null,
    });
    expect(name).toBe("Acme Holdings LLC");
    expect(name).not.toContain("null");
  });

  it("a person tenant renders 'First Last'", () => {
    expect(
      tenantDisplayName({ isEntity: false, companyName: null, firstName: "Maria", lastName: "Ruiz" }),
    ).toBe("Maria Ruiz");
  });

  it("an entity tenant with NO companyName falls back to the person name (honest, never a placeholder)", () => {
    expect(
      tenantDisplayName({ isEntity: true, companyName: "", firstName: "Sole", lastName: "Prop" }),
    ).toBe("Sole Prop");
  });

  it("a bare first OR last name still renders (nulls coalesced, then trimmed)", () => {
    expect(tenantDisplayName({ isEntity: false, companyName: null, firstName: "Cher", lastName: null })).toBe("Cher");
    expect(tenantDisplayName({ isEntity: false, companyName: null, firstName: null, lastName: "Prince" })).toBe("Prince");
  });

  it("a row with NEITHER a company name nor any person name resolves to null (caller drops it, never a blank)", () => {
    expect(tenantDisplayName({ isEntity: true, companyName: null, firstName: null, lastName: null })).toBeNull();
    expect(tenantDisplayName({ isEntity: false, companyName: null, firstName: "  ", lastName: null })).toBeNull();
  });
});

describe("server name-render sites route through the shared helper (no 'null null' can leak)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const files = {
    "server/routes-rent-ledger.ts": fs.readFileSync(path.join(ROOT, "server/routes-rent-ledger.ts"), "utf-8"),
    "server/services/rental/leaseSigningPacket.ts": fs.readFileSync(
      path.join(ROOT, "server/services/rental/leaseSigningPacket.ts"),
      "utf-8",
    ),
    "server/services/rentalEvents.ts": fs.readFileSync(path.join(ROOT, "server/services/rentalEvents.ts"), "utf-8"),
  };

  it("all three use the shared tenantDisplayName helper", () => {
    for (const [name, src] of Object.entries(files)) {
      expect(src, `${name} must import the shared helper`).toMatch(
        /from "@shared\/rental\/tenantName"/,
      );
    }
  });

  it("no file interpolates a raw ${...firstName} ${...lastName} tenant name anymore", () => {
    // The exact fabrication pattern: `${x.firstName} ${x.lastName}` on one line.
    const RAW = /\$\{\s*\w+\.firstName\s*\}\s*\$\{\s*\w+\.lastName\s*\}/;
    for (const [name, src] of Object.entries(files)) {
      expect(RAW.test(src), `${name} still has a raw firstName/lastName interpolation`).toBe(false);
    }
  });
});
