// ============================================================================
// SHARED/SCHEMA/PAX-CORE.TS
// ----------------------------------------------------------------------------
// 0302 — E2 slice 1 (Pax core), legs 1, 3 and 5: the business memory, prepared
// work (packets), the rails and the trust ledger.
//
// Every table here is ORG-scoped; organization_id is server-pinned (never a
// model-supplied argument) and leads every index.
//
//   pax_business_memory  what the user has told Pax about their business —
//                        buy box, portfolio, counterparties, documents,
//                        outcomes, style. Written ONLY by the user (create /
//                        edit / delete in the panel) or by the user approving
//                        a Pax memory proposal. Pax never writes it silently.
//                        (Distinct from pax_memory: that is the support
//                        agent's per-user interaction log — issue history,
//                        solutions tried — and stays as it is.)
//   pax_packets          a reviewable artifact Pax prepared: title, the
//                        objects it concerns, sections with per-section
//                        provenance, and a lifecycle prepared → approved |
//                        dismissed. Approving executes nothing by itself.
//   pax_rails            what Pax may prepare WITHOUT being asked, as data:
//                        a fixed scope key the server enforces, the sentence
//                        shown to the user (editable, shown verbatim), and
//                        whether it is in force. A rail can never authorize
//                        execution — that stays the approval kernel's.
//   pax_trust_ledger     append-only: packets prepared / approved / dismissed,
//                        shadow entries, memory edits, rail edits, preset and
//                        shadow-mode changes. The preset and shadow mode are
//                        READ from it (latest event wins; none = the D2
//                        default), so the ledger is the one record they come
//                        from. Pause / resume / controls changes are already
//                        receipted in activity_log and are merged into the
//                        timeline from there, not copied.
//
// Mirrors migrations/0302_pax_core.sql + scripts/migrate.mjs.
// ============================================================================

import { pgTable, serial, integer, text, jsonb, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "../schema";

import { PAX_MEMORY_CATEGORIES, type PaxMemoryCategory } from "../pax-core";
export { PAX_MEMORY_CATEGORIES, type PaxMemoryCategory };

export const paxBusinessMemory = pgTable("pax_business_memory", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  category: text("category").$type<PaxMemoryCategory>().notNull(),
  content: text("content").notNull(),
  // "user" — typed in the panel; "pax-proposed" — a proposal the user approved.
  source: text("source").$type<"user" | "pax-proposed">().notNull(),
  // The approved proposal it came from, when source = pax-proposed.
  packetId: integer("packet_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgIdx: index("pax_business_memory_org_idx").on(table.organizationId, table.updatedAt),
}));
export type PaxBusinessMemoryItem = typeof paxBusinessMemory.$inferSelect;

/** One section of a packet. A section without provenance is a bug. */
export interface PaxPacketSection {
  heading: string;
  body: string;
  /** Where the content came from, in words ("Your Pax conversation"). */
  source: string;
  /** When that source was read (ISO). */
  asOf: string;
}

/** What a packet concerns — rendered as chips; links when href is set. */
export interface PaxPacketConcern {
  type: string;
  id: string | number | null;
  label: string;
  href?: string;
}

/**
 * The packet kinds that exist in slice 1. A kind is added here only together
 * with its approval semantics in server/services/paxCore.ts — never a kind
 * without one. (A send-type kind would approve by freezing through the
 * approval kernel; slice 1 has no producer for one, so it does not exist.)
 */
export type PaxPacketKind = "memory_proposal";

export interface PaxPacketPayload {
  memory_proposal: { category: PaxMemoryCategory; content: string };
}

export const paxPackets = pgTable("pax_packets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").$type<PaxPacketKind>().notNull(),
  title: text("title").notNull(),
  concerns: jsonb("concerns").$type<PaxPacketConcern[]>().notNull(),
  sections: jsonb("sections").$type<PaxPacketSection[]>().notNull(),
  payload: jsonb("payload").$type<PaxPacketPayload[PaxPacketKind]>().notNull(),
  // The rail that allowed preparing it.
  railKey: text("rail_key").notNull(),
  status: text("status").$type<"prepared" | "approved" | "dismissed">().notNull().default("prepared"),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgStatusIdx: index("pax_packets_org_status_idx").on(table.organizationId, table.status, table.createdAt),
}));
export type PaxPacket = typeof paxPackets.$inferSelect;

export const paxRails = pgTable("pax_rails", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  // The scope the server enforces (PAX_RAIL_SCOPES in shared/pax-core.ts).
  railKey: text("rail_key").notNull(),
  // The sentence the user sees — theirs to edit, shown verbatim.
  text: text("text").notNull(),
  active: boolean("active").notNull().default(true),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  orgKeyIdx: uniqueIndex("pax_rails_org_key_idx").on(table.organizationId, table.railKey),
}));
export type PaxRail = typeof paxRails.$inferSelect;

export const paxTrustLedger = pgTable("pax_trust_ledger", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  // PaxLedgerEvent in shared/pax-core.ts.
  event: text("event").notNull(),
  // "pax", or the user id who acted.
  actor: text("actor").notNull(),
  subjectType: text("subject_type"),
  subjectId: integer("subject_id"),
  // True for shadow entries: work Pax WOULD have prepared, never surfaced.
  shadow: boolean("shadow").notNull().default(false),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgCreatedIdx: index("pax_trust_ledger_org_created_idx").on(table.organizationId, table.createdAt),
  orgEventIdx: index("pax_trust_ledger_org_event_idx").on(table.organizationId, table.event, table.createdAt),
}));
export type PaxTrustLedgerEntry = typeof paxTrustLedger.$inferSelect;
