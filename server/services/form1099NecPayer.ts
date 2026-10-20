/**
 * The payer block of a 1099-NEC — or the reason one cannot be printed.
 *
 * A 1099-NEC is a tax form furnished to a recipient and the IRS. The batch
 * generator used to print "(payer address not configured)" / "—" in the payer
 * address and a "—" payer TIN when the organization had none on file — and
 * the organizations table carries no tax address or EIN column at all, so
 * every form it ever produced had a placeholder payer. A placeholder on a tax
 * form is never acceptable: the form is refused until the payer's legal name,
 * full address and TIN are on file.
 */

import type { Nec1099Payer } from "./form1099NecPdf";

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

export interface PayerAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface PayerSource {
  name?: string | null;
  legalEntityName?: string | null;
  taxAddress?: PayerAddress | null;
  ein?: string | null;
  phone?: string | null;
}

export type PayerResolution =
  | { ok: true; payer: Nec1099Payer }
  | { ok: false; missing: string[] };

const present = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function resolve1099Payer(org: PayerSource, maskTaxId: (raw: string) => string): PayerResolution {
  const missing: string[] = [];
  const name = present(org.legalEntityName) ? org.legalEntityName : present(org.name) ? org.name : null;
  if (!name) missing.push("payer legal name");
  const a = org.taxAddress ?? null;
  if (!a || !present(a.line1) || !present(a.city) || !present(a.state) || !present(a.zip)) {
    missing.push("payer address (street, city, state, ZIP)");
  }
  const tinDigits = present(org.ein) ? org.ein.replace(/[^0-9]/g, "") : "";
  if (tinDigits.length !== 9) missing.push("payer TIN (EIN)");
  if (missing.length > 0 || !name || !a) return { ok: false, missing };
  return {
    ok: true,
    payer: {
      name,
      address: {
        line1: a.line1 as string,
        ...(present(a.line2) ? { line2: a.line2 } : {}),
        city: a.city as string,
        state: a.state as string,
        zip: a.zip as string,
      },
      ...(present(org.phone) ? { phone: org.phone } : {}),
      taxIdMasked: maskTaxId(org.ein as string),
    },
  };
}
