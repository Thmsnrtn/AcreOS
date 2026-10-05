// ============================================================================
// SHARED/SCHEMA/MARKETING-LIST-MEMBERS.TS — which leads a marketing list holds.
// ----------------------------------------------------------------------------
// W10.3 list builder (behind the Map door), migration 0260. Until this table a
// marketing_lists row carried only import metadata, so nothing could say who
// was on a list — the mail composer refused `leadListIds` for exactly that
// reason (routes-outreach-mail.ts resolveAudience). A county list saved from
// the list builder links every parcel it holds to a lead: an existing live
// lead, or one created for it.
//
// One membership per (list, lead). Deleting a list, or hard-erasing a lead,
// removes its memberships (ON DELETE CASCADE). Org-leading index for the
// per-tenant reads; every statement on this table names the org inline.
// ============================================================================
import { pgTable, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, marketingLists, leads } from "../schema";

export const marketingListMembers = pgTable("marketing_list_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  listId: integer("list_id").references(() => marketingLists.id, { onDelete: "cascade" }).notNull(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("marketing_list_members_list_lead_uidx").on(table.listId, table.leadId),
  index("marketing_list_members_org_list_idx").on(table.organizationId, table.listId),
]);

export type MarketingListMember = typeof marketingListMembers.$inferSelect;
export type InsertMarketingListMember = typeof marketingListMembers.$inferInsert;
