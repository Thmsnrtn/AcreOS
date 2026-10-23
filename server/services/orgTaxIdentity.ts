/**
 * The organization's own tax identity — the ONE resolver every information
 * return the org files as payer/lender reads (Form 1098 lender block, Form
 * 1099-NEC payer block).
 *
 * Where it lives (shared/schema.ts, `organizations`):
 *   - `legalEntityName` (falls back to `name`) — the IRS filing name
 *   - `ein`        — CIPHERTEXT of the payer TIN (fieldEncryption envelope,
 *                    written by PATCH /api/organization/tax-identity)
 *   - `taxIdType`  — 'EIN' | 'SSN' | 'ITIN'
 *   - `taxAddress` — jsonb { line1, line2, city, state, zip, country, phone }
 *
 * The TIN is decrypted here and never logged. A decrypt failure resolves to
 * "" (treated as a placeholder) so neither ciphertext nor plaintext can leak
 * into an error message. Callers decide which problems refuse their form:
 * the 1098 path refuses on name/TIN; the 1099-NEC path also refuses on an
 * incomplete address.
 */

import { decrypt as decryptField, isAnyEncryptedEnvelope } from "./fieldEncryption";

const PLACEHOLDER_TINS = new Set(["00-0000000", "000-00-0000", "000000000"]);

/** Decrypt a stored TIN. Plaintext legacy rows pass through; failure → "". */
export function decryptTin(stored: string): string {
  if (!isAnyEncryptedEnvelope(stored)) return stored;
  try {
    return decryptField(stored);
  } catch {
    // Deliberately opaque: a decrypt failure must not leak ciphertext or
    // plaintext into an error. The caller treats "" as missing and refuses.
    return "";
  }
}

export function isPlaceholderTin(tin: string): boolean {
  const stripped = tin.replace(/[\s-]/g, "");
  return (
    !stripped ||
    PLACEHOLDER_TINS.has(tin) ||
    PLACEHOLDER_TINS.has(stripped) ||
    /^0{8,9}$/.test(stripped)
  );
}

export type OrgTinType = "EIN" | "SSN" | "ITIN";

export interface OrgTaxIdentitySource {
  name?: string | null;
  legalEntityName?: string | null;
  ein?: string | null;
  taxIdType?: string | null;
  taxAddress?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
    phone?: string | null;
  } | null;
}

export type OrgTaxIdentityProblem =
  | "NAME_MISSING"
  | "TIN_MISSING"
  | "TIN_PLACEHOLDER"
  | "ADDRESS_INCOMPLETE";

export interface OrgTaxIdentity {
  /** Trimmed legal entity name (or org name); null when neither is present. */
  name: string | null;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
  };
  phone: string;
  /** Decrypted TIN as stored ("" when missing or undecryptable). */
  tin: string;
  tinType: OrgTinType;
  /** Every reason this identity cannot be printed, in a stable order. */
  problems: OrgTaxIdentityProblem[];
}

const present = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function resolveOrgTaxIdentity(org: OrgTaxIdentitySource): OrgTaxIdentity {
  const problems: OrgTaxIdentityProblem[] = [];
  const name = org.legalEntityName?.trim() || org.name?.trim() || null;
  if (!name) problems.push("NAME_MISSING");

  let tin = "";
  if (!org.ein) {
    problems.push("TIN_MISSING");
  } else {
    tin = decryptTin(org.ein);
    if (isPlaceholderTin(tin)) problems.push("TIN_PLACEHOLDER");
  }

  const a = org.taxAddress ?? null;
  if (!a || !present(a.line1) || !present(a.city) || !present(a.state) || !present(a.zip)) {
    problems.push("ADDRESS_INCOMPLETE");
  }

  const tinType: OrgTinType =
    org.taxIdType === "SSN" || org.taxIdType === "ITIN" ? org.taxIdType : "EIN";

  return {
    name,
    address: {
      line1: a?.line1 || "",
      line2: a?.line2 ?? undefined,
      city: a?.city || "",
      state: a?.state || "",
      zip: a?.zip || "",
      country: a?.country ?? undefined,
    },
    phone: a?.phone || "",
    tin,
    tinType,
    problems,
  };
}

/** Last-4 mask in the shape of the TIN type: EIN XX-XXX1234, SSN/ITIN XXX-XX-1234. */
export function maskOrgTin(tin: string, tinType: OrgTinType): string {
  const last4 = tin.replace(/[^0-9]/g, "").slice(-4);
  return tinType === "EIN" ? `XX-XXX${last4}` : `XXX-XX-${last4}`;
}
