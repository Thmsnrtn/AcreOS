#!/usr/bin/env tsx
/**
 * Create AcreOS subscription products + prices in Stripe.
 *
 * What it creates:
 *   - 3 base tiers (Starter / Pro / Scale), each with monthly + yearly prices.
 *   - 2 seat add-on products (Pro Seat / Scale Seat), each with monthly + yearly.
 *   - 5 vertical packs (Note Investor / Property Management / Fix-and-Flip /
 *     Subdivision / Wholesale), each with monthly + yearly.
 *
 * Idempotent: looks up existing products by `metadata.acreos_key` and reuses
 * them rather than creating duplicates. New prices are appended (Stripe
 * doesn't allow editing a price — only creating new ones and archiving old).
 *
 * Tags every product with `metadata.acreos_product = "true"` so the
 * `/api/stripe/products` endpoint can filter to AcreOS-only products and
 * stop rendering random items from the Stripe account.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/setup-stripe-subscription-products.ts
 *   # or
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/setup-stripe-subscription-products.ts --dry-run
 *
 * Output: each line of fly-secrets-style "KEY=value" so you can pipe into
 *   `fly secrets set` after reviewing.
 */
import Stripe from "stripe";
import { TIER_PRICES_CENTS, VERTICAL_PACKS } from "../shared/billing/tier-pricing";

const DRY_RUN = process.argv.includes("--dry-run");

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("STRIPE_SECRET_KEY env var is required.");
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: "2023-10-16" as Stripe.LatestApiVersion });

interface ProductSpec {
  acreosKey: string;
  name: string;
  description: string;
  metadata: Record<string, string>;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  // env var names to print at the end so caller can map them to Fly secrets.
  envMonthly: string;
  envYearly: string;
}

