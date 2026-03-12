/**
 * 1031 Exchange Tracker
 *
 * Section 1031 of the IRC allows deferral of capital gains on real estate sales
 * if the proceeds are reinvested in "like-kind" property within specific deadlines:
 *   - 45 days:  Identify replacement property candidate(s) — hard deadline
 *   - 180 days: Close on replacement property — hard deadline
 *
 * This service tracks active exchanges, sends deadline alerts, and generates
 * the identification letter template for the qualified intermediary.
 */

import { db } from "../db";
import { deals, properties, organizations, activityLog } from "@shared/schema";
import { eq, and, gte, lte, isNull, ne } from "drizzle-orm";
import { addDays, differenceInDays, format, isPast, isBefore, addHours } from "date-fns";

export interface Exchange1031 {
  id?: number;
  organizationId: number;
  dealId: number;
  relinquishedPropertyAddress: string;
  saleCloseDate: Date;
  salePrice: number;
  capitalGainEstimate: number;
  // Deadlines
  identificationDeadline: Date;   // 45 days from close
  exchangeDeadline: Date;          // 180 days from close
  // Status
  status: 'active' | 'identified' | 'completed' | 'failed' | 'cancelled';
  qualifiedIntermediaryName?: string;
  qualifiedIntermediaryEmail?: string;
  // Replacement property candidates (up to 3 via 3-property rule OR 200% rule)
  replacementCandidates: ReplacementCandidate[];
  completedWithPropertyId?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ReplacementCandidate {
  address: string;
  apn?: string;
  identifiedDate?: Date;
  targetPrice?: number;
  status: 'identified' | 'under_contract' | 'closed' | 'dropped';
  notes?: string;
}

export interface Exchange1031Alert {
  exchangeId: number;
  type: 'approaching_id_deadline' | 'approaching_exchange_deadline' | 'id_deadline_passed' | 'exchange_deadline_passed' | 'no_candidates_identified';
  urgency: 'info' | 'warning' | 'critical';
  message: string;
  daysRemaining: number;
  dealId: number;
  propertyAddress: string;
}

// In-memory store keyed by orgId → exchanges (in production, add a DB table)
// For now, we store exchange data in the activityLog as structured metadata
// and derive exchange state from deal records.

/**
 * Calculate 1031 exchange deadlines from sale close date.
 */
export function calculateDeadlines(saleCloseDate: Date): {
  identificationDeadline: Date;
  exchangeDeadline: Date;
} {
  return {
    identificationDeadline: addDays(saleCloseDate, 45),
    exchangeDeadline: addDays(saleCloseDate, 180),
  };
}

/**
 * Estimate capital gains on a sale (simplified — before depreciation recapture).
 * costBasis = acquisition price + improvement costs
 * gainEstimate = salePrice - costBasis
 * taxEstimate = gain * 0.15 (federal LTCG rate for most taxpayers)
 */
export function estimateCapitalGains(
  salePrice: number,
  costBasis: number,
  holdingMonths: number
): {
  capitalGain: number;
  isLongTerm: boolean;
  estimatedFederalTax: number;
  deferredIfExchange: number;
} {
  const capitalGain = Math.max(0, salePrice - costBasis);
  const isLongTerm = holdingMonths >= 12;
  const taxRate = isLongTerm ? 0.15 : 0.22;
  const estimatedFederalTax = capitalGain * taxRate;
  return {
    capitalGain,
    isLongTerm,
    estimatedFederalTax,
    deferredIfExchange: estimatedFederalTax,
  };
}

/**
 * Check an active exchange for upcoming deadlines.
 * Returns alerts sorted by urgency.
 */
export function getExchangeAlerts(exchange: Exchange1031): Exchange1031Alert[] {
  const alerts: Exchange1031Alert[] = [];
  const now = new Date();

  if (exchange.status === 'completed' || exchange.status === 'failed' || exchange.status === 'cancelled') {
    return alerts;
  }

  const idDaysLeft = differenceInDays(exchange.identificationDeadline, now);
  const exchangeDaysLeft = differenceInDays(exchange.exchangeDeadline, now);

  // Identification deadline alerts
  if (idDaysLeft < 0 && exchange.status === 'active') {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'id_deadline_passed',
      urgency: 'critical',
      message: `CRITICAL: 45-day identification deadline passed ${Math.abs(idDaysLeft)} days ago. Exchange may be invalid.`,
      daysRemaining: idDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  } else if (idDaysLeft <= 7) {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'approaching_id_deadline',
      urgency: 'critical',
      message: `URGENT: Only ${idDaysLeft} days to identify replacement property for 1031 exchange!`,
      daysRemaining: idDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  } else if (idDaysLeft <= 15) {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'approaching_id_deadline',
      urgency: 'warning',
      message: `${idDaysLeft} days remaining to identify replacement property (45-day rule)`,
      daysRemaining: idDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  }

  // Exchange completion deadline alerts
  if (exchangeDaysLeft < 0) {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'exchange_deadline_passed',
      urgency: 'critical',
      message: `180-day exchange deadline passed ${Math.abs(exchangeDaysLeft)} days ago. Gains are taxable.`,
      daysRemaining: exchangeDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  } else if (exchangeDaysLeft <= 14) {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'approaching_exchange_deadline',
      urgency: 'critical',
      message: `URGENT: Only ${exchangeDaysLeft} days to close on replacement property!`,
      daysRemaining: exchangeDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  } else if (exchangeDaysLeft <= 30) {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'approaching_exchange_deadline',
      urgency: 'warning',
      message: `${exchangeDaysLeft} days to close on replacement property (180-day rule)`,
      daysRemaining: exchangeDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  }

  // No candidates identified yet
  if (exchange.replacementCandidates.length === 0 && idDaysLeft > 0 && idDaysLeft <= 30) {
    alerts.push({
      exchangeId: exchange.id || 0,
      type: 'no_candidates_identified',
      urgency: 'warning',
      message: `No replacement properties identified yet. ${idDaysLeft} days remaining.`,
      daysRemaining: idDaysLeft,
      dealId: exchange.dealId,
      propertyAddress: exchange.relinquishedPropertyAddress,
    });
  }

  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.urgency] - order[b.urgency];
  });
}

