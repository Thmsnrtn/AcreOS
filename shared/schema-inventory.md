# shared/schema.ts — Domain Bucket Inventory

**Last updated:** 2026-05-04
**Purpose:** When the schema-file refactor finally happens (per `SCHEMA-REFACTOR-DECISION.md`, after Note Investor ships), this is the table-of-contents that drives the file split. Each major section in `shared/schema.ts` maps to a domain bucket; the future `shared/schema/<bucket>.ts` files line up against this list.

**Read order:** sections in `shared/schema.ts` are roughly chronological (oldest at the top, newest at the bottom). Bucket order below reflects target file split, not source order.

---

## Domain buckets (target layout post-refactor)

### `shared/schema/auth.ts`
- ORGANIZATIONS & TEAM MANAGEMENT (line 46)
- Org Co-Owners (line 245)
- TEAM READINESS (per-seat / round-robin / Slack / offer approvals — Phase 5 §5)

### `shared/schema/crm.ts`
- CRM: LEADS & CONTACTS (line 629)
- LEAD SCORING (line 730)
- ACTIVITY EVENTS (Communication History Timeline) (line 4092)
- CUSTOM FIELDS SYSTEM (line 4327)

### `shared/schema/inventory.ts`
- INVENTORY: PROPERTIES & DEALS (line 877)
- DUE DILIGENCE CHECKLISTS (line 3098)
- DEAL CHECKLISTS (Stage Gate Due Diligence) (line 3170)
- PROPERTY VISION SNAPSHOTS — Ingrid §1 (Phase 8)

### `shared/schema/notes.ts`
- FINANCE: NOTES & PAYMENTS (line 1142)
- NOTE INVESTOR VERTICAL (acquired_notes + note_payments — Phase 5 §5)

### `shared/schema/marketing.ts`
- MARKETING CAMPAIGNS (line 1335)
- DRIP CAMPAIGN SEQUENCES (line 4160)
- A/B TESTING FRAMEWORK (line 4233)
- LIFECYCLE PROGRAM (Phase 4 W17-18)

### `shared/schema/agents.ts`
- AI AGENTS & AUTOMATION (line 1478)
- MULTI-AGENT ORCHESTRATION (line 1603)
- AI COMMAND CENTER (line 1931)
- PAX CONNECTORS (line 1987)
- PAX SCHEDULED TASK RUN HISTORY (line 2082)
- PAX NUDGES (line 2100)
- AI VIRTUAL ASSISTANTS (line 2150)
- VA REPLACEMENT ENGINE (line 2361)
- AI ROUTING OVERRIDES (Wave 10)
- AI INJECTION ATTEMPTS (Phase 4 W21-22)
- COMPLIANCE VALIDATIONS (Phase 4 W21-22)
- PROMPT VERSIONS (Phase 4 W21-22)
- ML TRAINING SNAPSHOTS (Magnus §1)

### `shared/schema/billing.ts`
- USAGE & BILLING (line 1860)
- USAGE ACTION TYPES & PRICING (line 3278)
- CREDIT PACKS (line 3294)
- SUBSCRIPTION TIERS CONFIGURATION (line 3307)
- DUNNING & PAYMENT RECOVERY (line 3838)
- COST OPTIMIZATION RUNS (Wave 10)
- CUSTOMER UNIT ECONOMICS (Wave 10)
- AI USAGE DAILY (Wave 7 — AI cost cap)
- SUBSCRIPTION HISTORY (Wave 6)

### `shared/schema/audit.ts`
- ACTIVITY LOG & AUDIT (line 1834)
- AUDIT EVENTS (Coriander recovery console)
- LEGAL HOLDS (Saskia/Lazlo/Margolis — Phase 3 W11)
- DSAR REQUESTS (Phase 3 W11)
- DATA PROCESSING AGREEMENTS (sub-processors — Phase 3 W11)

### `shared/schema/email.ts`
- EMAIL EVENTS + SUPPRESSIONS (line 298)
- ELEONORA DELIVERABILITY (line 354 — DKIM, warmup, reputation)
- VERIFIED SENDERS (line 453)
- EMAIL TEMPLATES + LIFECYCLE MESSAGE SENDS (Wave 11)

### `shared/schema/ops.ts`
- API JOB QUEUE (line 4050)
- DIGEST SUBSCRIPTIONS (line 4074)
- FEATURE REQUESTS (line 3801)
- FOUNDER ALERTS & SYSTEM NOTIFICATIONS (line 3925)
- PAX OBSERVATIONS (line 3965)
- AI CUSTOMER SUPPORT SYSTEM (line 3518)
- OUTBOX + OUTBOX_DLQ + JOB_RUNS (Wave 7)
- VM RESOURCE USAGE (Wave 10)
- ETL JOBS + ETL RUNS (Phase 8)

### `shared/schema/integrations.ts`
- PROVIDER CACHE (line 2910)
- CUSTOM AUTONOMY RULES (line 2931)
- TITLE PARTNERS + TITLE ORDERS (Hartwell — Phase 7)
- ORG INTEGRATIONS SLACK (Phase 5 §5)
- SUPPORT SAVED REPLIES (Wave 8)

### `shared/schema/index.ts` (barrel + cross-cutting)
- RELATIONS (line 2763 — re-export everything)
- INSERT SCHEMAS (line 2823)
- TYPE EXPORTS (line 2957)

---

## Refactor approach (for the eventual split)

1. **Create directory** `shared/schema/`
2. **Move tables** to bucket files (mechanical — copy section, paste into new file, leave the old section as a re-export comment)
3. **Re-create `shared/schema.ts`** as a barrel: `export * from "./schema/auth"; export * from "./schema/crm"; ...`
4. **Move `RELATIONS` block** last (it imports from every bucket)
5. **Move `INSERT SCHEMAS` and `TYPE EXPORTS`** alongside their tables (each bucket gets its own insert schemas + type exports)
6. **Verify** `npm run check` passes — relations should still resolve via the barrel
7. **Verify** Drizzle introspection still produces the same migration output (run `drizzle-kit introspect`, diff)

---

## Tables not yet bucketed (potentially obsolete)

- A handful of `*_v6 / _v7 / _v8` tables in the founder-dashboard panels — should be audited for "is this still in use?" before being bucketed. Mark for deletion if nothing imports them.

---

## Estimated refactor effort (when triggered)

- 2-3 days per `SCHEMA-REFACTOR-DECISION.md`
- Bulk of work is mechanical moves
- The risk surface is the `RELATIONS` block — keeping cross-bucket imports clean
- Drizzle's barrel-export pattern is the simplest available structure
