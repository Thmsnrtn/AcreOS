/**
 * Customer Concentration Check (Phase 3 Week 10 — Part C).
 *
 * Daily job that snapshots MRR concentration across the active customer base
 * so the founder can spot revenue-risk before it bites. Two thresholds, both
 * defined in shared/schema.ts → CONCENTRATION_THRESHOLDS:
 *
 *   - Single customer > 20% of MRR  → CRITICAL alert (email + in-app banner)
 *   - Top-3 customers > 40% of MRR  → WARNING alert (email + in-app banner)
 *
 * Snapshots are written to `customer_concentration` regardless of whether an
 * alert fired; that's the historical record the founder dashboard uses to
 * chart concentration over time.
 *
 * MRR math: pulls from monthlyRevenueCentsFor() in shared/billing/tier-pricing
 * so the surface can never drift from the executive dashboard. Yearly subs are
 * normalised to a per-month figure there.
 *
 * Idempotency: the job inserts a fresh snapshot on every run; there's no
 * "skip if we already ran today" guard because rerunning is harmless and the
 * by-day index keeps the surface tidy. The alert dedupe lives downstream
 * (system_alerts already dedupes by type + organizationId for active alerts).
 *
 * Scheduled via the existing setInterval framework in server/index.ts (no
 * BullMQ dependency for this thin job).
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  organizations,
  customerConcentration,
  CONCENTRATION_THRESHOLDS,
  type InsertCustomerConcentration,
  type InsertSystemAlert,
} from "@shared/schema";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import { storage } from "../storage";
import { logger } from "../utils/logger";

const TOP_N = 10; // top-10 orgs captured in snapshot.topOrgs

interface OrgMrr {
  organizationId: number;
  name: string;
  tier: string;
  billingInterval: string;
  mrrCents: number;
}

export interface ConcentrationResult {
  computedAt: Date;
  totalMrrCents: number;
  activeOrgCount: number;
  topMrrPctSingle: number;
  topMrrPctTop3: number;
  alertTriggered: boolean;
  alertSeverity: "warning" | "critical" | null;
  topOrgs: Array<OrgMrr & { pctOfTotal: number }>;
}

/**
 * Compute concentration snapshot. Pure read from DB; no writes.
 */
