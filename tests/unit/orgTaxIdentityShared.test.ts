/**
 * The org's own tax identity has ONE resolver (server/services/orgTaxIdentity.ts),
 * used by the Form 1098 lender block (resolveLenderIdentity) and the 1099-NEC
 * payer block (resolve1099Payer). organizations.ein holds CIPHERTEXT, so the
 * fixtures here store envelopes from the real encrypt().
 *
 * This pins the 1098 behaviour the extraction had to keep identical: decrypts
 * the stored EIN, refuses missing / placeholder / undecryptable TINs with
 * PAYER_EIN_MISSING, refuses a missing name, honours taxIdType, and does NOT
 * gate on address completeness (that is the 1099-NEC path's extra rule).
 */

import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "b".repeat(64);
  return { org: undefined as Record<string, unknown> | undefined };
});

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (h.org ? [h.org] : []) }) }) }),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { encrypt } from "../../server/services/fieldEncryption";
import { resolveLenderIdentity } from "../../server/services/form1098Batch";
import { resolve1099Payer } from "../../server/services/form1099NecPayer";
import { resolveOrgTaxIdentity } from "../../server/services/orgTaxIdentity";

const ADDRESS = { line1: "1 Main", city: "Austin", state: "TX", zip: "78701", phone: "512-555-0100" };

describe("resolveLenderIdentity (Form 1098) on the shared resolver", () => {
  it("decrypts the stored EIN and returns the lender identity", async () => {
    h.org = { id: 7, name: "Acre", legalEntityName: "Acre LLC", ein: encrypt("12-3456789"), taxIdType: "EIN", taxAddress: ADDRESS };
    const id = await resolveLenderIdentity(7);
    expect(id).toMatchObject({ name: "Acre LLC", tin: "12-3456789", tinType: "EIN", phone: "512-555-0100" });
    expect(id.address).toMatchObject({ line1: "1 Main", city: "Austin", state: "TX", zip: "78701" });
  });

  it("honours an SSN tax id type", async () => {
    h.org = { id: 7, name: "Jane Doe", ein: encrypt("123-45-6789"), taxIdType: "SSN", taxAddress: ADDRESS };
    expect((await resolveLenderIdentity(7)).tinType).toBe("SSN");
  });

  it("does not gate on address completeness (unchanged 1098 behaviour)", async () => {
    h.org = { id: 7, name: "Acre", ein: encrypt("12-3456789") };
    const id = await resolveLenderIdentity(7);
    expect(id.address.line1).toBe("");
  });

  for (const [label, ein] of [
    ["missing", null],
    ["an encrypted placeholder", encrypt("00-0000000")],
    ["an envelope that does not decrypt", "enc:v1:" + Buffer.from("{}").toString("base64")],
  ] as const) {
    it(`refuses with PAYER_EIN_MISSING when the EIN is ${label}`, async () => {
      h.org = { id: 7, name: "Acre", ein, taxAddress: ADDRESS };
      await expect(resolveLenderIdentity(7)).rejects.toMatchObject({ code: "PAYER_EIN_MISSING" });
    });
  }

  it("refuses a missing name with PAYER_NAME_MISSING", async () => {
    h.org = { id: 7, name: " ", ein: encrypt("12-3456789") };
    await expect(resolveLenderIdentity(7)).rejects.toMatchObject({ code: "PAYER_NAME_MISSING" });
  });
});

describe("both forms agree on the same org row", () => {
  it("an encrypted EIN the 1098 path accepts is accepted by the 1099-NEC path", async () => {
    const org = { id: 7, name: "Acre", ein: encrypt("12-3456789"), taxIdType: "EIN", taxAddress: ADDRESS };
    h.org = org;
    const lender = await resolveLenderIdentity(7);
    const nec = resolve1099Payer(org);
    expect(nec.ok).toBe(true);
    if (nec.ok) expect(nec.payer.taxIdMasked).toBe(`XX-XXX${lender.tin.slice(-4)}`);
    expect(resolveOrgTaxIdentity(org).problems).toEqual([]);
  });
});
