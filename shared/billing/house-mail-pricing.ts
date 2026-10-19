/**
 * AcreOS house mail — what each piece COSTS AcreOS, and the rule that what it
 * charges covers it (founder decision 2026-10-17 B,
 * docs/company/founder-decisions-2026-10-17.md). Browser-safe: no server
 * imports, so Settings and the send surfaces read the same numbers.
 *
 *   "I should never be in the red for offering mailer service."
 *
 * House mail is paid ONLY from purchased credits, debited before Lob is
 * contacted, at a charge that satisfies
 *
 *   credits × CREDIT_PRICE_CENTS ≥ provider cost × (1 + card fee) × (1 + margin floor)
 *
 * for every spec AcreOS will print. A spec with no row in
 * HOUSE_MAIL_COST_TABLE is refused on the house lane — its cost is never
 * guessed.
 *
 * WHERE THE COSTS COME FROM. Lob's published list prices — Lob help center,
 * "Pricing details" (help.lob.com/print-and-mail/ready-to-get-started/
 * pricing-details), rates effective 2026-07-12 and the update scheduled for
 * 2026-11-01, read 2026-10-18. Each row takes the HIGHEST plan column
 * (pay-as-you-go / Developer — the plan AcreOS is on is unconfirmed, so the
 * conservative column), the 2026-11-01 rate where it is higher, rounded UP to
 * the whole cent. (Before 2026-10-18 the rows were the highest of three
 * internal estimates — 65–120¢ — which these replace.) Each row is
 * founder-settable without a deploy (founder_settings key
 * `mail.house.cost_cents.{key}`, resolved in server/services/mail/mailLane.ts).
 *
 * WHAT THE TABLE DOES NOT KNOW (so the house lane refuses it): any mail class
 * but USPS First Class (the class every send path uses, Lob's default), and any
 * extra service (certified, registered).
 *
 * LETTERS (founder decisions 2026-10-18): a house letter's page count must be
 * CONFIRMED — AcreOS renders HTML to PDF (or reads a PDF) and counts it; a
 * letter it cannot count is refused, never assumed to be one page. Pages after
 * the first cost HOUSE_MAIL_EXTRA_PAGE_COST_CENTS (Lob's list price, same
 * source), founder-overridable via `mail.house.cost_cents.letter_extra_page`
 * (B&W) and `…letter_extra_page_color`; letters over the founder's page cap
 * (default 6) are refused (server/services/mail/mailLane.ts houseMailPrice).
 */

import { CREDIT_PRICE_CENTS } from "./credit-packs";

/**
 * Stripe's worst case on the SMALLEST credit pack: 2.9% + 30¢ on $10.00 is
 * 59¢, i.e. 5.9% of what the credits were bought for.
 */
export const HOUSE_MAIL_CARD_FEE_ALLOWANCE = 0.059;

/**
 * The least margin a house piece may earn over its provider cost (after the
 * card fee). Founder-adjustable: change it here; the self-funding test then
 * re-checks every row against the new floor.
 */
export const HOUSE_MAIL_MARGIN_FLOOR = 0.1;

export type HouseMailKind = "postcard" | "letter";

/** What a send path is about to print. Fields a path does not set take the defaults every path uses today. */
export type HouseMailSpec =
  | { kind: "postcard"; size: string; mailClass?: string | null; extraService?: string | null }
  | {
      kind: "letter";
      color?: boolean | null;
      /** CONFIRMED page count; null/undefined = unknown (refused on the house lane). */
      pages?: number | null;
      /** The letter's content (HTML or a PDF URL), from which the page count may be confirmed. */
      file?: string | null;
      mailClass?: string | null;
      extraService?: string | null;
    };

export type HouseMailSpecKey = "postcard_4x6" | "postcard_6x9" | "postcard_6x11" | "letter_bw" | "letter_color";

export interface HouseMailCostEntry {
  key: HouseMailSpecKey;
  kind: HouseMailKind;
  label: string;
  /** AcreOS's provider cost for one piece, in cents (compiled default). */
  providerCostCents: number;
  /** Where the figure comes from. */
  source: string;
}

/** THE single source of AcreOS's cost for a house piece. */
export const HOUSE_MAIL_COST_TABLE: readonly HouseMailCostEntry[] = [
  {
    key: "postcard_4x6",
    kind: "postcard",
    label: "4×6 postcard",
    providerCostCents: 92,
    source: "Lob \"Pricing details\" (help.lob.com/print-and-mail/ready-to-get-started/pricing-details), highest plan column, read 2026-10-18: First-Class 4x6 $0.905 → 92¢ (rounded up, headroom for the 2026-11-01 update)",
  },
  {
    key: "postcard_6x9",
    kind: "postcard",
    label: "6×9 postcard",
    providerCostCents: 104,
    source: "Lob \"Pricing details\" (help.lob.com/print-and-mail/ready-to-get-started/pricing-details), highest plan column, read 2026-10-18: First-Class 6x9 $1.026 → 104¢",
  },
  {
    key: "postcard_6x11",
    kind: "postcard",
    label: "6×11 postcard",
    providerCostCents: 130,
    source: "Lob \"Pricing details\" (help.lob.com/print-and-mail/ready-to-get-started/pricing-details), highest plan column, read 2026-10-18: First-Class 6x11 $1.290 → 130¢",
  },
  {
    key: "letter_bw",
    kind: "letter",
    label: "Letter (one page, black & white)",
    providerCostCents: 107,
    source: "Lob \"Pricing details\" (help.lob.com/print-and-mail/ready-to-get-started/pricing-details), highest plan column, read 2026-10-18: B&W letter first page $1.060, $1.066 from 2026-11-01 → 107¢",
  },
  {
    key: "letter_color",
    kind: "letter",
    label: "Letter (one page, colour)",
    providerCostCents: 123,
    source: "Lob \"Pricing details\" (help.lob.com/print-and-mail/ready-to-get-started/pricing-details), highest plan column, read 2026-10-18: colour letter first page $1.220 → 123¢",
  },
];