export async function computeCustomerConcentration(): Promise<ConcentrationResult> {
  const allOrgs = await db.select().from(organizations).limit(50000);
  const activeOrgs = allOrgs.filter((o) => o.subscriptionStatus === "active");

  const orgMrrs: OrgMrr[] = activeOrgs.map((o) => {
    const interval = (o.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
    const mrrCents = monthlyRevenueCentsFor(o.subscriptionTier, interval);
    return {
      organizationId: o.id,
      name: o.name,
      tier: o.subscriptionTier,
      billingInterval: interval,
      mrrCents,
    };
  });

  // Drop free-tier and any org with 0 MRR — they don't contribute to
  // concentration math (and cluttering the snapshot just adds noise).
  const paying = orgMrrs.filter((m) => m.mrrCents > 0);
  paying.sort((a, b) => b.mrrCents - a.mrrCents);

  const totalMrrCents = paying.reduce((sum, o) => sum + o.mrrCents, 0);

  const topSingleMrr = paying[0]?.mrrCents ?? 0;
  const top3Mrr = paying.slice(0, 3).reduce((sum, o) => sum + o.mrrCents, 0);

  const topMrrPctSingle = totalMrrCents > 0 ? (topSingleMrr / totalMrrCents) * 100 : 0;
  const topMrrPctTop3 = totalMrrCents > 0 ? (top3Mrr / totalMrrCents) * 100 : 0;

  // Severity policy:
  //   - critical when single-customer concentration breaches the threshold
  //     (one churn = catastrophic revenue hit)
  //   - warning when top-3 breaches (churn-cluster risk, less acute)
  let alertSeverity: "warning" | "critical" | null = null;
  if (topMrrPctSingle > CONCENTRATION_THRESHOLDS.singleCustomerCriticalPct) {
    alertSeverity = "critical";
  } else if (topMrrPctTop3 > CONCENTRATION_THRESHOLDS.top3CustomersWarningPct) {
    alertSeverity = "warning";
  }

  const topOrgs = paying.slice(0, TOP_N).map((o) => ({
    ...o,
    pctOfTotal: totalMrrCents > 0 ? (o.mrrCents / totalMrrCents) * 100 : 0,
  }));

  return {
    computedAt: new Date(),
    totalMrrCents,
    activeOrgCount: paying.length,
    topMrrPctSingle: Math.round(topMrrPctSingle * 100) / 100,
    topMrrPctTop3: Math.round(topMrrPctTop3 * 100) / 100,
    alertTriggered: alertSeverity !== null,
    alertSeverity,
    topOrgs,
  };
}

/**
 * Run the daily concentration job — compute, persist snapshot, and emit
 * alerts when thresholds are breached.
 */
export async function runCustomerConcentrationCheck(): Promise<ConcentrationResult> {
  const result = await computeCustomerConcentration();

  // Persist the snapshot. Numeric fields stored as strings via drizzle.
  const insert: InsertCustomerConcentration = {
    topMrrPctSingle: result.topMrrPctSingle.toFixed(2),
    topMrrPctTop3: result.topMrrPctTop3.toFixed(2),
    totalMrrCents: result.totalMrrCents,
    activeOrgCount: result.activeOrgCount,
    snapshot: { topOrgs: result.topOrgs },
    alertTriggered: result.alertTriggered,
    alertSeverity: result.alertSeverity,
  };

  await db.insert(customerConcentration).values(insert);

  if (result.alertTriggered) {
    await emitConcentrationAlert(result);
  }

  logger.info("[CustomerConcentration] snapshot computed", {
    metadata: {
      totalMrrCents: result.totalMrrCents,
      topMrrPctSingle: result.topMrrPctSingle,
      topMrrPctTop3: result.topMrrPctTop3,
      alertTriggered: result.alertTriggered,
      alertSeverity: result.alertSeverity,
      activeOrgCount: result.activeOrgCount,
    },
  });

  return result;
}

/**
 * Emit an in-app banner alert (system_alerts row) plus a founder email.
 * The banner is the primary surface; the email is the broadcast leg.
 */
async function emitConcentrationAlert(result: ConcentrationResult): Promise<void> {
  const topOrg = result.topOrgs[0];
  const top3 = result.topOrgs.slice(0, 3);

  const title =
    result.alertSeverity === "critical"
      ? `Revenue concentration: ${topOrg?.name ?? "top customer"} = ${result.topMrrPctSingle.toFixed(1)}% of MRR`
      : `Revenue concentration: top 3 customers = ${result.topMrrPctTop3.toFixed(1)}% of MRR`;

  const message =
    result.alertSeverity === "critical"
      ? `${topOrg?.name ?? "Top customer"} represents ${result.topMrrPctSingle.toFixed(1)}% of MRR ` +
        `($${((topOrg?.mrrCents ?? 0) / 100).toFixed(2)}/mo of $${(result.totalMrrCents / 100).toFixed(2)}). ` +
        `If they churn, the revenue hit is severe — consider proactive retention or a product-led expansion plan.`
      : `Top 3 customers contribute ${result.topMrrPctTop3.toFixed(1)}% of MRR. ` +
        `Concentration risk is elevated; diversifying the customer base reduces churn-cluster exposure.`;

  try {
    const alert: InsertSystemAlert = {
      type: "customer_concentration",
      alertType: "customer_concentration",
      severity: result.alertSeverity === "critical" ? "critical" : "warning",
      title,
      message,
      // No specific organizationId — this is a platform-level founder alert.
      organizationId: null as any,
      relatedEntityType: "platform",
      relatedEntityId: null as any,
      status: "new",
      autoResolvable: false,
      metadata: {
        topMrrPctSingle: result.topMrrPctSingle,
        topMrrPctTop3: result.topMrrPctTop3,
        totalMrrCents: result.totalMrrCents,
        activeOrgCount: result.activeOrgCount,
        topOrgs: top3,
        computedAt: result.computedAt.toISOString(),
      },
    };
    await storage.createSystemAlert(alert);
  } catch (err) {
    logger.warn("[CustomerConcentration] system_alerts insert failed", {
      metadata: { error: (err as Error).message },
    });
  }

  // Email the founder. Best-effort — never throw from an alert path.
  try {
    const { emailService } = await import("../services/emailService");
    const founderEmail = process.env.FOUNDER_EMAIL || "thmsnrtn@gmail.com";

    const top3Rows = top3
      .map(
        (o, i) =>
          `<li>#${i + 1}: ${o.name} — $${(o.mrrCents / 100).toFixed(2)}/mo (${o.pctOfTotal.toFixed(1)}%)</li>`,
      )
      .join("");

    await emailService.sendEmail({
      to: founderEmail,
      subject: `[AcreOS] ${title}`,
      html: `
        <h2>${title}</h2>
        <p>${message}</p>
        <h3>Top 3 customers by MRR</h3>
        <ul>${top3Rows}</ul>
        <p>Total MRR: $${(result.totalMrrCents / 100).toFixed(2)} across ${result.activeOrgCount} paying orgs.</p>
        <p><em>Computed at ${result.computedAt.toISOString()}</em></p>
      `,
      text:
        `${title}\n\n${message}\n\n` +
        `Top 3 customers:\n` +
        top3
          .map(
            (o, i) =>
              `  ${i + 1}. ${o.name} — $${(o.mrrCents / 100).toFixed(2)}/mo (${o.pctOfTotal.toFixed(1)}%)`,
          )
          .join("\n") +
        `\n\nTotal MRR: $${(result.totalMrrCents / 100).toFixed(2)} across ${result.activeOrgCount} paying orgs.\n` +
        `Computed at ${result.computedAt.toISOString()}.`,
    });
  } catch (err) {
    logger.warn("[CustomerConcentration] founder email send failed", {
      metadata: { error: (err as Error).message },
    });
  }
}
