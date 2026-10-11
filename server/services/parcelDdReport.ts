/**
 * Per-parcel due-diligence report — purchase and delivery (W3).
 *
 * Price: shared/billing/parcelReportProduct.ts (ships UNSET → every purchase
 * is refused). Rail: the existing credit ledger (creditService.deductCredits),
 * one debit per org and parcel — buying the same parcel again re-delivers the
 * report without a second charge. Content: the same accuracy-gated facts and
 * data-truth warnings as the public page (publicLandFactsOf), never more.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { creditTransactions } from "@shared/schema";
import { DD_REPORT_CREDIT_KIND, DD_REPORT_PRICE_UNSET, PARCEL_DD_REPORT } from "@shared/billing/parcelReportProduct";
import type { PublicLandFacts } from "@shared/landData/publicFactText";
import { findOwnedParcelByKey } from "./landData/ownedParcelView";
import { publicLandFactsOf } from "./publicParcelReport";
import { creditService } from "./credits";
import { clock } from "../utils/clock";

export interface DdReport {
  title: string;
  generatedAt: string;
  facts: PublicLandFacts;
  disclaimer: string;
}

export const DD_REPORT_DISCLAIMER =
  "Informational only — not a survey, title search, appraisal or legal opinion. Facts are shown only where AcreOS's accuracy check passed; anything else is marked Not available.";

function buildReport(facts: PublicLandFacts): DdReport {
  return {
    title: `Due-diligence report — parcel ${facts.apn}, ${facts.countyLabel} County, ${facts.state}`,
    generatedAt: clock.now().toISOString(),
    facts,
    disclaimer: DD_REPORT_DISCLAIMER,
  };
}

async function alreadyPurchased(orgId: number, parcelKey: string): Promise<boolean> {
  const rows = await db
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.organizationId, orgId),
        eq(creditTransactions.type, "debit"),
        sql`${creditTransactions.metadata}->>'kind' = ${DD_REPORT_CREDIT_KIND}`,
        sql`${creditTransactions.metadata}->>'parcelKey' = ${parcelKey}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type DdOffer =
  | { available: false; reason: "price_unset" | "not_kept"; message: string }
  | { available: true; priceCents: number; rail: "credits"; alreadyPurchased: boolean };

export async function ddReportOffer(orgId: number, parcelKey: string): Promise<DdOffer> {
  if (PARCEL_DD_REPORT.priceCents === null) return { available: false, reason: "price_unset", message: DD_REPORT_PRICE_UNSET };
  const row = await findOwnedParcelByKey(parcelKey);
  if (!row) return { available: false, reason: "not_kept", message: "AcreOS does not keep this parcel, so it has no report to sell." };
  return { available: true, priceCents: PARCEL_DD_REPORT.priceCents, rail: "credits", alreadyPurchased: await alreadyPurchased(orgId, parcelKey) };
}

export type DdPurchase =
  | { ok: true; charged: boolean; priceCents: number; report: DdReport }
  | { ok: false; reason: "price_unset" | "not_kept" | "insufficient_credits"; message: string };

export async function purchaseDdReport(orgId: number, parcelKey: string): Promise<DdPurchase> {
  const price = PARCEL_DD_REPORT.priceCents;
  if (price === null) return { ok: false, reason: "price_unset", message: DD_REPORT_PRICE_UNSET };
  const row = await findOwnedParcelByKey(parcelKey);
  if (!row) return { ok: false, reason: "not_kept", message: "AcreOS does not keep this parcel." };
  const facts = publicLandFactsOf(row);
  if (await alreadyPurchased(orgId, parcelKey)) return { ok: true, charged: false, priceCents: price, report: buildReport(facts) };
  const debit = await creditService.deductCredits(orgId, price, `Parcel due-diligence report — ${facts.apn}, ${facts.countyLabel} County, ${facts.state}`, {
    kind: DD_REPORT_CREDIT_KIND,
    parcelKey,
  });
  if (!debit) return { ok: false, reason: "insufficient_credits", message: "Not enough credits for this report. Add credits in Settings → Billing." };
  return { ok: true, charged: true, priceCents: price, report: buildReport(facts) };
}

/** Re-deliver a report the org already bought; null when it has not. */
export async function purchasedDdReport(orgId: number, parcelKey: string): Promise<DdReport | null> {
  if (!(await alreadyPurchased(orgId, parcelKey))) return null;
  const row = await findOwnedParcelByKey(parcelKey);
  return row ? buildReport(publicLandFactsOf(row)) : null;
}
