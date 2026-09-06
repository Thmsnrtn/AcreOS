// Closing + servicing data layer (Phase 4 automation): buyer reservations,
// escrow checklists, closing packets, autopay enrollments, payoff quotes,
// the trust ledger (+ balance), and delinquency escalations. Extracted from
// the god-class server/storage.ts in the storage refactor. Methods are
// merged into DatabaseStorage.prototype at construction time; `this` refers
// to the full DatabaseStorage instance.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  buyerReservations,
  escrowChecklists,
  closingPackets,
  autopayEnrollments,
  payoffQuotes,
  delinquencyEscalations,
  type BuyerReservation,
  type EscrowChecklist,
  type ClosingPacket,
  type AutopayEnrollment,
  type PayoffQuote,
  type DelinquencyEscalation,
  type InsertBuyerReservation,
  type InsertEscrowChecklist,
  type InsertClosingPacket,
  type InsertAutopayEnrollment,
  type InsertPayoffQuote,
  type InsertDelinquencyEscalation,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { assertWritablePatch } from "../utils/patch";

export const closingServicingRepo = {
  // Buyer Reservations
  async getBuyerReservations(this: DatabaseStorage, organizationId: number): Promise<BuyerReservation[]> {
    return await db.select().from(buyerReservations)
      .where(eq(buyerReservations.organizationId, organizationId))
      .orderBy(desc(buyerReservations.createdAt));
  },

  async getBuyerReservationById(this: DatabaseStorage, organizationId: number, id: number): Promise<BuyerReservation | undefined> {
    const [reservation] = await db.select().from(buyerReservations)
      .where(and(eq(buyerReservations.id, id), eq(buyerReservations.organizationId, organizationId)));
    return reservation;
  },

  async getBuyerReservationsByProperty(this: DatabaseStorage, organizationId: number, propertyId: number): Promise<BuyerReservation[]> {
    return await db.select().from(buyerReservations)
      .where(and(eq(buyerReservations.propertyId, propertyId), eq(buyerReservations.organizationId, organizationId)))
      .orderBy(desc(buyerReservations.createdAt));
  },

  async createBuyerReservation(this: DatabaseStorage, data: InsertBuyerReservation): Promise<BuyerReservation> {
    const [created] = await db.insert(buyerReservations).values(data).returning();
    return created;
  },

  async updateBuyerReservation(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertBuyerReservation>): Promise<BuyerReservation | undefined> {
    const [updated] = await db.update(buyerReservations)
      .set(assertWritablePatch(data, "buyer_reservations.updateBuyerReservation"))
      .where(and(eq(buyerReservations.id, id), eq(buyerReservations.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteBuyerReservation(this: DatabaseStorage, organizationId: number, id: number): Promise<boolean> {
    const result = await db.delete(buyerReservations)
      .where(and(eq(buyerReservations.id, id), eq(buyerReservations.organizationId, organizationId)));
    return true;
  },

  // Escrow Checklists
  async getEscrowChecklists(this: DatabaseStorage, organizationId: number): Promise<EscrowChecklist[]> {
    return await db.select().from(escrowChecklists)
      .where(eq(escrowChecklists.organizationId, organizationId))
      .orderBy(desc(escrowChecklists.createdAt));
  },

  async getEscrowChecklistById(this: DatabaseStorage, organizationId: number, id: number): Promise<EscrowChecklist | undefined> {
    const [checklist] = await db.select().from(escrowChecklists)
      .where(and(eq(escrowChecklists.id, id), eq(escrowChecklists.organizationId, organizationId)));
    return checklist;
  },

  async getEscrowChecklistByDeal(this: DatabaseStorage, organizationId: number, dealId: number): Promise<EscrowChecklist | undefined> {
    const [checklist] = await db.select().from(escrowChecklists)
      .where(and(eq(escrowChecklists.dealId, dealId), eq(escrowChecklists.organizationId, organizationId)))
      .limit(1);
    return checklist;
  },

  async createEscrowChecklist(this: DatabaseStorage, data: InsertEscrowChecklist): Promise<EscrowChecklist> {
    const [created] = await db.insert(escrowChecklists).values(data).returning();
    return created;
  },

  async updateEscrowChecklist(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertEscrowChecklist>): Promise<EscrowChecklist | undefined> {
    const [updated] = await db.update(escrowChecklists)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(escrowChecklists.id, id), eq(escrowChecklists.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteEscrowChecklist(this: DatabaseStorage, organizationId: number, id: number): Promise<boolean> {
    await db.delete(escrowChecklists)
      .where(and(eq(escrowChecklists.id, id), eq(escrowChecklists.organizationId, organizationId)));
    return true;
  },

  // Closing Packets
  async getClosingPackets(this: DatabaseStorage, organizationId: number): Promise<ClosingPacket[]> {
    return await db.select().from(closingPackets)
      .where(eq(closingPackets.organizationId, organizationId))
      .orderBy(desc(closingPackets.createdAt));
  },

  async getClosingPacketById(this: DatabaseStorage, organizationId: number, id: number): Promise<ClosingPacket | undefined> {
    const [packet] = await db.select().from(closingPackets)
      .where(and(eq(closingPackets.id, id), eq(closingPackets.organizationId, organizationId)));
    return packet;
  },

  async getClosingPacketsByDeal(this: DatabaseStorage, organizationId: number, dealId: number): Promise<ClosingPacket[]> {
    return await db.select().from(closingPackets)
      .where(and(eq(closingPackets.dealId, dealId), eq(closingPackets.organizationId, organizationId)))
      .orderBy(desc(closingPackets.createdAt));
  },

  async createClosingPacket(this: DatabaseStorage, data: InsertClosingPacket): Promise<ClosingPacket> {
    const [created] = await db.insert(closingPackets).values(data).returning();
    return created;
  },

  async updateClosingPacket(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertClosingPacket>): Promise<ClosingPacket | undefined> {
    const [updated] = await db.update(closingPackets)
      .set(assertWritablePatch(data, "closing_packets.updateClosingPacket"))
      .where(and(eq(closingPackets.id, id), eq(closingPackets.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteClosingPacket(this: DatabaseStorage, organizationId: number, id: number): Promise<boolean> {
    await db.delete(closingPackets)
      .where(and(eq(closingPackets.id, id), eq(closingPackets.organizationId, organizationId)));
    return true;
  },

  // Autopay Enrollments
  async getAutopayEnrollments(this: DatabaseStorage, organizationId: number): Promise<AutopayEnrollment[]> {
    return await db.select().from(autopayEnrollments)
      .where(eq(autopayEnrollments.organizationId, organizationId))
      .orderBy(desc(autopayEnrollments.createdAt));
  },

  async getAutopayEnrollmentById(this: DatabaseStorage, organizationId: number, id: number): Promise<AutopayEnrollment | undefined> {
    const [enrollment] = await db.select().from(autopayEnrollments)
      .where(and(eq(autopayEnrollments.id, id), eq(autopayEnrollments.organizationId, organizationId)));
    return enrollment;
  },

  async getAutopayEnrollmentByNote(this: DatabaseStorage, organizationId: number, noteId: number): Promise<AutopayEnrollment | undefined> {
    const [enrollment] = await db.select().from(autopayEnrollments)
      .where(and(eq(autopayEnrollments.noteId, noteId), eq(autopayEnrollments.organizationId, organizationId)))
      .limit(1);
    return enrollment;
  },

  async getActiveAutopayEnrollments(this: DatabaseStorage, organizationId: number): Promise<AutopayEnrollment[]> {
    return await db.select().from(autopayEnrollments)
      .where(and(
        eq(autopayEnrollments.organizationId, organizationId),
        eq(autopayEnrollments.status, "active")
      ))
      .orderBy(desc(autopayEnrollments.createdAt));
  },

  async createAutopayEnrollment(this: DatabaseStorage, data: InsertAutopayEnrollment): Promise<AutopayEnrollment> {
    const [created] = await db.insert(autopayEnrollments).values(data).returning();
    return created;
  },

  async updateAutopayEnrollment(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertAutopayEnrollment>): Promise<AutopayEnrollment | undefined> {
    const [updated] = await db.update(autopayEnrollments)
      .set(assertWritablePatch(data, "autopay_enrollments.updateAutopayEnrollment"))
      .where(and(eq(autopayEnrollments.id, id), eq(autopayEnrollments.organizationId, organizationId)))
      .returning();
    return updated;
  },

  async deleteAutopayEnrollment(this: DatabaseStorage, organizationId: number, id: number): Promise<boolean> {
    await db.delete(autopayEnrollments)
      .where(and(eq(autopayEnrollments.id, id), eq(autopayEnrollments.organizationId, organizationId)));
    return true;
  },

  // Payoff Quotes
  async getPayoffQuotes(this: DatabaseStorage, organizationId: number): Promise<PayoffQuote[]> {
    return await db.select().from(payoffQuotes)
      .where(eq(payoffQuotes.organizationId, organizationId))
      .orderBy(desc(payoffQuotes.createdAt));
  },

  async getPayoffQuoteById(this: DatabaseStorage, organizationId: number, id: number): Promise<PayoffQuote | undefined> {
    const [quote] = await db.select().from(payoffQuotes)
      .where(and(eq(payoffQuotes.id, id), eq(payoffQuotes.organizationId, organizationId)));
    return quote;
  },

  async getPayoffQuotesByNote(this: DatabaseStorage, organizationId: number, noteId: number): Promise<PayoffQuote[]> {
    return await db.select().from(payoffQuotes)
      .where(and(eq(payoffQuotes.noteId, noteId), eq(payoffQuotes.organizationId, organizationId)))
      .orderBy(desc(payoffQuotes.createdAt));
  },

  async createPayoffQuote(this: DatabaseStorage, data: InsertPayoffQuote): Promise<PayoffQuote> {
    const [created] = await db.insert(payoffQuotes).values(data).returning();
    return created;
  },

  async updatePayoffQuote(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertPayoffQuote>): Promise<PayoffQuote | undefined> {
    const [updated] = await db.update(payoffQuotes)
      .set(assertWritablePatch(data, "payoff_quotes.updatePayoffQuote"))
      .where(and(eq(payoffQuotes.id, id), eq(payoffQuotes.organizationId, organizationId)))
      .returning();
    return updated;
  },

  // Delinquency Escalations
  async getDelinquencyEscalations(this: DatabaseStorage, organizationId: number): Promise<DelinquencyEscalation[]> {
    return await db.select().from(delinquencyEscalations)
      .where(eq(delinquencyEscalations.organizationId, organizationId))
      .orderBy(desc(delinquencyEscalations.createdAt));
  },

  async getDelinquencyEscalationById(this: DatabaseStorage, organizationId: number, id: number): Promise<DelinquencyEscalation | undefined> {
    const [escalation] = await db.select().from(delinquencyEscalations)
      .where(and(eq(delinquencyEscalations.id, id), eq(delinquencyEscalations.organizationId, organizationId)));
    return escalation;
  },

  async getDelinquencyEscalationByNote(this: DatabaseStorage, organizationId: number, noteId: number): Promise<DelinquencyEscalation | undefined> {
    const [escalation] = await db.select().from(delinquencyEscalations)
      .where(and(eq(delinquencyEscalations.noteId, noteId), eq(delinquencyEscalations.organizationId, organizationId)))
      .limit(1);
    return escalation;
  },

  async getActiveDelinquencyEscalations(this: DatabaseStorage, organizationId: number): Promise<DelinquencyEscalation[]> {
    return await db.select().from(delinquencyEscalations)
      .where(and(
        eq(delinquencyEscalations.organizationId, organizationId),
        eq(delinquencyEscalations.status, "active")
      ))
      .orderBy(desc(delinquencyEscalations.createdAt));
  },

  async createDelinquencyEscalation(this: DatabaseStorage, data: InsertDelinquencyEscalation): Promise<DelinquencyEscalation> {
    const [created] = await db.insert(delinquencyEscalations).values(data).returning();
    return created;
  },

  async updateDelinquencyEscalation(this: DatabaseStorage, organizationId: number, id: number, data: Partial<InsertDelinquencyEscalation>): Promise<DelinquencyEscalation | undefined> {
    const [updated] = await db.update(delinquencyEscalations)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(delinquencyEscalations.id, id), eq(delinquencyEscalations.organizationId, organizationId)))
      .returning();
    return updated;
  },
};

export type ClosingServicingRepo = typeof closingServicingRepo;
