/**
 * The payer block of a 1099-NEC — or the reason one cannot be printed.
 *
 * A 1099-NEC is a tax form furnished to a recipient and the IRS. The batch
 * generator used to print "(payer address not configured)" / "—" in the payer
 * address and a "—" payer TIN when the organization had none on file, and it
 * read a `taxAddress` it never typed. A placeholder on a tax form is never
 * acceptable: the form is refused until the payer's legal name, full address
 * and a real TIN are on file.
 *
 * The payer identity IS on the organizations row — `legalEntityName`,
 * `taxAddress` (jsonb), `taxIdType` and `ein`, which holds CIPHERTEXT (see
 * PATCH /api/organization/tax-identity). It is resolved by the same
 * resolver the Form 1098 lender block uses (./orgTaxIdentity): the TIN is
 * decrypted before it is validated or masked, and masked in the shape of its
 * type (an SSN payer is never printed as an EIN).
 */

import type { Nec1099Payer } from "./form1099NecPdf";
import { maskOrgTin, resolveOrgTaxIdentity, type OrgTaxIdentitySource } from "./orgTaxIdentity";

/**
 * 1099-NEC reporting threshold, in cents ($600.00 — the figure in force
 * through tax year 2025).
 *
 * TAX REVIEWER (K13) MUST CONFIRM THE 2026 FIGURE. $600 is the long-standing
 * figure; the threshold for payments made after 2025 may differ, and this
 * constant was deliberately NOT changed by the P1 sweep. Until confirmed, the
 * generator keeps $600 and says in its response that the figure is unconfirmed.
 */
export const NEC_THRESHOLD_CENTS = 60000;
export const NEC_THRESHOLD_NEEDS_REVIEW = true;

export type PayerSource = OrgTaxIdentitySource;

export type PayerResolution =
  | { ok: true; payer: Nec1099Payer }
  | { ok: false; missing: string[] };

export function resolve1099Payer(org: PayerSource): PayerResolution {
  const id = resolveOrgTaxIdentity(org);
  const missing: string[] = [];
  if (!id.name) missing.push("payer legal name");
  if (id.problems.includes("ADDRESS_INCOMPLETE")) missing.push("payer address (street, city, state, ZIP)");
  const tinDigits = id.tin.replace(/[^0-9]/g, "");
  if (id.problems.includes("TIN_MISSING") || id.problems.includes("TIN_PLACEHOLDER") || tinDigits.length !== 9) {
    missing.push(`payer TIN (${id.tinType})`);
  }
  if (missing.length > 0 || !id.name) return { ok: false, missing };
  return {
    ok: true,
    payer: {
      name: id.name,
      address: {
        line1: id.address.line1,
        ...(id.address.line2 ? { line2: id.address.line2 } : {}),
        city: id.address.city,
        state: id.address.state,
        zip: id.address.zip,
      },
      ...(id.phone ? { phone: id.phone } : {}),
      taxIdMasked: maskOrgTin(id.tin, id.tinType),
    },
  };
}
