// ============================================================================
// SHARED/SCHEMA/PURPOSE-LEDGER.TS
// ----------------------------------------------------------------------------
// The purpose ledger — D2e (Amendment 2 §2.3). One row per person-adjacent
// lookup: who looked (actor + org), why (the permissible-purpose code they
// declared), what about (lead / property / parcel context), and the metering
// event it rode on. APPEND-ONLY: migration 0289 installs BEFORE UPDATE and
// BEFORE DELETE triggers that raise (a DBA retention prune can set the
// session GUC acreos.allow_purpose_ledger_mutation = 'on'). There is no update
// or delete path in code. organization_id carries NO foreign key, by design:
// the ledger is a compliance record retained under GDPR Art. 17(3)(b) when an
// organization is erased (orgDeletion.ts RETAINED_TABLES). An FK — cascading
// or not — would either delete the record or block the erasure; the
// append-only trigger forbids the first, and the second left
// deleteOrganization() unable to finish for any org that used skip trace.
//
// Mechanics only. The purpose-code taxonomy is a conservative default (the
// skip-trace FCRA purposes already collected at every door) and is an
// attorney-review input at LLC / first customer — not a compliance declaration.
// ============================================================================

import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const purposeLedger = pgTable(
  "purpose_ledger",
  {
    id: serial("id").primaryKey(),
    // No FK to organizations (see the header): retained after erasure.
    organizationId: integer("organization_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    actorUserId: text("actor_user_id").notNull(),
    /** Which enumerated surface (server/services/purposeLedger.ts PURPOSE_SURFACES). */
    surface: text("surface").notNull(),
    /** The permissible-purpose code the actor declared. Never null: no code, no read. */
    purposeCode: text("purpose_code").notNull(),
    justification: text("justification"),
    attestationVersion: text("attestation_version"),
    leadId: integer("lead_id"),
    skipTraceId: integer("skip_trace_id"),
    /** AcreOS parcel id when the lookup is about a known parcel. */
    apid: text("apid"),
    /** The metering event the lookup rode on (pool debit externalEventId + ledger row). */
    meteringRef: text("metering_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [index("purpose_ledger_org_created_idx").on(table.organizationId, table.createdAt)],
);

export type PurposeLedgerRow = typeof purposeLedger.$inferSelect;