const SPECS: ProductSpec[] = [
  // ── Tiers ──────────────────────────────────────────────────────────
  {
    acreosKey: "tier_starter",
    name: "AcreOS — Starter",
    description:
      "Replace your spreadsheet. 250 leads, 50 properties, 25 notes, 500 AI requests/mo, 5 campaigns, 2 sequences. Single seat.",
    metadata: { tier: "starter", maxSeats: "1", aiCreditsMonthly: "500" },
    monthlyPriceCents: TIER_PRICES_CENTS.starter.priceMonthlyCents,
    yearlyPriceCents: TIER_PRICES_CENTS.starter.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_SOLO_MONTHLY",
    envYearly: "STRIPE_PRICE_SOLO_YEARLY",
  },
  {
    acreosKey: "tier_pro",
    name: "AcreOS — Pro",
    description:
      "For serious operators. 500 leads, 100 properties, 50 notes, 1,000 AI requests/mo, unlimited campaigns + sequences, BYOK data providers. Up to 2 seats included; $20/extra seat/mo.",
    metadata: { tier: "pro", aiCreditsMonthly: "1000" },
    monthlyPriceCents: TIER_PRICES_CENTS.pro.priceMonthlyCents,
    yearlyPriceCents: TIER_PRICES_CENTS.pro.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_OPERATOR_MONTHLY",
    envYearly: "STRIPE_PRICE_OPERATOR_YEARLY",
  },
  {
    acreosKey: "tier_scale",
    name: "AcreOS — Scale",
    description:
      "For growing teams. Unlimited leads / properties / notes / AI, 10 seats included, $40/extra seat/mo, priority support, SMS + voice outreach, full BYOK provider stack.",
    metadata: { tier: "scale", aiCreditsMonthly: "-1" },
    monthlyPriceCents: TIER_PRICES_CENTS.scale.priceMonthlyCents,
    yearlyPriceCents: TIER_PRICES_CENTS.scale.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_EMPIRE_MONTHLY",
    envYearly: "STRIPE_PRICE_EMPIRE_YEARLY",
  },
  // ── Seat add-ons ───────────────────────────────────────────────────
  {
    acreosKey: "seat_pro",
    name: "AcreOS — Pro Seat",
    description: "Additional team-member seat on the Pro plan.",
    metadata: { type: "seat_addon", tier: "pro" },
    monthlyPriceCents: 2000,   // $20/seat/mo
    yearlyPriceCents: 20000,   // $200/seat/yr
    envMonthly: "STRIPE_PRICE_OPERATOR_SEAT_MONTHLY",
    envYearly: "STRIPE_PRICE_OPERATOR_SEAT_YEARLY",
  },
  {
    acreosKey: "seat_scale",
    name: "AcreOS — Scale Seat",
    description: "Additional team-member seat on the Scale plan.",
    metadata: { type: "seat_addon", tier: "scale" },
    monthlyPriceCents: 2500,   // $25/seat/mo (was $40 — founder decision 2026-07-08)
    yearlyPriceCents: 25000,   // $250/seat/yr
    envMonthly: "STRIPE_PRICE_EMPIRE_SEAT_MONTHLY",
    envYearly: "STRIPE_PRICE_EMPIRE_SEAT_YEARLY",
  },
  // ── Vertical packs ─────────────────────────────────────────────────
  {
    acreosKey: "pack_note_investor",
    name: "AcreOS — Note Investor pack",
    description: VERTICAL_PACKS.note_investor.tagline,
    metadata: { type: "vertical_pack", pack_key: "note_investor" },
    monthlyPriceCents: VERTICAL_PACKS.note_investor.priceMonthlyCents,
    yearlyPriceCents: VERTICAL_PACKS.note_investor.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_PACK_NI_MONTHLY",
    envYearly: "STRIPE_PRICE_PACK_NI_YEARLY",
  },
  {
    acreosKey: "pack_buy_and_hold",
    name: "AcreOS — Property Management pack",
    description: VERTICAL_PACKS.buy_and_hold.tagline,
    metadata: { type: "vertical_pack", pack_key: "buy_and_hold" },
    monthlyPriceCents: VERTICAL_PACKS.buy_and_hold.priceMonthlyCents,
    yearlyPriceCents: VERTICAL_PACKS.buy_and_hold.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_PACK_BH_MONTHLY",
    envYearly: "STRIPE_PRICE_PACK_BH_YEARLY",
  },
  {
    acreosKey: "pack_fix_and_flipper",
    name: "AcreOS — Fix-and-Flip pack",
    description: VERTICAL_PACKS.fix_and_flipper.tagline,
    metadata: { type: "vertical_pack", pack_key: "fix_and_flipper" },
    monthlyPriceCents: VERTICAL_PACKS.fix_and_flipper.priceMonthlyCents,
    yearlyPriceCents: VERTICAL_PACKS.fix_and_flipper.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_PACK_FF_MONTHLY",
    envYearly: "STRIPE_PRICE_PACK_FF_YEARLY",
  },
  {
    acreosKey: "pack_subdivision",
    name: "AcreOS — Subdivision pack",
    description: VERTICAL_PACKS.subdivision.tagline,
    metadata: { type: "vertical_pack", pack_key: "subdivision" },
    monthlyPriceCents: VERTICAL_PACKS.subdivision.priceMonthlyCents,
    yearlyPriceCents: VERTICAL_PACKS.subdivision.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_PACK_SD_MONTHLY",
    envYearly: "STRIPE_PRICE_PACK_SD_YEARLY",
  },
  {
    acreosKey: "pack_wholesale",
    name: "AcreOS — Wholesale pack",
    description: VERTICAL_PACKS.wholesale.tagline,
    metadata: { type: "vertical_pack", pack_key: "wholesale" },
    monthlyPriceCents: VERTICAL_PACKS.wholesale.priceMonthlyCents,
    yearlyPriceCents: VERTICAL_PACKS.wholesale.priceYearlyCents,
    envMonthly: "STRIPE_PRICE_PACK_W_MONTHLY",
    envYearly: "STRIPE_PRICE_PACK_W_YEARLY",
  },
];

/**
 * Derive the shared-account convention fields from an acreos_key.
 * See docs/stripe-shared-account.md. `app_object` ∈ plan|seat|pack;
 * `plan_key` is the stable key; `lookupBase` seeds price lookup_keys
 * as `<lookupBase>_<monthly|yearly>`.
 */
