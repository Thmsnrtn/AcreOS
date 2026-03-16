import { db } from "../db";
import { notes, payments, properties, parcelSnapshots, systemAlerts } from "@shared/schema";
import { eq, and, desc, gte, lt } from "drizzle-orm";

export interface LTVSnapshot {
  noteId: number;
  propertyId: number | null;
  currentBalance: number;
  estimatedPropertyValue: number;
  ltv: number;           // 0-100+ %
  ltvChange30d: number;  // percentage points change in 30 days
  riskLevel: "low" | "medium" | "high" | "critical";
  alerts: string[];
}

export class LTVMonitorService {

  // Calculate current outstanding balance for a note
  async calculateCurrentBalance(noteId: number): Promise<number> {
    // Get note terms
    const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
    if (!note) return 0;

    // Get all confirmed payments (status "completed" in this schema)
    const confirmedPayments = await db.select().from(payments)
      .where(and(eq(payments.noteId, noteId), eq(payments.status, "completed")));

    // Simple balance calculation: original balance - total principal paid
    const originalBalance = Number(note.originalPrincipal || 0);
    const annualRate = Number(note.interestRate || 0) / 100;
    const monthlyRate = annualRate / 12;
    const monthlyPayment = Number(note.monthlyPayment || 0);

    let balance = originalBalance;
    // Apply each payment's principal portion using standard amortization
    for (const payment of confirmedPayments.sort((a, b) =>
      new Date(a.paymentDate || a.dueDate || 0).getTime() - new Date(b.paymentDate || b.dueDate || 0).getTime()
    )) {
      const interest = balance * monthlyRate;
      const principal = Math.max(0, monthlyPayment - interest);
      balance = Math.max(0, balance - principal);
    }

    return balance;
  }

  // Estimate property value using most recent parcel snapshot or purchase price
  async estimatePropertyValue(propertyId: number): Promise<number> {
    // Get the property record to look up its APN/state/county for snapshot matching
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId));
    if (!property) return 0;

    // Try parcel snapshot via APN + state + county
    if (property.apn && property.state && property.county) {
      const [snapshot] = await db.select().from(parcelSnapshots)
        .where(
          and(
            eq(parcelSnapshots.apn, property.apn),
            eq(parcelSnapshots.state, property.state),
            eq(parcelSnapshots.county, property.county)
          )
        )
        .orderBy(desc(parcelSnapshots.createdAt))
        .limit(1);

      if (snapshot?.assessedValue) {
        // Assessed value is typically 80-90% of market; inflate by 15%
        return Number(snapshot.assessedValue) * 1.15;
      }
    }

    // Fall back to property's market value, assessed value, or list price
    return Number(property.marketValue || property.assessedValue || property.listPrice || property.purchasePrice || 0);
  }

  // Get LTV snapshot for a single note
  async getLTVSnapshot(noteId: number): Promise<LTVSnapshot | null> {
    const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
    if (!note) return null;

    const balance = await this.calculateCurrentBalance(noteId);
    const propertyId = note.propertyId || null;
    const propertyValue = propertyId ? await this.estimatePropertyValue(propertyId) : 0;

    const ltv = propertyValue > 0 ? (balance / propertyValue) * 100 : 0;

    const alerts: string[] = [];
    let riskLevel: LTVSnapshot["riskLevel"] = "low";

    if (ltv > 90) { riskLevel = "critical"; alerts.push("LTV exceeds 90% — severely undercollateralized"); }
    else if (ltv > 80) { riskLevel = "high"; alerts.push("LTV exceeds 80% — limited equity cushion"); }
    else if (ltv > 70) { riskLevel = "medium"; alerts.push("LTV above 70% — monitor closely"); }

    if (propertyValue === 0) alerts.push("Property value unknown — manual appraisal recommended");
    if (balance === 0 && Number(note.originalPrincipal) > 0) alerts.push("Balance calculation may be inaccurate — check payment records");

    return { noteId, propertyId, currentBalance: balance, estimatedPropertyValue: propertyValue, ltv, ltvChange30d: 0, riskLevel, alerts };
  }

  // Get LTV snapshots for all notes in an org
  async getOrgLTVReport(orgId: number): Promise<{
    snapshots: LTVSnapshot[];
    summary: { avgLTV: number; criticalCount: number; highCount: number; totalExposure: number };
  }> {
    const orgNotes = await db.select().from(notes).where(eq(notes.organizationId, orgId));

    const snapshots = await Promise.all(
      orgNotes.map(n => this.getLTVSnapshot(n.id))
    );

    const valid = snapshots.filter(Boolean) as LTVSnapshot[];

    const summary = {
      avgLTV: valid.length ? valid.reduce((s, v) => s + v.ltv, 0) / valid.length : 0,
      criticalCount: valid.filter(v => v.riskLevel === "critical").length,
      highCount: valid.filter(v => v.riskLevel === "high").length,
      totalExposure: valid.filter(v => v.riskLevel !== "low").reduce((s, v) => s + v.currentBalance, 0),
    };

    return { snapshots: valid, summary };
  }
}

export const ltvMonitorService = new LTVMonitorService();
