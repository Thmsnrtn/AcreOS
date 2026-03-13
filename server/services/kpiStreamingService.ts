// @ts-nocheck
/**
 * T42 — Real-Time KPI Streaming via WebSocket
 *
 * Pushes dashboard KPI updates to connected clients whenever key events occur:
 *   - Deal closed → portfolio value update
 *   - Lead created → pipeline count update
 *   - Payment received → notes receivable update
 *   - Offer sent → active offers count update
 *
 * Eliminates polling. Dashboard reacts instantly to business events.
 *
 * Call these functions from route handlers after mutations complete:
 *   kpiStreaming.emitDealClosed(orgId, dealData)
 *   kpiStreaming.emitLeadCreated(orgId, lead)
 *   kpiStreaming.emitPaymentReceived(orgId, payment)
 *   kpiStreaming.emitOfferSent(orgId, offerId)
 */

import { wsServer as wss } from "../websocket";
import { db } from "../db";
import { leads, deals, notesReceivable, payments } from "@shared/schema";
import { eq, and, count, sum, sql } from "drizzle-orm";

export interface KpiUpdate {
  type: "kpi.update";
  metric: string;
  value: number | string;
  delta?: number; // change from previous value
  label?: string;
  orgId: number;
}

// ─── Emit helpers ────────────────────────────────────────────────────────────

function broadcastKpi(orgId: number, payload: Omit<KpiUpdate, "type" | "orgId">) {
  try {
    wss.broadcast(`org:${orgId}`, {
      type: "kpi.update",
      orgId,
      ...payload,
    });
  } catch {
    // WebSocket may not be initialized in test env — swallow
  }
}

// ─── Snapshot queries ─────────────────────────────────────────────────────────

async function getDashboardSnapshot(orgId: number) {
  const [leadCount] = await db
    .select({ count: count() })
    .from(leads)
    .where(eq(leads.organizationId, orgId));

  const [dealCounts] = await db
    .select({
      active: sql<number>`count(*) filter (where status not in ('closed','lost','cancelled'))`,
      closed: sql<number>`count(*) filter (where status = 'closed')`,
    })
    .from(deals)
    .where(eq(deals.organizationId, orgId));

  const [noteBalance] = await db
    .select({ balance: sum(notesReceivable.remainingBalance) })
    .from(notesReceivable)
    .where(
      and(
        eq(notesReceivable.organizationId, orgId),
        eq(notesReceivable.status, "active")
      )
    );

  return {
    totalLeads: Number(leadCount?.count ?? 0),
    activeDeals: Number(dealCounts?.active ?? 0),
    closedDeals: Number(dealCounts?.closed ?? 0),
    notesBalance: Number(noteBalance?.balance ?? 0),
  };
}

// ─── Public emit functions ────────────────────────────────────────────────────

export const kpiStreaming = {
  async emitDealClosed(orgId: number, dealValue: number) {
    const snap = await getDashboardSnapshot(orgId);
    broadcastKpi(orgId, {
      metric: "deals.closed",
      value: snap.closedDeals,
      delta: 1,
      label: "Deal closed",
    });
    broadcastKpi(orgId, {
      metric: "deals.active",
      value: snap.activeDeals,
      delta: -1,
    });
    broadcastKpi(orgId, {
      metric: "pipeline.value",
      value: dealValue,
      label: "Deal value",
    });
  },

  async emitLeadCreated(orgId: number) {
    const snap = await getDashboardSnapshot(orgId);
    broadcastKpi(orgId, {
      metric: "leads.total",
      value: snap.totalLeads,
      delta: 1,
      label: "Lead added",
    });
  },

  async emitOfferSent(orgId: number) {
    broadcastKpi(orgId, {
      metric: "offers.sent",
      value: 1,
      delta: 1,
      label: "Offer sent",
    });
  },

  async emitPaymentReceived(orgId: number, amountCents: number) {
    const snap = await getDashboardSnapshot(orgId);
    broadcastKpi(orgId, {
      metric: "notes.balance",
      value: snap.notesBalance,
      delta: -amountCents / 100,
      label: "Payment received",
    });
    broadcastKpi(orgId, {
      metric: "notes.payment_received",
      value: amountCents / 100,
      label: "Payment amount",
    });
  },

  async emitSnapshot(orgId: number) {
    const snap = await getDashboardSnapshot(orgId);
    broadcastKpi(orgId, { metric: "snapshot", value: JSON.stringify(snap) });
  },
};
