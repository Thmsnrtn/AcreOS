// @ts-nocheck
/**
 * T34 — Automated Offer Batch Service
 *
 * Full pipeline:
 *   1. Accept parcel list (array of APNs / lead IDs with overrides)
 *   2. Apply pricing matrix (based on size, location, zoning, tax status)
 *   3. Generate per-parcel offer amounts
 *   4. Queue PDF generation for each offer letter
 *   5. Queue mail/email sends via campaign system
 *
 * Uses BullMQ job queue for async processing.
 * Progress tracked in offerBatches table.
 */

import { db } from "../db";
import {
  offerBatches,
  offers,
  leads,
  properties,
  type OfferBatch,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { jobQueueService } from "./jobQueue";

// ─── Pricing Matrix ──────────────────────────────────────────────────────────

export interface PricingMatrixRule {
  minAcres?: number;
  maxAcres?: number;
  zoning?: string; // regex match against zoning code
  state?: string;
  county?: string;
  taxDelinquent?: boolean;
  pricePerAcre: number;
  discountPct?: number; // additional % off comparable value
  maxOffer?: number;
}

export interface BatchParcel {
  leadId?: number;
  propertyId?: number;
  apn: string;
  state?: string;
  county?: string;
  acreage?: number;
  zoning?: string;
  taxDelinquent?: boolean;
  estimatedValue?: number; // AVM value if available
  priceOverride?: number; // skip matrix for this parcel
}

export interface BatchConfig {
  orgId: number;
  userId: number;
  name: string;
  pricingMatrix: PricingMatrixRule[];
  defaultPricePerAcre?: number;
  defaultDiscountPct?: number; // % of AVM value
  earnestMoneyDeposit?: number;
  closingDays?: number;
  contingencies?: string[];
  sendViaEmail?: boolean;
  sendViaMail?: boolean;
  sellerFinancing?: {
    enabled: boolean;
    downPaymentPct: number;
    interestRate: number;
    termMonths: number;
  };
  expirationDays?: number;
}

export interface BatchResult {
  batchId: number;
  totalParcels: number;
  queued: number;
  skipped: number;
  estimatedTotal: number; // sum of all offer amounts
  jobId: string;
}

// ─── Pricing Logic ───────────────────────────────────────────────────────────

function computeOfferAmount(parcel: BatchParcel, config: BatchConfig): number | null {
  // Manual override
  if (parcel.priceOverride != null) return parcel.priceOverride;

  // Find matching matrix rule (first match wins)
  for (const rule of config.pricingMatrix) {
    const matchesAcres =
      (rule.minAcres == null || (parcel.acreage ?? 0) >= rule.minAcres) &&
      (rule.maxAcres == null || (parcel.acreage ?? 0) <= rule.maxAcres);
    const matchesZoning =
      !rule.zoning || new RegExp(rule.zoning, "i").test(parcel.zoning ?? "");
    const matchesState = !rule.state || rule.state.toUpperCase() === (parcel.state ?? "").toUpperCase();
    const matchesCounty = !rule.county || rule.county.toLowerCase() === (parcel.county ?? "").toLowerCase();
    const matchesTax = rule.taxDelinquent == null || rule.taxDelinquent === parcel.taxDelinquent;

    if (matchesAcres && matchesZoning && matchesState && matchesCounty && matchesTax) {
      const acreage = parcel.acreage ?? 1;
      let offer: number;

      if (parcel.estimatedValue && rule.discountPct != null) {
        offer = parcel.estimatedValue * (1 - rule.discountPct / 100);
      } else {
        offer = rule.pricePerAcre * acreage;
      }

      if (rule.maxOffer != null) offer = Math.min(offer, rule.maxOffer);
      return Math.round(offer / 100) * 100; // round to nearest $100
    }
  }

  // Default fallback
  const defaultDiscount = config.defaultDiscountPct ?? 60;
  const defaultPpa = config.defaultPricePerAcre;
  const acreage = parcel.acreage ?? 1;

  if (parcel.estimatedValue) {
    return Math.round((parcel.estimatedValue * (1 - defaultDiscount / 100)) / 100) * 100;
  }
  if (defaultPpa) {
    return Math.round((defaultPpa * acreage) / 100) * 100;
  }

  return null; // cannot price — skip
}

// ─── Batch Processing ────────────────────────────────────────────────────────

export async function createOfferBatch(
  parcels: BatchParcel[],
  config: BatchConfig
): Promise<BatchResult> {
  // Create the batch record
  const [batch] = await db
    .insert(offerBatches)
    .values({
      organizationId: config.orgId,
      createdBy: config.userId,
      name: config.name,
      status: "pending",
      totalOffers: parcels.length,
      sentOffers: 0,
      metadata: { config } as any,
    })
    .returning({ id: offerBatches.id });

  const batchId = batch.id;

  // Compute offer amounts and create offer records
  const offerRows: typeof offers.$inferInsert[] = [];
  let skipped = 0;
  let estimatedTotal = 0;

  for (const parcel of parcels) {
    const amount = computeOfferAmount(parcel, config);
    if (amount == null || amount <= 0) {
      skipped++;
      continue;
    }

    estimatedTotal += amount;

    // Compute seller financing monthly payment if applicable
    let sfMonthlyPayment: number | null = null;
    if (config.sellerFinancing?.enabled && amount > 0) {
      const sf = config.sellerFinancing;
      const dp = amount * (sf.downPaymentPct / 100);
      const principal = amount - dp;
      const monthlyRate = sf.interestRate / 100 / 12;
      const n = sf.termMonths;
      sfMonthlyPayment =
        monthlyRate === 0
          ? principal / n
          : (principal * monthlyRate * Math.pow(1 + monthlyRate, n)) /
            (Math.pow(1 + monthlyRate, n) - 1);
    }

    offerRows.push({
      organizationId: config.orgId,
      batchId,
      leadId: parcel.leadId,
      propertyId: parcel.propertyId,
      apn: parcel.apn,
      offerAmount: amount.toString(),
      earnestMoneyDeposit: config.earnestMoneyDeposit?.toString(),
      closingDays: config.closingDays ?? 30,
      status: "draft",
      expirationDays: config.expirationDays ?? 10,
      sellerFinancing: config.sellerFinancing?.enabled
        ? {
            downPaymentPct: config.sellerFinancing.downPaymentPct,
            interestRate: config.sellerFinancing.interestRate,
            termMonths: config.sellerFinancing.termMonths,
            monthlyPayment: sfMonthlyPayment,
          }
        : null,
      metadata: { acreage: parcel.acreage, state: parcel.state, county: parcel.county } as any,
    });
  }

  if (offerRows.length > 0) {
    await db.insert(offers).values(offerRows);
  }

  // Queue the async processing job
  const jobId = await jobQueueService.add(
    "process-offer-batch",
    {
      batchId,
      orgId: config.orgId,
      sendViaEmail: config.sendViaEmail ?? false,
      sendViaMail: config.sendViaMail ?? false,
    },
    { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
  );

  // Update batch status to queued
  await db
    .update(offerBatches)
    .set({ status: "processing", sentOffers: 0 })
    .where(eq(offerBatches.id, batchId));

  return {
    batchId,
    totalParcels: parcels.length,
    queued: offerRows.length,
    skipped,
    estimatedTotal,
    jobId: String(jobId),
  };
}

export async function getBatchStatus(batchId: number, orgId: number) {
  const [batch] = await db
    .select()
    .from(offerBatches)
    .where(and(eq(offerBatches.id, batchId), eq(offerBatches.organizationId, orgId)));

  if (!batch) return null;

  const batchOffers = await db
    .select({
      id: offers.id,
      apn: offers.apn,
      offerAmount: offers.offerAmount,
      status: offers.status,
    })
    .from(offers)
    .where(eq(offers.batchId, batchId));

  return {
    ...batch,
    offers: batchOffers,
    sentCount: batchOffers.filter(o => o.status === "sent").length,
    draftCount: batchOffers.filter(o => o.status === "draft").length,
  };
}
