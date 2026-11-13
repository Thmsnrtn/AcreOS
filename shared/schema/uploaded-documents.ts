import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    // The migration's CHECKs, mirrored in drizzle (the sibling convention —
    // note-origination-records.ts declares its checks the same way) so a
    // drizzle-kit-push database enforces what migrations/0309 enforces.
    check("uploaded_documents_file_name_check", sql`length(trim(file_name)) > 0`),
    check("uploaded_documents_byte_size_check", sql`byte_size > 0`),
    check("uploaded_documents_storage_ref_check", sql`storage_ref LIKE 's3://%'`),
    check("uploaded_documents_uploaded_by_check", sql`length(trim(uploaded_by)) > 0`),
    check(
      "uploaded_documents_exactly_one_parent",
      sql`num_nonnulls(deal_id, property_id, acquired_note_id) = 1`,
    ),
  ],
);

export type UploadedDocument = typeof uploadedDocuments.$inferSelect;
export type InsertUploadedDocument = typeof uploadedDocuments.$inferInsert;
