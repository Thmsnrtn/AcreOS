# 05 — Schema (Dimension 05)

*Slice 05. Read-only. Region: 748 pgTables (500 in `shared/schema.ts`, 248 across 77 files in `shared/schema/`), migrations/*.sql, `scripts/migrate.mjs`, and the schema gates (`lint:schema`, `reachability` ratchet, `table-count` ratchet, `validate-schema-column-refs`, `migrate-mirror-check`). DATABASE_URL not set — row counts requires DB confirmation; liveness inferred from writers/readers in code.*

**State of the region:** The schema is heavily gated on *count* (748 down-only) and *dead-weight* (reachability ratchet counts 45 no-writer + 57 no-reader tables). Those gates work. **The defect class that survives every gate here is schema-vs-DDL correctness: the two gates that exist to stop "route 500s because prod is missing a column/table" each have a structural blind spot, and between them a schema change can 500 prod on deploy while every gate stays green.** Secondary: ~80 confirmed-dead tables are held at baseline but never forced into the deletion queue, and index coverage beyond the org-leading shard rule is ungated.

---

### F-05-1 — `validate-schema-column-refs` is blind to 248 of 748 tables (every split-schema file)
**Severity:** P1 serious
**Surfaced by:** slice 05
**Survives which gates:** It *is* the gate. `scripts/validate-schema-column-refs.ts:37,57` builds its table→columns index from **only** `shared/schema.ts`. `checkColumnRef` (line 218-219) does `const cols = schema.get(tableName); if (!cols) return;` — any table it did not index is **silently skipped, not flagged**. The 248 tables in `shared/schema/*.ts` (rental, notes-vertical, finance, compliance, reg-z, marketplace, …) are all absent from the index, so a bad column reference against any of them passes clean. `tsc` cannot catch it either (Drizzle column access is `any`-typed at the call site and throws only at runtime prepare).
**Evidence:** `scripts/validate-schema-column-refs.ts:37` (`SCHEMA_FILE = …/shared/schema.ts`), `:57` (`addSourceFileAtPath(SCHEMA_FILE)` — single file), `:218-219` (unknown table ⇒ `return`). The gate's own docstring (`:3-8`) says it exists to stop the class that "crashed activity-timeline, /avm, /founder, agent_events inserts."
**What's wrong:** The validator catches `db.insert(TABLE).values({ badCol })` / `db.select({ k: TABLE.badCol })` only for the 500 monolith tables. For the 248 split-file tables the exact failure it exists to prevent — Drizzle throwing "Cannot convert undefined or null to object" at prepare time and 500-ing the route — walks straight through. Worse, the ongoing schema-split campaign *widens* the blind spot: moving a table from `schema.ts` into `schema/foo.ts` silently drops it from the gate.
**Impact:** Burns trust after sale (and can block first sale on a deploy). A column-name typo or a stale reference after a rename, on any split-file table (rent roll, notes, finance, compliance), 500s that route in prod with no CI signal. Hits the first customer whose data touches a split-vertical surface.
**Fix:** Change `validate-schema-column-refs.ts` to build the index from the same glob the drizzle config already uses: `["shared/schema.ts", "shared/schema/*.ts"]` (mirror `drizzle.config.ts:schema`). Add each `schema/*.ts` file via `addSourceFileAtPath` and merge their `pgTable` decls into the map. Re-baseline once (`--update-baseline`) to freeze pre-existing split-file violations, then shrink.
**Gate it:** This finding *is* a gate fix. After widening, the existing `.github/workflows/schema-validation.yml` job covers all 748 tables. Add a one-line assertion in the script that the indexed-table count ≈ the `table-count` ratchet baseline (748) so a future split can't silently shrink coverage again. Measured baseline today: indexes **500** tables, skips **248**.
**Effort:** S (<2h)
**Blast radius:** `scripts/validate-schema-column-refs.ts`, `scripts/schema-column-baseline.json` (re-baseline).
**Confidence:** high — the single-file index and the silent-skip branch are both read directly; the only unknown is how many *live* violations currently hide in the 248 (needs the widened run to enumerate).

---

### F-05-2 — No gate ties a `shared/schema.ts` change to a prod DDL statement; schema-only additions 500 prod on deploy
**Severity:** P1 serious
**Surfaced by:** slice 05
**Survives which gates:** `migrate-mirror-check.yml` fires **only when a `migrations/*.sql` file changes** (`SQL_TOUCHED=$(… grep '^migrations/.*\.sql$'); if [ -z "$SQL_TOUCHED" ]; then … exit 0`). A change that adds a column/table to `shared/schema.ts` with **no `.sql` file and no `migrate.mjs` edit** touches neither tripwire and passes. `validate-schema-column-refs` sees the new column *in schema.ts* and calls every reference valid. `tsc`, `table-count`, and `reachability` all check the TS side, never the DB side. `audit-schema-drift.mjs` would catch it but needs `DATABASE_URL` and **is wired into no gate** (`grep` across `package.json`/`.github/` finds zero references; it writes a manual doc).
**Evidence:** `.github/workflows/migrate-mirror-check.yml:53-60` (early-exit when no `.sql` touched). `scripts/migrate.mjs:1-9` header: "columns added to shared/schema.ts that never got a proper Drizzle migration." The file carries **6+ dated incident comments** for exactly this — `:44-48` (ATR columns, "prod SELECT-* from notes started 500-ing on /api/dashboard/stats"), `:99-105` (`users` 500-ing "every ~3s in prod for any authenticated request"). `drizzle.config.ts` comment: "90+ tables shipped with no migration." `migrate.mjs` is **8,692 lines** — the churn leader — precisely because it is the hand-maintained catch-up for this ungated drift.
**What's wrong:** `migrate.mjs` (Fly `release_command`) is authoritative for prod DDL; the `.sql` files are not auto-applied and the drizzle journal was deleted (`drizzle.config.ts` comment). The only structural guard checks `.sql`↔`migrate.mjs` symmetry — it does not check that `schema.ts` reality is reflected in `migrate.mjs`. So the actual recurring incident (a column added in TS with no DDL) is the one case with no tripwire. Spot check confirms partial coverage: `investor_verification_documents`, `depreciation_schedules`, `course_modules`, `whitelabel_tenants` appear **0 times** in `migrate.mjs` (only in old `0003_robust_namora.sql`).
**Impact:** Blocks first sale / burns trust. A deploy that adds a schema-only column 500s every `SELECT *` on that table for all tenants until someone hand-patches `migrate.mjs` and redeploys. This has already happened repeatedly per the file's own comments.
**Fix:** Add a `migrate.mjs --dry-run` (the mode already exists, `migrate.mjs:20-24`) step to the deploy pipeline against a fresh restore — the header says it "should" run but no workflow does. Better: a CI check that parses `pgTable` columns from `shared/schema.ts` + `shared/schema/*.ts` and asserts each has a matching `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` in `migrate.mjs` (textual, no DB needed) — the same "mirror" discipline, applied on the schema→migrate axis that actually breaks.
**Gate it:** New lint `lint:schema-migrate-mirror` (schema.ts+split columns ⊆ migrate.mjs statements), wired into `npm run check`. Baseline the current gap as an allowlist and ratchet down. Requires DB confirmation to enumerate live prod-missing columns; the gate gap itself is confirmed from code.
**Effort:** M (<1d)
**Blast radius:** `.github/workflows/deploy.yml` (+dry-run step), one new lint script, `package.json`.
**Confidence:** high on the gate gap (read the workflow's early-exit and confirmed `audit-schema-drift` is unwired); medium that a *live* drifted column exists at HEAD (needs `DATABASE_URL`).

---

### F-05-3 — ~80 confirmed-dead tables held at ratchet baseline, most never queued for deletion
**Severity:** P2 real
**Surfaced by:** slice 05
**Survives which gates:** The `reachability` ratchet **counts** them (`tablesNoWriter: 45`, `tablesNoReader: 57`, baseline-locked) and the `table-count` ratchet counts them toward 748, but both are *down-only holds* — neither forces removal. A dead table sits at baseline indefinitely; nothing escalates it into the deletion queue.
**Evidence:** `node scripts/lint-reachability.mjs --measure` output (pasted): 45 no-writer incl. `email_templates`, `cma_reports`, `lien_search_records`, `notes_receivable`, `scraped_deals`, `deal_sources`, `webhook_deliveries`, `scp_evolution_metrics`, `personal_bests`, `deferred_revenue`, `tax_sale_alerts`, `ai_models`, `ai_eval_gate_runs`; 57 no-reader incl. `orgCredits`, `reconciliation_runs`, `customer_concentration`, `content_drafts`, `adjacent_verticals_waitlist`, `campaign_leads`, `autopilot_sends`, `memory_access_log`. Deletion-ledger cross-check: 13 of 14 sampled names appear **0 times** in `docs/company/deletion-ledger.md`; only `automation_rules`/`automation_executions` are adjudicated ("remain … pending a drop migration", ledger:286-287).
**What's wrong:** These are ~80 distinct tables (union of the two lists) the repo's own gate certifies as having no writer and/or no reader — dead weight inflating the count against the ≤450 H2 target — yet they are not in the KILL queue. The ratchet's stated north star is a smaller schema, but its mechanism only prevents *growth*, not *stagnation at a dead baseline*.
**Impact:** Neither blocks nor burns directly (dead tables are inert). Hurts the shrink campaign: ~11% of the 748 is confirmed-removable and un-adjudicated, so the founder can't see the real drop-ready surface.
**Fix:** Batch-triage the 45/57 into the deletion ledger with a KEEP/DROP verdict each (the three genuine false-positives — `call_transcripts`, `compliance_alerts`, `regulatory_changes` — are already documented in the ratchet note and excluded). For DROPs, remove from schema, add `DROP TABLE IF EXISTS` to `migrate.mjs`, and lower both ratchet baselines in the same commit (the ratchets' own rule).
**Gate it:** Extend `reachability.json` with a `mustAdjudicate` flag: a table in no-writer/no-reader for N consecutive baselines with no ledger row fails. Or simpler: a periodic job that diffs the `--measure` lists against the ledger. Baselines today: no-writer 45, no-reader 57.
**Effort:** L (<1w) to triage and execute the drops.
**Blast radius:** `shared/schema.ts` + several `shared/schema/*.ts`, `scripts/migrate.mjs`, both ratchet JSONs, deletion ledger.
**Confidence:** high — lists produced by the repo's own linter; ledger absence verified by grep.

---

### F-05-4 — Index coverage is gated only for the org-leading shard rule; non-org FK and hot-path indexes are ungated (148 org tables still uncovered)
**Severity:** P2 real
**Surfaced by:** slice 05
**Survives which gates:** `lint:schema` = `check-org-leading-index.mjs` checks **one** thing: org-scoped tables must have a `(organization_id, …)` leading composite index. It allowlists 148 offenders (down-only). Nothing checks (a) that foreign-key columns other than `organization_id` are indexed, or (b) that hot-path `ORDER BY`/`WHERE` columns are indexed. Postgres does **not** auto-create an index for a `REFERENCES` column, so an FK with no explicit index is unindexed.
**Evidence:** `node scripts/check-org-leading-index.mjs` output: "org-scoped: 350, conforming: 202, baseline (allowlisted): **148**, new offenders: 0." The lint's own header (`:12-19`) scopes it to the shard-routing composite only. FK columns such as `subscription_id`, `api_key_id`, `note_id`, `lease_id` are indexed on some tables by hand (e.g. `public-api.ts:142` indexes `subscription_id`) but nothing *requires* it — coverage is per-author discretion.
**What's wrong:** 148 org-scoped tables lack the leading tenant composite, so per-tenant hot-path queries filter cross-tenant rows before narrowing. Separately, any non-org FK column left unindexed makes both joins and `ON DELETE CASCADE` sweeps do sequential scans — the cascade cost compounds because `organizations` and `notes` cascade widely.
**Impact:** Neither blocks first sale nor burns trust at zero customers (tables are near-empty). Post-scale latency + expensive tenant-delete cascades. Filed as debt with a stated radius, not an active fault.
**Fix:** (1) Continue ratcheting the 148 org-leading allowlist down. (2) Add a lint pass that flags every `.references(() => …)` column with no `index(...)` leading on it (allowlist current state, ratchet down). FK-index coverage is the higher-value half because it governs cascade-delete cost.
**Gate it:** Extend `check-org-leading-index.mjs` (or a sibling `check-fk-index.mjs`) to assert FK columns are indexed. Measured baselines: org-leading offenders **148**; FK-index coverage currently **ungated** (baseline TBD on first run).
**Effort:** M (<1d) for the FK-index lint; L to remediate the 148.
**Blast radius:** `scripts/check-org-leading-index.mjs`, schema files as offenders are fixed.
**Confidence:** high on the gate scope (read the lint + ran it); medium on real-world impact magnitude (needs row counts).

---

### F-05-5 — `shared/schema/marketplace.ts` is a 46 KB grab-bag concentrating dead weight and defeating module-level FREEZE reasoning
**Severity:** P2 real
**Surfaced by:** slice 05
**Survives which gates:** No gate asserts a schema file's tables belong to its named domain. The `table-count` and `reachability` ratchets are file-agnostic, so a mis-scoped file never trips anything.
**Evidence:** `shared/schema/marketplace.ts` (45,987 bytes) defines, beyond marketplace: `courses`, `courseModules`, `tutorSessions` (education), `whitelabelTenants` (white-label), `esignWebhookEvents`, `processedWebhookEvents`, `stripeProcessedEvents` (webhook infra), `propertyPhotos`, `photoAnalysis` (media), `regulatoryChanges`, `complianceAlerts` (compliance). **8 of its tables are in the dead lists** (`--measure`): `propertyPhotos`, `photoAnalysis`, `courses`, `courseModules`, `tutorSessions`, `whitelabelTenants`, `esignWebhookEvents` (no-writer) + several no-reader. Orientation doc (00) already flagged this file's churn as *deletion*, not marketplace construction.
**What's wrong:** The filename asserts a domain the contents contradict. Because "marketplace" carries a FREEZE verdict (no marketplace <25 customers), a reader reasoning at the file level either wrongly believes frozen code is being touched or can't tell which of the 27 tables are the actual (deferred) marketplace surface vs unrelated live/dead tables. The file also concentrates ~8 dead tables, making them harder to see as individually droppable.
**Impact:** Neither blocks nor burns. Slows every future audit and consolidation pass over this region; raises the odds a dead table hides behind a frozen-sounding module name.
**Fix:** Split by true domain: `education.ts` (courses/modules/tutor), `webhooks.ts` (the three *ProcessedEvents), `media.ts` (photos/analysis), leaving `marketplace.ts` with only genuinely-marketplace tables. Fold the 8 dead ones into the F-05-3 triage.
**Gate it:** None cheaply possible — "table belongs to its file's domain" is a semantic judgment no lint can make reliably. Best proxy: keep the deletion campaign shrinking the file; document the true contents in a header block so the name stops misleading.
**Effort:** S (<2h) to split; folds into F-05-3 for the dead tables.
**Blast radius:** `shared/schema/marketplace.ts` + import sites; low risk (pure re-org, re-export from an index barrel).
**Confidence:** high — file contents read directly and cross-checked against the dead-table measure.

---

## Coverage ledger

**Examined exhaustively:** the schema gate set — `scripts/lint-reachability.mjs` (read end-to-end incl. the write/read regex families lines 494-555, ran `--measure` for the full 45/57 dead-table lists), `scripts/check-org-leading-index.mjs` (header + ran it), `scripts/validate-schema-column-refs.ts` (index-build + `checkColumnRef` blind-spot), `.github/workflows/migrate-mirror-check.yml` and `schema-validation.yml`, `scripts/ratchets/reachability.json` + `table-count.json` (both `lastBumpNote`s), `drizzle.config.ts`, `scripts/migrate.mjs` (header + incident comments + spot-grep coverage of 8 split-file tables). Read `shared/schema/public-api.ts` in full and the marketplace file inventory.

**Examined by sampling:** dead-table names cross-checked against `docs/company/deletion-ledger.md` (14 of ~80 sampled); `migrate.mjs` table coverage spot-checked (8 tables); FK-index presence spot-checked (`public-api.ts`).

**Did NOT examine:** live prod row counts / actual applied DDL — **requires DB confirmation** (`DATABASE_URL` unset), so F-05-2's *live* drifted-column instances and F-05-4's real latency impact are inferred, not measured. Did not read the full body of the large split files (`notes-vertical.ts` 63 KB, `rental.ts` 48 KB, `etl.ts` 35 KB, `finance.ts` 25 KB, `reg-z.ts` 25 KB, `compliance.ts` 22 KB) column-by-column for missing NOT NULL / unique / FK constraints — sampled only. Did not enumerate the 148 org-leading offenders individually. Did not re-verify the 12 registry P0s (done in 00-orientation, per briefing).

## Constitution Collisions

- **`shared/schema/public-api.ts` (4 tables) vs "no public API before ~50 customers."** The tables (`api_keys`, `api_key_usage`, `webhook_subscriptions`, `webhook_delivery_log`) are built ahead of the constitutional trigger. This is **not a violation and I do not report it as a finding**: the schema is scaffold-only (file header `:26-29`), the routes are deliberately unmounted (`routes-api-keys.ts` is the single allowlisted `unregisteredRoutes` entry), and the `reachability.json` note records the founder decision that this dormancy is intentional ("no public API before ~50 customers forbids mounting it before its trigger"). `apiKeyUsage` and `webhookDeliveryLog` show up in the no-reader list — expected for scaffold, not dead weight to drop. **Verdict already recorded = KEEP-dormant; I concur and do not relitigate.** Noted only so the count is honest: these 4 tables sit in the 748 by deliberate deferral, not oversight.
- No other collisions. No finding here proposes a marketplace, public API, new nav, money-custody change, new AI destination, fabrication, or a hard-stop delegation.