/**
 * Lob's list price for each letter page after the first, in cents — the
 * default extra-page cost (founder-overridable). Same source as the table:
 * Lob 'Pricing details' (help.lob.com/print-and-mail/ready-to-get-started/pricing-details), highest plan column, read 2026-10-18: B&W $0.10 / $0.101 from 2026-11-01 → 11¢;
 * colour $0.20 / $0.201 → 21¢.
 */
export const HOUSE_MAIL_EXTRA_PAGE_COST_CENTS: Readonly<Record<"bw" | "color", number>> = { bw: 11, color: 21 };

const ENTRY_BY_KEY = new Map(HOUSE_MAIL_COST_TABLE.map((e) => [e.key, e] as const));

export function houseMailCostEntry(key: HouseMailSpecKey): HouseMailCostEntry {
  return ENTRY_BY_KEY.get(key)!;
}

const FIRST_CLASS = "usps_first_class";

/**
 * The ONE-PAGE row a spec is built on, ignoring page count: the postcard size,
 * or the letter's colour. Null for a mail class / extra service AcreOS has no
 * cost for.
 */
export function houseMailBaseKey(spec: HouseMailSpec): HouseMailSpecKey | null {
  if (spec.mailClass != null && spec.mailClass !== FIRST_CLASS) return null;
  if (spec.extraService != null && spec.extraService !== "" && spec.extraService !== "none") return null;
  if (spec.kind === "postcard") {
    const key = `postcard_${spec.size}`;
    return ENTRY_BY_KEY.has(key as HouseMailSpecKey) ? (key as HouseMailSpecKey) : null;
  }
  if (spec.kind === "letter") return spec.color ? "letter_color" : "letter_bw";
  return null;
}

/**
 * The table row for `spec` exactly as printed, or null when AcreOS has no
 * recorded cost for it — which the house lane treats as a refusal, never a
 * guess. A letter matches only when it is CONFIRMED to be one page.
 */
export function houseMailSpecKey(spec: HouseMailSpec): HouseMailSpecKey | null {
  if (spec.kind === "letter" && spec.pages !== 1) return null;
  return houseMailBaseKey(spec);
}

/** What one credit of the purchased balance was bought for, in cents. */
const HOUSE_MAIL_CREDIT_PRICE_CENTS = CREDIT_PRICE_CENTS;

/** The provider cost grossed up by the card-fee allowance and the margin floor, in cents. */
function houseMailRequiredRevenueCents(providerCostCents: number): number {
  return providerCostCents * (1 + HOUSE_MAIL_CARD_FEE_ALLOWANCE) * (1 + HOUSE_MAIL_MARGIN_FLOOR);
}

// Rounds away float noise (75 × 1.059 × 1.1 is 87.3675, not 87.36750000000001)
// so an exact boundary is judged on its real value.
const exact = (n: number) => Math.round(n * 1e6) / 1e6;

/** THE inequality: does `credits` per piece pay for a piece that costs AcreOS `providerCostCents`? */
export function houseMailChargeIsSelfFunding(credits: number, providerCostCents: number): boolean {
  if (!Number.isFinite(credits) || !Number.isFinite(providerCostCents) || providerCostCents <= 0) return false;
  return exact(credits * HOUSE_MAIL_CREDIT_PRICE_CENTS) >= exact(houseMailRequiredRevenueCents(providerCostCents));
}

/** The fewest whole credits per piece that pass the inequality. */
export function houseMailMinimumCredits(providerCostCents: number): number {
  const credits = Math.ceil(exact(houseMailRequiredRevenueCents(providerCostCents) / HOUSE_MAIL_CREDIT_PRICE_CENTS));
  return houseMailChargeIsSelfFunding(credits, providerCostCents) ? credits : credits + 1;
}

/**
 * The credits a house piece is charged: the surface's listed price (whole
 * credits), raised to the self-funding minimum when the listed price does not
 * cover the cost. Every house charge in the product is computed here.
 */
export function houseMailCreditsPerPiece(listedCredits: number, providerCostCents: number): number {
  const listed = Number.isFinite(listedCredits) && listedCredits > 0 ? Math.ceil(listedCredits) : 0;
  return Math.max(listed, houseMailMinimumCredits(providerCostCents));
}
