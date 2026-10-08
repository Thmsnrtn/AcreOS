/**
 * Top-up credit packs — the ONE catalogue (browser-safe; no server imports).
 *
 * Founder decision 2026-10-08 (docs/company/founder-decisions-2026-10-08.md):
 * packs sell at 1.5¢ per credit instead of 1¢. Pack PRICES are unchanged; each
 * pack grants fewer credits:
 *
 *     credits = floor(priceCents / 1.5)  =  floor(priceCents × 2 / 3)
 *
 *     $10  → 666     $25 → 1,666     $50 → 3,333     $100 → 6,666
 *
 * Rounded DOWN: never promise a credit the money doesn't cover. Integer
 * arithmetic (× 2 / 3) so no float ever rounds a pack up. Credits already
 * purchased keep their value — this changes what a NEW purchase grants.
 *
 * 1 credit = 1 cent of usage in the purchased-credit balance
 * (organizations.credit_balance is denominated in cents).
 *
 * Every surface reads this: the schema's CREDIT_PACKS (checkout + webhook
 * grant), the purchase modal, and the outreach mail recharge cards.
 */

/** Price of one purchased credit, in cents. */
export const CREDIT_PRICE_CENTS = 1.5;

/** Credits a pack priced at `priceCents` grants (rounded down). */
export function creditsForPackPrice(priceCents: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  // floor(price / 1.5) in integers: 1.5 = 3/2.
  return Math.floor((Math.trunc(priceCents) * 2) / 3);
}

export interface CreditPackDef {
  id: "pack_10" | "pack_25" | "pack_50" | "pack_100";
  priceCents: number;
  credits: number;
  name: string;
}

function pack(id: CreditPackDef["id"], priceCents: number): CreditPackDef {
  const credits = creditsForPackPrice(priceCents);
  return {
    id,
    priceCents,
    credits,
    name: `$${priceCents / 100} Credit Pack (${credits.toLocaleString("en-US")} credits)`,
  };
}

export const CREDIT_PACK_CATALOG: Readonly<Record<CreditPackDef["id"], CreditPackDef>> = {
  pack_10: pack("pack_10", 1000),
  pack_25: pack("pack_25", 2500),
  pack_50: pack("pack_50", 5000),
  pack_100: pack("pack_100", 10000),
};
