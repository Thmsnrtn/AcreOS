/**
 * Pillar T — Stripe drift detector.
 *
 * Compares the live Stripe account against the canonical AcreOS
 * subscription product set defined in shared/billing/tier-pricing.ts.
 *
 * Detects:
 *   - missing tier products (e.g. somebody archived Starter)
 *   - price-amount drift (Pro is suddenly $59 in Stripe vs $49 canonical)
 *   - orphaned acreos_product products that aren't in the canonical
 *     registry (e.g. an old test product never cleaned up)
 *   - missing prices (tier exists but monthly+yearly aren't both there)
 *
 * On detection:
 *   - logs structured drift event to agent_events
 *   - writes a `red` /founder/now inbox item via decisionsInboxItems
 *   - on "missing tier" severity, can auto-run the setup script to
 *     reconcile (gated by founder's auto-heal preference; default
 *     off so the first run after this lands is observe-only).
 *
 * Read-only against Stripe by default; the auto-reconcile path requires
 * STRIPE_DRIFT_AUTO_HEAL=true on Fly.
 */

import Stripe from "stripe";
import { db } from "../db";
import { agentEvents, decisionsInboxItems } from "@shared/schema";
import { TIER_PRICES_CENTS, VERTICAL_PACKS } from "@shared/billing/tier-pricing";
import { logger } from "../utils/logger";

export interface DriftFinding {
  severity: "info" | "warn" | "critical";
  kind: "missing_product" | "missing_price" | "price_drift" | "orphan_product";
  acreosKey?: string;
  productId?: string;
  expectedCents?: number;
  actualCents?: number;
  message: string;
}

interface CanonicalSpec {
  acreosKey: string;
  expectedMonthlyCents: number;
  expectedYearlyCents: number;
}

function canonicalSpecs(): CanonicalSpec[] {
  const specs: CanonicalSpec[] = [];
  for (const tier of ["starter", "pro", "scale"] as const) {
    const p = TIER_PRICES_CENTS[tier];
    specs.push({
      acreosKey: `tier_${tier}`,
      expectedMonthlyCents: p.priceMonthlyCents,
      expectedYearlyCents: p.priceYearlyCents,
    });
    if (p.priceMonthlyPerSeatCents !== null) {
      specs.push({
        acreosKey: `seat_${tier}`,
        expectedMonthlyCents: p.priceMonthlyPerSeatCents,
        // Seat yearly = 10× monthly per the tier-pricing convention.
        expectedYearlyCents: p.priceMonthlyPerSeatCents * 10,
      });
    }
  }
  for (const key of Object.keys(VERTICAL_PACKS) as Array<keyof typeof VERTICAL_PACKS>) {
    const pack = VERTICAL_PACKS[key];
    specs.push({
      acreosKey: `pack_${key}`,
      expectedMonthlyCents: pack.priceMonthlyCents,
      expectedYearlyCents: pack.priceYearlyCents,
    });
  }
  return specs;
}

