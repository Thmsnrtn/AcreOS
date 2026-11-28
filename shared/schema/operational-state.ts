import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Operational state — machine-kept key-value state that is NOT a founder
// setting: the autopilot gate watcher's per-gate state, the decisions-
// inbox throttle's counters, the LQ22 tripwire's latest report, and the
// channel pause/throttle overrides. Writers are machines plus the
// founder override surfaces; there is no settings-service seeding,
// validation, or per-write audit here (subsystems that need audit write
// their own at the call site). Access layer: server/services/
// operationalState.ts. See the design record
// seat2-q8v5-p12-1c-design-2026-11.md §6 (P12-1c).
// Module placement in shared/schema/ follows the DEFECT-0048 schema split.
export const operationalState = pgTable("operational_state", {
  id: serial("id").primaryKey(),
  namespace: text("namespace").notNull(), // gate_watcher | inbox_throttle | lq22_tripwire | channel_overrides | dial | org_overrides
  key: text("key").notNull(), // full legacy key, verbatim
  value: text("value").notNull(),
  valueType: text("value_type").notNull().default("string"), // string | number | boolean | json
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
}, (table) => [
  uniqueIndex("operational_state_namespace_key_unique").on(table.namespace, table.key),
  index("operational_state_key_idx").on(table.key),
]);

export type OperationalState = typeof operationalState.$inferSelect;
