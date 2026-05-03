/**
 * Shared tax-identity validators (org-side 1099 issuer fields).
 *
 * Lives in `shared/` so both the client onboarding form and the server
 * PATCH endpoint apply the exact same regexes — no drift between
 * the in-form hint and the 422 the server returns.
 *
 * Formats (IRS-canonical):
 *   - EIN  : XX-XXXXXXX        (e.g. "12-3456789")
 *   - SSN  : XXX-XX-XXXX       (e.g. "123-45-6789")
 *   - ITIN : 9XX-XX-XXXX       (always begins with 9; second group 70-88, 90-92, 94-99)
 *
 * Recipient-side capture (W-9 from borrower) is intentionally OUT of scope
 * for this module — the leads.taxId column is captured separately at
 * lead-creation time.
 */
import { z } from "zod";

// ─── Regex ────────────────────────────────────────────────────────────────────
//
// EIN: two digits, dash, seven digits. First two digits cannot be all-zero
// (the IRS reserves "00-" for placeholders / never-issued ranges).
export const EIN_REGEX = /^(?!00-)[0-9]{2}-[0-9]{7}$/;

// SSN: standard 3-2-4. Reject the obvious all-zero placeholder and the
// "9##" ranges that belong to ITINs (we only accept those when type=ITIN).
export const SSN_REGEX = /^(?!000-)(?!666-)(?!9)[0-9]{3}-(?!00-)[0-9]{2}-(?!0000$)[0-9]{4}$/;

// ITIN: starts with 9, second group is 70-88, 90-92, or 94-99 (per IRS).
// A looser-but-still-strict check is sufficient for onboarding capture; the
// strict middle-group enumeration is enforced when we narrow the type.
export const ITIN_REGEX = /^9[0-9]{2}-(7[0-9]|8[0-8]|9[0-2]|9[4-9])-(?!0000$)[0-9]{4}$/;

export type TaxIdType = "EIN" | "SSN" | "ITIN";

/** Returns true if `value` is a valid identifier of the given type. */
export function isValidTaxId(value: string, type: TaxIdType): boolean {
  if (typeof value !== "string") return false;
  switch (type) {
    case "EIN":
      return EIN_REGEX.test(value);
    case "SSN":
      return SSN_REGEX.test(value);
    case "ITIN":
      return ITIN_REGEX.test(value);
  }
}

/** Last-4 digits, suitable for audit logs (never the full ID). */
export function taxIdLast4(value: string): string {
  const digits = (value || "").replace(/\D/g, "");
  return digits.slice(-4) || "----";
}

/** Display mask for a stored ID — we never re-render the full value to the UI. */
export function maskTaxId(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••-••-${digits.slice(-4)}`;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const taxAddressSchema = z.object({
  line1: z.string().min(1, "Street address is required").max(200),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(1, "City is required").max(100),
  state: z
    .string()
    .length(2, "State must be a 2-letter code")
    .regex(/^[A-Z]{2}$/, "State must be uppercase letters (e.g. TX)"),
  zip: z
    .string()
    .regex(/^[0-9]{5}(-[0-9]{4})?$/, "ZIP must be 5 digits or ZIP+4"),
  country: z.string().max(2).optional().default("US"),
  phone: z.string().max(32).optional().or(z.literal("")),
});

export type TaxAddress = z.infer<typeof taxAddressSchema>;

/** Server-side schema for PATCH /api/organization/tax-identity. */
export const taxIdentitySchema = z
  .object({
    legalEntityName: z
      .string()
      .min(1, "Legal entity name is required")
      .max(255, "Legal entity name is too long"),
    taxIdType: z.enum(["EIN", "SSN", "ITIN"]),
    taxId: z.string().min(1, "Tax ID is required"),
    taxAddress: taxAddressSchema,
  })
  .superRefine((data, ctx) => {
    if (!isValidTaxId(data.taxId, data.taxIdType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taxId"],
        message: taxIdFormatHint(data.taxIdType),
      });
    }
  });

export type TaxIdentityInput = z.infer<typeof taxIdentitySchema>;

/** Human-readable hint shown next to the input. */
export function taxIdFormatHint(type: TaxIdType): string {
  switch (type) {
    case "EIN":
      return "EIN must be in the format XX-XXXXXXX";
    case "SSN":
      return "SSN must be in the format XXX-XX-XXXX";
    case "ITIN":
      return "ITIN must be in the format 9XX-XX-XXXX (starting with 9)";
  }
}

/**
 * Light client-side formatter: turns "123456789" into "12-3456789" (EIN)
 * or "123456789" into "123-45-6789" (SSN/ITIN). Pure cosmetic — server
 * still validates with the regex above.
 */
export function formatTaxIdAsTyped(raw: string, type: TaxIdType): string {
  const digits = (raw || "").replace(/\D/g, "").slice(0, 9);
  if (type === "EIN") {
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  // SSN / ITIN share the 3-2-4 layout
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
