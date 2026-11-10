import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { acquiredNotes, deals, organizations, properties } from "../schema";

export const uploadedDocuments = pgTable(
  "uploaded_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dealId: integer("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "cascade" }),
    acquiredNoteId: uuid("acquired_note_id").references(() => acquiredNotes.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageRef: text("storage_ref").notNull(),
    category: text("category"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("uploaded_documents_org_deal_idx").on(table.organizationId, table.dealId, table.createdAt),
    index("uploaded_documents_org_property_idx").on(table.organizationId, table.propertyId, table.createdAt),
    index("uploaded_documents_org_note_idx").on(table.organizationId, table.acquiredNoteId, table.createdAt),
  ],
);

export type UploadedDocument = typeof uploadedDocuments.$inferSelect;
export type InsertUploadedDocument = typeof uploadedDocuments.$inferInsert;
