/**
 * wholesale_buy_boxes — the residential wholesaler's buy box, versioned
 * (wholesale package Leg 2; migration 0301; the one table the package
 * pre-named, approved 2026-11-05).
 *
 * The operator's OWN criteria for which of their OWN candidates they would
 * wholesale. No sourcing data, no owners, no lists. Every save is a new row
 * with the next version; the reader takes the highest. Append-only by
 * trigger; a row leaves only with its organization (ON DELETE CASCADE).
 */
import { index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import type { BuyBoxCriteria } from "../wholesale/buyBox";

export const wholesaleBuyBoxes = pgTable(
  "wholesale_buy_boxes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    version: integer("version").notNull(),
    criteria: jsonb("criteria").$type<BuyBoxCriteria>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("wholesale_buy_boxes_org_version_uq").on(table.organizationId, table.version),
    // The one read: an org's versions, newest first.
    index("wholesale_buy_boxes_org_version_idx").on(table.organizationId, table.version),
  ],
);

export type WholesaleBuyBox = typeof wholesaleBuyBoxes.$inferSelect;