function deriveConvention(acreosKey: string): {
  appObject: "plan" | "seat" | "pack";
  planKey: string;
  lookupBase: string;
} {
  if (acreosKey.startsWith("tier_")) {
    const planKey = acreosKey.slice("tier_".length);
    return { appObject: "plan", planKey, lookupBase: `acreos_${planKey}` };
  }
  if (acreosKey.startsWith("seat_")) {
    const planKey = acreosKey.slice("seat_".length);
    return { appObject: "seat", planKey, lookupBase: `acreos_seat_${planKey}` };
  }
  if (acreosKey.startsWith("pack_")) {
    const planKey = acreosKey.slice("pack_".length);
    return { appObject: "pack", planKey, lookupBase: `acreos_pack_${planKey}` };
  }
  throw new Error(`Unrecognised acreos_key prefix: ${acreosKey}`);
}

async function findOrCreateProduct(spec: ProductSpec): Promise<Stripe.Product> {
  // Look up existing product by metadata.acreos_key (paginate; Stripe
  // doesn't support metadata.* in search outside specific account types,
  // so we scan).
  let starting_after: string | undefined;
  while (true) {
    const page = await stripe.products.list({ limit: 100, starting_after, active: true });
    for (const p of page.data) {
      if (p.metadata?.acreos_key === spec.acreosKey) {
        console.log(`  reusing existing: ${p.id} (${p.name})`);
        return p;
      }
    }
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }

  if (DRY_RUN) {
    console.log(`  would create: ${spec.name}`);
    return { id: "prod_DRY_RUN_" + spec.acreosKey } as unknown as Stripe.Product;
  }

  const conv = deriveConvention(spec.acreosKey);
  const product = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    statement_descriptor: "ACREOS",
    metadata: {
      ...spec.metadata,
      acreos_key: spec.acreosKey,
      acreos_product: "true",
      // Shared-account convention (docs/stripe-shared-account.md)
      app: "acreos",
      app_object: conv.appObject,
      plan_key: conv.planKey,
    },
  });
  console.log(`  created product: ${product.id} (${product.name})`);
  return product;
}

async function findOrCreatePrice(
  productId: string,
  unitAmount: number,
  interval: "month" | "year",
  planKey: string,
  lookupBase: string,
): Promise<Stripe.Price> {
  if (DRY_RUN) {
    console.log(`    would create price: $${unitAmount / 100}/${interval} → product ${productId}`);
    return { id: `price_DRY_RUN_${productId}_${interval}` } as unknown as Stripe.Price;
  }
  // Search for an existing active price matching amount + interval.
  let starting_after: string | undefined;
  while (true) {
    const page = await stripe.prices.list({
      product: productId,
      limit: 100,
      starting_after,
      active: true,
    });
    for (const p of page.data) {
      if (p.unit_amount === unitAmount && p.recurring?.interval === interval) {
        console.log(`    reusing existing price: ${p.id} ($${unitAmount / 100}/${interval})`);
        return p;
      }
    }
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }

  const period = interval === "year" ? "yearly" : "monthly";
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval },
    lookup_key: `${lookupBase}_${period}`,
    metadata: {
      billingPeriod: period,
      // Shared-account convention (docs/stripe-shared-account.md)
      app: "acreos",
      plan_key: planKey,
      billing_period: period,
    },
  });
  console.log(`    created price: ${price.id} ($${unitAmount / 100}/${interval}) [${lookupBase}_${period}]`);
  return price;
}

async function main() {
  console.log(`AcreOS Stripe product setup ${DRY_RUN ? "(DRY RUN)" : "(live)"}`);
  console.log(`Stripe key: ${secret.slice(0, 7)}...${secret.slice(-4)}\n`);

  const envOutputs: string[] = [];

  for (const spec of SPECS) {
    console.log(`→ ${spec.acreosKey}`);
    const conv = deriveConvention(spec.acreosKey);
    const product = await findOrCreateProduct(spec);
    const monthly = await findOrCreatePrice(product.id, spec.monthlyPriceCents, "month", conv.planKey, conv.lookupBase);
    const yearly = await findOrCreatePrice(product.id, spec.yearlyPriceCents, "year", conv.planKey, conv.lookupBase);
    envOutputs.push(`${spec.envMonthly}=${monthly.id}`);
    envOutputs.push(`${spec.envYearly}=${yearly.id}`);
  }

  console.log("\n── Fly secrets to set ──────────────────────────────────────");
  console.log(envOutputs.join(" \\\n  "));
  console.log("\nTo apply:");
  console.log(`  fly secrets set -a acreos \\\n    ${envOutputs.join(" \\\n    ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
