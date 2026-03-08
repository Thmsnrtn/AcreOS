/**
 * Portfolio Health Service
 *
 * Proactively scans the portfolio for data quality and health issues:
 * - Notes past maturity date
 * - Stale leads (no activity > 90 days)
 * - Deals stuck in same stage > 45 days
 * - Properties with no AVM > 90 days
 *
 * Results are written to the system_alerts table and exposed via
 * GET /api/alerts/active and DELETE /api/alerts/:id/dismiss
 */

import { db } from '../db';
import {
  systemAlerts,
  notes,
  leads,
  deals,
  properties,
} from '../../shared/schema';
import { eq, and, lt, isNull, ne, lte } from 'drizzle-orm';

const STALE_LEAD_DAYS = 90;
const STUCK_DEAL_DAYS = 45;
const STALE_AVM_DAYS = 90;

export async function runPortfolioHealthJob(orgId: number): Promise<void> {
  const now = new Date();
  const alertsToInsert: Array<typeof systemAlerts.$inferInsert> = [];

  // Helper to check if an existing undismissed alert of this type already exists
  const existingAlertTypes = new Set<string>();
  const existing = await db
    .select({ type: systemAlerts.type })
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.organizationId, orgId),
        ne(systemAlerts.status, 'dismissed'),
        ne(systemAlerts.status, 'resolved'),
      )
    );
  for (const row of existing) existingAlertTypes.add(row.type);

  // ── 1. Notes past maturity ──────────────────────────────────────────────
  const overdueNotes = await db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        eq(notes.organizationId, orgId),
        eq(notes.status, 'active'),
        lt(notes.maturityDate, now),
      )
    );

  if (overdueNotes.length > 0 && !existingAlertTypes.has('note_overdue')) {
    alertsToInsert.push({
      type: 'note_overdue',
      alertType: 'revenue_at_risk',
      severity: 'critical',
      title: `${overdueNotes.length} Note${overdueNotes.length > 1 ? 's' : ''} Past Maturity`,
      message: `${overdueNotes.length} active note${overdueNotes.length > 1 ? 's are' : ' is'} past their maturity date. Contact borrowers to discuss payoff, extension, or modification.`,
      organizationId: orgId,
      relatedEntityType: 'note',
      status: 'new',
      metadata: { noteIds: overdueNotes.map(n => n.id) },
    });
  }

  // ── 2. Stale leads (no activity > 90 days) ─────────────────────────────
  const staleThreshold = new Date(now.getTime() - STALE_LEAD_DAYS * 24 * 60 * 60 * 1000);
  const staleLeads = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        ne(leads.status, 'converted'),
        ne(leads.status, 'dead'),
        lt(leads.updatedAt, staleThreshold),
      )
    );

  if (staleLeads.length > 0 && !existingAlertTypes.has('stale_leads')) {
    alertsToInsert.push({
      type: 'stale_leads',
      alertType: 'high_churn',
      severity: 'warning',
      title: `${staleLeads.length} Lead${staleLeads.length > 1 ? 's' : ''} With No Activity`,
      message: `${staleLeads.length} lead${staleLeads.length > 1 ? 's have' : ' has'} had no activity in ${STALE_LEAD_DAYS}+ days. Re-engage or mark as inactive to keep your pipeline accurate.`,
      organizationId: orgId,
      relatedEntityType: 'lead',
      status: 'new',
      metadata: { leadIds: staleLeads.map(l => l.id) },
    });
  }

  // ── 3. Deals stuck in same stage > 45 days ─────────────────────────────
  const stuckDealThreshold = new Date(now.getTime() - STUCK_DEAL_DAYS * 24 * 60 * 60 * 1000);
  const stuckDeals = await db
    .select({ id: deals.id, status: deals.status })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        ne(deals.status, 'closed'),
        ne(deals.status, 'cancelled'),
        lt(deals.updatedAt, stuckDealThreshold),
      )
    );

  if (stuckDeals.length > 0 && !existingAlertTypes.has('stuck_deals')) {
    alertsToInsert.push({
      type: 'stuck_deals',
      alertType: 'revenue_at_risk',
      severity: 'warning',
      title: `${stuckDeals.length} Deal${stuckDeals.length > 1 ? 's' : ''} Stuck in Pipeline`,
      message: `${stuckDeals.length} deal${stuckDeals.length > 1 ? 's have' : ' has'} not progressed in ${STUCK_DEAL_DAYS}+ days. Review and update or close stale deals.`,
      organizationId: orgId,
      relatedEntityType: 'deal',
      status: 'new',
      metadata: { dealIds: stuckDeals.map(d => d.id) },
    });
  }

  // ── 4. Properties with no AVM update > 90 days ─────────────────────────
  const staleAvmThreshold = new Date(now.getTime() - STALE_AVM_DAYS * 24 * 60 * 60 * 1000);
  const staleProperties = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        ne(properties.status, 'sold'),
        lt(properties.updatedAt, staleAvmThreshold),
      )
    );

  if (staleProperties.length > 0 && !existingAlertTypes.has('stale_avm')) {
    alertsToInsert.push({
      type: 'stale_avm',
      alertType: 'system_error',
      severity: 'info',
      title: `${staleProperties.length} Propert${staleProperties.length > 1 ? 'ies Need' : 'y Needs'} AVM Refresh`,
      message: `${staleProperties.length} propert${staleProperties.length > 1 ? 'ies have' : 'y has'} not been updated in ${STALE_AVM_DAYS}+ days. Refresh valuations to keep your portfolio data current.`,
      organizationId: orgId,
      relatedEntityType: 'property',
      status: 'new',
      metadata: { propertyIds: staleProperties.map(p => p.id) },
    });
  }

  // Batch insert new alerts
  if (alertsToInsert.length > 0) {
    await db.insert(systemAlerts).values(alertsToInsert);
  }
}

export async function getActiveAlerts(orgId: number) {
  return db
    .select()
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.organizationId, orgId),
        ne(systemAlerts.status, 'dismissed'),
        ne(systemAlerts.status, 'resolved'),
      )
    )
    .orderBy(systemAlerts.createdAt);
}

export async function dismissAlert(orgId: number, alertId: number): Promise<void> {
  await db
    .update(systemAlerts)
    .set({ status: 'dismissed' })
    .where(
      and(
        eq(systemAlerts.id, alertId),
        eq(systemAlerts.organizationId, orgId),
      )
    );
}