/**
 * Generate an IRS-compliant identification letter for the qualified intermediary.
 * The letter must be sent within 45 days identifying up to 3 replacement properties.
 */
export function generateIdentificationLetter(
  exchange: Exchange1031,
  orgName: string
): string {
  const identificationDate = format(new Date(), 'MMMM d, yyyy');
  const deadline = format(exchange.identificationDeadline, 'MMMM d, yyyy');
  const closeDate = format(exchange.saleCloseDate, 'MMMM d, yyyy');

  const candidateLines = exchange.replacementCandidates
    .map((c, i) => `  ${i + 1}. ${c.address}${c.apn ? ` (APN: ${c.apn})` : ''}`)
    .join('\n');

  return `
SECTION 1031 LIKE-KIND EXCHANGE — REPLACEMENT PROPERTY IDENTIFICATION NOTICE

Date: ${identificationDate}
Identification Deadline: ${deadline}

To: ${exchange.qualifiedIntermediaryName || '[QUALIFIED INTERMEDIARY NAME]'}
     ${exchange.qualifiedIntermediaryEmail || '[QI EMAIL ADDRESS]'}

From: ${orgName}

Re: Identification of Replacement Property
    Relinquished Property: ${exchange.relinquishedPropertyAddress}
    Sale Close Date: ${closeDate}
    Sale Price: $${exchange.salePrice.toLocaleString()}

This letter serves as formal notification of the Taxpayer's identification of potential
replacement properties in connection with the above-referenced Section 1031 Like-Kind
Exchange, pursuant to Treasury Regulation § 1.1031(k)-1(c).

IDENTIFIED REPLACEMENT PROPERTIES (3-Property Rule):

${candidateLines || '  [NO PROPERTIES IDENTIFIED YET — ADD BEFORE DEADLINE]'}

The Taxpayer reserves the right to close on any or all of the above-identified properties
within the 180-day Exchange Period ending ${format(exchange.exchangeDeadline, 'MMMM d, yyyy')}.

This identification is made in accordance with Section 1031 of the Internal Revenue Code
and the applicable Treasury Regulations.

_________________________
Authorized Signature
${orgName}
Date: ${identificationDate}

IMPORTANT: This is a template. Review with a qualified tax attorney or CPA before use.
A 1031 exchange must be properly structured with a Qualified Intermediary to be valid.
`;
}