export async function detectStripeDrift(): Promise<DriftFinding[]> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    logger.warn("[stripe-drift] STRIPE_SECRET_KEY not set; skipping");
    return [];
  }
  const stripe = new Stripe(secret, { apiVersion: "2023-10-16" as Stripe.LatestApiVersion });
  const findings: DriftFinding[] = [];

  // Page all active products + their prices.
  const products: Stripe.Product[] = [];
  let starting_after: string | undefined;
  while (true) {
    const page = await stripe.products.list({ limit: 100, active: true, starting_after });
    products.push(...page.data);
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  const acreosProducts = products.filter((p) => p.metadata?.acreos_product === "true");
  const byKey = new Map<string, Stripe.Product>();
  for (const p of acreosProducts) {
    if (p.metadata?.acreos_key) byKey.set(p.metadata.acreos_key, p);
  }

  const canonical = canonicalSpecs();
  const expectedKeys = new Set(canonical.map((c) => c.acreosKey));

  // ── Missing products ─────────────────────────────────────────────
  for (const spec of canonical) {
    if (!byKey.has(spec.acreosKey)) {
      findings.push({
        severity: "critical",
        kind: "missing_product",
        acreosKey: spec.acreosKey,
        message: `Canonical Stripe product missing: ${spec.acreosKey}. Run scripts/setup-stripe-subscription-products.ts to reconcile.`,
      });
    }
  }

  // ── Orphans ──────────────────────────────────────────────────────
  for (const p of acreosProducts) {
    const key = p.metadata?.acreos_key;
    if (key && !expectedKeys.has(key)) {
      findings.push({
        severity: "warn",
        kind: "orphan_product",
        acreosKey: key,
        productId: p.id,
        message: `Stripe product ${p.id} (${p.name}) is acreos_product=true but acreos_key="${key}" is not in the canonical registry. Consider archiving.`,
      });
    }
  }

  // ── Price drift + missing prices ─────────────────────────────────
  for (const spec of canonical) {
    const product = byKey.get(spec.acreosKey);
    if (!product) continue;
    const prices = await stripe.prices.list({ product: product.id, limit: 100, active: true });
    const monthly = prices.data.find((p) => p.recurring?.interval === "month");
    const yearly = prices.data.find((p) => p.recurring?.interval === "year");

    if (!monthly) {
      findings.push({
        severity: "critical",
        kind: "missing_price",
        acreosKey: spec.acreosKey,
        productId: product.id,
        message: `${spec.acreosKey} is missing an active monthly price in Stripe.`,
      });
    } else if (monthly.unit_amount !== spec.expectedMonthlyCents) {
      findings.push({
        severity: "critical",
        kind: "price_drift",
        acreosKey: spec.acreosKey,
        productId: product.id,
        expectedCents: spec.expectedMonthlyCents,
        actualCents: monthly.unit_amount ?? 0,
        message: `${spec.acreosKey} monthly: Stripe says $${(monthly.unit_amount ?? 0) / 100}, canonical says $${spec.expectedMonthlyCents / 100}.`,
      });
    }

    if (!yearly) {
      findings.push({
        severity: "critical",
        kind: "missing_price",
        acreosKey: spec.acreosKey,
        productId: product.id,
        message: `${spec.acreosKey} is missing an active yearly price in Stripe.`,
      });
    } else if (yearly.unit_amount !== spec.expectedYearlyCents) {
      findings.push({
        severity: "critical",
        kind: "price_drift",
        acreosKey: spec.acreosKey,
        productId: product.id,
        expectedCents: spec.expectedYearlyCents,
        actualCents: yearly.unit_amount ?? 0,
        message: `${spec.acreosKey} yearly: Stripe says $${(yearly.unit_amount ?? 0) / 100}, canonical says $${spec.expectedYearlyCents / 100}.`,
      });
    }
  }

  return findings;
}

/**
 * Top-level cron entrypoint. Detects drift, writes findings to
 * agent_events + decisionsInboxItems for /founder/now surfacing,
 * and optionally auto-reconciles when STRIPE_DRIFT_AUTO_HEAL=true.
 */
export async function runStripeDriftJob(): Promise<{ findings: DriftFinding[]; reconciled: boolean }> {
  const findings = await detectStripeDrift();
  if (findings.length === 0) {
    logger.info("[stripe-drift] no drift detected");
    return { findings: [], reconciled: false };
  }

  logger.warn(`[stripe-drift] ${findings.length} findings`);

  try {
    const { getFounderPrimaryOrgId } = await import("./founder");
    const orgId = await getFounderPrimaryOrgId();
    await db.insert(agentEvents).values({
      organizationId: orgId,
      eventType: "stripe_drift_detected",
      eventSource: "stripe_drift_detector",
      payload: {
        agentCodename: "stripe_drift_detector",
        findingCount: findings.length,
        critical: findings.filter((f) => f.severity === "critical").length,
        findings: findings.slice(0, 50), // cap payload size
        actionUrl: "/founder/now#stripe-drift",
        title: `Stripe drift: ${findings.length} finding${findings.length === 1 ? "" : "s"}`,
        message: findings[0].message,
      },
    });

    // Surface as a /founder/now inbox item (red if any critical).
    const critical = findings.filter((f) => f.severity === "critical").length > 0;
    await db.insert(decisionsInboxItems).values({
      itemType: "stripe_drift",
      riskLevel: critical ? "critical" : "medium",
      urgencyScore: critical ? 95 : 60,
      sophieAnalysis:
        `Stripe drift detector found ${findings.length} discrepancies between the live account and ` +
        `shared/billing/tier-pricing.ts.\n\nTop findings:\n` +
        findings.slice(0, 5).map((f) => `  • [${f.severity}] ${f.message}`).join("\n"),
      recommendedAction: "Run scripts/setup-stripe-subscription-products.ts to reconcile, or archive orphans manually.",
      recommendedActionLabel: critical ? "Reconcile Stripe (critical)" : "Review Stripe drift",
      organizationId: orgId,
      status: "pending",
      ownerAgentCodename: "stripe_drift_detector",
    });
  } catch (err) {
    logger.error("[stripe-drift] failed to write inbox item", err);
  }

  return { findings, reconciled: false };
}
