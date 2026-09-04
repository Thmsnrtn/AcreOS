#!/usr/bin/env node
// ============================================================================
// scripts/check-org-leading-index.mjs
// ----------------------------------------------------------------------------
// L3 shard-readiness lint — ensures every pgTable declared in shared/schema*.ts
// that exposes a TENANT KEY (`organizationId`/`organization_id`, or the other
// spelling this schema uses, `orgId`/`org_id`) also declares at least one
// composite index that LEADS with that column.
//
// Why
// ───
// Tahoe-horizon sharding wants tenant routing to be a single index probe. A
// composite index `(organization_id, ...)` lets every per-tenant query (the
// hot path on every page) avoid scanning rows from other tenants and lets us
// later range-partition or shard by `organization_id` without a re-indexing
// migration. Tables that only have a single-column `(organization_id)` index
// trigger the warning band — those should usually be widened to cover the
// dominant query pattern's secondary key (status, created_at, …).
//
// Heuristic
// ─────────
// We don't run TypeScript. We do a focused regex pass:
//
//   1. Split the file into `pgTable("…", { … }, (table) => [ … ])` blocks.
//   2. Inside each block, detect whether the column map declares
//      `organizationId: …("organization_id"…)`. If not → skip.
//   3. Inside the indexes array, find every `index("…").on(table.X, …)` call
//      and pull the first column reference. If any index leads with
//      `table.organizationId`, the table passes.
//   4. Also accept a `uniqueIndex` leading on `table.organizationId`.
//
// Exit codes
// ──────────
//   0 — all org-scoped tables conform (or every offender is in the baseline
//        allowlist below), AND the scan itself proved sound
//   1 — at least one offender reported that is NOT in the baseline allowlist,
//        a stale allowlist entry, a scan population under its floor, a missing
//        anchor schema file, or a pgTable the parser could not read (see
//        "DESYNCS ARE RETURNED, NOT SWALLOWED" at the parser)
//
// Baseline allowlist
// ──────────────────
// The repo has ~150 pgTables that pre-date this lint and lack a leading-
// org composite index. Remediating all of them in one PR would carry too
// much regression risk (some have non-org indexes leading on a hotter
// secondary key that we'd want to keep). The allowlist freezes the
// known-bad set so the lint can land NOW and block any NEW offender. The
// allowlist is intended to ratchet DOWN over time — every table removed
// from this list is a permanent improvement. To remove an entry:
//
//   1. Add an `index("<table>_org_…_idx").on(table.organizationId, …)` to
//      the table's index callback in shared/schema*.ts.
//   2. Mirror the index in scripts/migrate.mjs.
//   3. Delete the entry from BASELINE_OFFENDERS below.
//   4. `node scripts/check-org-leading-index.mjs` should pass.
//
// Limitations (documented; raise to the team if they become real):
//   - Tables that bury their indexes outside the `(table) => [ … ]` callback
//     (e.g. declared as a separate `index()` call appended later) are missed.
//     We haven't seen this pattern in the repo.
//   - RESOLVED 2026-09-04. This entry used to read "Tables that use a column
//     name other than `organizationId` (e.g. `orgId`) aren't picked up — we
//     explicitly require the canonical name", filed as a limitation to raise
//     "if it becomes real". It was real the whole time: 40 pgTables key their
//     tenant on `orgId: integer("org_id")`, every one skipped before the index
//     rule ran, and eleven of them non-conforming. Both spellings are now in
//     TENANT_KEY_SPELLINGS, each with its own population floor, because a
//     single total cannot tell "both are read" from "one silently stopped
//     matching". A limitation nobody measures is indistinguishable from a
//     limitation that does not exist.
// ============================================================================

// ----------------------------------------------------------------------------
// Baseline allowlist — pre-existing pgTables that lack a leading-org composite
// index. New entries here REQUIRE Iris-CTO + Andrei-AI/ML sign-off; the
// ratchet only goes one way (DOWN).
//
// Each entry is "table_name". Curated 2026-06-05 from the L3 shard-readiness
// audit (Iris). The "no inline indexes at all" subset (~120 tables) is the
// safest follow-up — those can each take a purely-additive
// (organizationId, createdAt) composite without touching any existing query
// plan.
// ----------------------------------------------------------------------------
const BASELINE_OFFENDERS = new Set([
  "ab_tests",
  "activity_events",
  "activity_log",
  "ad_postings",
  "agent_configs",
  "agent_events",
  "agent_feedback",
  "agent_memory",
  "agent_session_steps",
  "agent_sessions",
  "ai_conversations",
  "ai_cost_ceiling_overrides",
  "ai_execution_runs",
  "ai_memory",
  "api_jobs",
  "api_usage_logs",
  "autopay_enrollments",
  "borrower_payment_profiles",
  "borrower_sessions",
  "browser_automation_jobs",
  "browser_automation_templates",
  "browser_session_credentials",
  "buyer_prequalifications",
  "buyer_profiles",
  "buyer_qualifications",
  "buyer_reservations",
  "call_transcripts",
  "campaign_leads",
  "campaign_optimizations",
  "campaign_responses",
  "campaign_sequences",
  "cancellation_surveys",
  "cash_flow_forecasts",
  "checklist_templates",
  "closing_packets",
  "collection_enrollments",
  "collection_sequences",
  "compliance_checks",
  "conversations",
  "county_reviews",
  "custom_field_definitions",
  "dd_assignments",
  "decision_experiment_assignments",
  "deferred_revenue",
  "digest_subscriptions",
  "disposition_recommendations",
  "document_analysis",
  "document_packages",
  "document_templates",
  "document_versions",
  "due_diligence_checklists",
  "due_diligence_dossiers",
  "due_diligence_templates",
  "dunning_events",
  "email_sender_identities",
  "email_warmup_state",
  "escalation_alerts",
  "escrow_checklists",
  "event_subscriptions",
  "feature_requests",
  // "financial_ledger" removed 2026-07-29: it was never actually
  // non-conforming. The paren-walker mistook an apostrophe in one of its
  // comments for a string literal and swallowed the index callback, so the
  // table was allowlisted to silence a false positive. With comment-skipping
  // fixed above, it parses as conforming.
  "form_1099_batches",
  "generated_documents",
  "go_nogo_memos",
  "goals",
  "inbox_messages",
  "lead_activities",
  "lead_conversions",
  "lead_emails",
  "lead_qualification_signals",
  "lead_score_history",
  "lead_scoring_profiles",
  "lease_addendums",
  "mail_sender_identities",
  "mailing_orders",
  "market_metrics",
  "market_predictions",
  "marketing_lists",
  "ml_training_snapshots",
  "notes_receivable",
  "notification_preferences",
  "notifications",
  "nps_responses",
  "offer_batches",
  "offer_letters",
  "offer_templates",
  "offers",
  "onboarding_journeys",
  "opportunity_scores",
  "org_credits",
  "organization_integrations",
  "organization_invitations",
  "outcome_telemetry",
  "parcel_snapshots",
  "payment_reminders",
  "payments",
  "payoff_quotes",
  "playbook_instances",
  "portfolio_alerts",
  "price_recommendations",
  "property_listings",
  "provider_lookup_log",
  "radar_configs",
  "recognition_runs",
  "refund_requests",
  "saved_views",
  "scheduled_tasks",
  // security_deposits removed 2026-07-30 (Wave D deposit clock): the table now
  // carries index("security_deposits_org_deadline_idx").on(organizationId,
  // statutoryDeadline) — the org-scoped deposit-countdown read. Ratchet DOWN.
  "seller_communications",
  "seller_intent_predictions",
  "sequence_performance",
  "shared_deal_links",
  "signatures",
  "signing_consent_audit",
  "simulated_actions",
  "skip_traces",
  "subscription_events",
  "subscription_history",
  "support_cases",
  "support_resolution_history",
  "support_saved_replies",
  "swot_reports",
  "system_alerts",
  "target_counties",
  "tasks",
  "tax_escrow_payments",
  "tax_sale_alerts",
  // tax_sale_auctions + tax_sale_listings REMOVED 2026-07-30 (Wave D): both
  // tables got their first real insert path (manual + CSV lot-list entry) and
  // their first org-leading composite indexes in the same commit —
  // tax_sale_auctions_org_date_idx / _org_state_county_idx and
  // tax_sale_listings_org_auction_idx / _org_state_county_apn_idx /
  // _org_status_idx. Mirrored in scripts/migrate.mjs +
  // migrations/0216_tax_sale_manual_import.sql. A permanent improvement; this
  // allowlist only ratchets DOWN.
  "team_conversations",
  "team_member_presence",
  "team_members",
  "territories",
  "title_partners",
  "trust_ledger",
  "unsubscribe_tokens",
  "usage_events",
  "usage_records",
  "va_agents",
  "va_briefings",
  "va_calendar_events",
  "va_templates",
  "verified_email_domains",
  "webhook_deliveries",
  "white_label_configs",
  "workflows",
  "writing_style_profiles",
  // ── Revealed 2026-07-29 by the comment-skipping fix above ──────────────
  // These three were ALWAYS non-conforming; the paren-walker bug hid them by
  // mis-parsing apostrophes in nearby comments, so they never reached this
  // list. They are pre-existing debt, not new offenders — recorded here so the
  // debt is visible rather than invisible. Widen each to an org-leading
  // composite when its dominant query pattern is confirmed.
  "provisioned_phone_numbers",
  "va_actions",
  "move_inspections",

  // ── org_id WIDENING, 2026-09-04 ────────────────────────────────────────
  // This gate required the tenant key to be spelled `organizationId` /
  // `organization_id`. Its own header listed the other spelling under
  // "Limitations … raise to the team if they become real". It was real: 39
  // pgTables key their tenant on `orgId: integer("org_id")`, and every one was
  // skipped before the index rule ran. Eleven did not conform. One
  // (borrower_messages) was FIXED in the same commit — it carries a NOT NULL FK
  // to organizations.id and its declaration had no index callback at all, so it
  // gained borrower_messages_org_note_created_idx in schema and migrate.mjs.
  // The ten below are recorded rather than indexed, each for a stated reason.
  //
  // personal_bests — a NOT NULL FK tenant key, and a table NOTHING READS OR
  // WRITES: `server/services/personalBests.ts` queries `deals`, never this
  // table, and no other module touches it. Indexing a table with no reader
  // would be work for a query plan that does not exist. The honest follow-up is
  // deletion, which is a destructive schema change and not this commit's to
  // make; tables-no-writer already tracks the family.
  "personal_bests",
  //
  // The nine below are V12/V13 agent-infrastructure tables whose `org_id` is
  // NULLABLE and carries NO foreign key to organizations.id — a tag, not a
  // tenant key. A leading `(org_id, …)` index on a column that is null for most
  // rows serves no query and helps no future partition; what these actually
  // need is an adjudication of whether the column means anything at all, which
  // is held in scripts/org-scope-route-widening.json where the same tables
  // account for most of the 88 untriaged tenancy entries. Every one of them
  // already indexes the key its queries DO use (agent_codename, service_name,
  // current_stage …), which is the "non-org index leading on a hotter secondary
  // key that we'd want to keep" case this allowlist was created for.
  "outcome_verification_contracts",
  "integration_credentials",
  "integration_execution_log",
  "agent_working_memory_v13",
  "scp_semantic_facts",
  "scp_procedures",
  "scp_golden_cases",
  "scp_shared_memory",
  "scp_evolution_metrics",
]);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");

// ----------------------------------------------------------------------------
// VACUITY GUARDS — anchors + population floors
//
// Every number this gate acts on is a count of BAD THINGS FOUND (new offenders,
// stale allowlist entries), so a scan that stops seeing schema reports zero and
// reads as a clean bill of health. This repo has already been burned by exactly
// that class of lie three times in one day: a starved tsc reported 161 errors
// "fixed", scripts/ratchet.mjs with one misspelled glob root printed "PASS — all
// ratchets at baseline" while scanning ZERO files (and then invited the reader to
// re-baseline to 0), and lint-reachability declared a live table dead and reached
// a DROP TABLE candidate list on that basis.
//
// The ways THIS gate can go blind are concrete: shared/schema/ is renamed or
// re-nested so findSchemaFiles() returns nothing; the schema is split into a
// package the discovery does not walk; the pgTable call regex stops matching a
// new declaration style. In each case scannedTables collapses and the verdict
// stays "PASS".
//
// ANCHORS: the two schema files everything in this repo keys on must be found by
// the discovery walk. Unlike check-residential-comps-hold.mjs there is NO fixture
// mode here — nothing drives this script against synthetic repos, so a missing
// anchor is always a broken scan. If a fixture harness is ever added, it must
// supply these files (or add an explicit, deliberate fixture mode; do not simply
// delete the anchors).
//
// FLOORS: measured 2026-08-16 by running this gate against the live repo —
//   schema files    84   (shared/schema.ts + 83 under shared/schema/)
//   pgTable blocks 746   (NOT the 759 an older doc quotes: thirteen tables were
//                         dropped by the founder-authorised migration earlier
//                         that day, so the number was re-measured rather than
//                         copied)
//   org-scoped     364
//   conforming     217
// Each floor sits ~75% of live: a broken walk or a dead regex trips it, while
// ordinary table deletion — which this repo actively wants — does not. If a real
// deletion wave takes a population under its floor, LOWER THE FLOOR IN THE SAME
// COMMIT and name the wave. Never raise one to silence something, and never
// delete one: an unfloored population is the whole defect.
// ----------------------------------------------------------------------------
const ANCHOR_SCHEMA_FILES = ["shared/schema.ts", "shared/schema/rental.ts"];
const MIN_SCHEMA_FILES = 60; // live 84
const MIN_PGTABLE_BLOCKS = 560; // live 746
const MIN_ORG_SCOPED_TABLES = 270; // live 404 after the org_id widening
/**
 * PER-SPELLING floors, added 2026-09-04 with the org_id widening.
 *
 * The aggregate floor above cannot distinguish "both tenant-key spellings are
 * being read" from "one spelling is being read and the other silently stopped
 * matching" — the second reads as a healthy 364 while 40 tables go unjudged,
 * which is the exact state this gate shipped in until today. A population
 * claim needs a floor per member, or the member is free to disappear.
 * Measured 2026-09-04: organizationId 364, orgId 40.
 */
const MIN_TENANT_KEY_TABLES = { organizationId: 270, orgId: 28 };
const MIN_CONFORMING_TABLES = 160; // live 217

// ----------------------------------------------------------------------------
// File discovery
// ----------------------------------------------------------------------------

function findSchemaFiles() {
  const files = [];
  // shared/schema.ts + shared/schema-*.ts
  for (const entry of readdirSync(SHARED_DIR)) {
    const full = join(SHARED_DIR, entry);
    if (!statSync(full).isFile()) continue;
    if (entry === "schema.ts") files.push(full);
    else if (entry.startsWith("schema-") && entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  // shared/schema/*.ts (excluding test files)
  const subdir = join(SHARED_DIR, "schema");
  if (statSync(subdir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const entry of readdirSync(subdir)) {
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
      files.push(join(subdir, entry));
    }
  }
  return files.sort();
}

// ----------------------------------------------------------------------------
// pgTable block parser
// ----------------------------------------------------------------------------
//
// We slice every `pgTable("name", …)` call by walking parentheses from the
// opening `pgTable(` to the matching closing `)`. The contents are then
// scanned for the columns map + the optional `(table) => [ … ]` indexes
// callback (or the older `(t) => ({ … })` object form).
//
// DESYNCS ARE RETURNED, NOT SWALLOWED. This walker is an approximation of a
// TypeScript parser, so it can lose the thread — an escaped quote at the end of
// a string literal, a nested backtick inside a `${…}` interpolation, a regex
// literal carrying an unbalanced paren. Until 2026-08-16 the loss was silent
// (`if (endIdx === -1) continue;`), which is the worst possible behaviour for
// this gate: the table vanished from the population, and a table that was never
// parsed is INDISTINGUISHABLE from a table that conforms. The same walker has
// already mis-parsed real schema once (an apostrophe in a comment swallowed
// financial_ledger's index callback — see the BASELINE_OFFENDERS note), and that
// bug produced a false ACCUSATION, which at least got investigated. A silent
// drop produces a false ALL-CLEAR, which does not.
//
// So each unparseable call site is returned as a desync with its table name and
// line, and main() fails on any of them. A parser that cannot read a table must
// say which table.
function extractPgTableBlocks(source) {
  const blocks = [];
  const desyncs = [];
  // Match the literal call site so we can capture the table name and then
  // walk forward to the matching closing paren.
  const callRe = /\bpgTable\s*\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  let match;
  while ((match = callRe.exec(source)) !== null) {
    const tableName = match[1];
    const matchLine = source.slice(0, match.index).split("\n").length;
    const openIdx = source.indexOf("(", match.index);
    if (openIdx === -1) {
      desyncs.push({
        tableName,
        line: matchLine,
        reason: "no opening paren after the pgTable( call site",
      });
      continue;
    }
    // Walk parens to find the matching close.
    let depth = 0;
    let endIdx = -1;
    let inString = null;
    let inComment = null; // "line" | "block" | null
    let prevChar = "";
    for (let i = openIdx; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      // Comment tracking MUST come before string tracking. An apostrophe in
      // prose ("the processor's own record") is not a string delimiter, but a
      // naive tracker treats it as one, swallows the rest of the pgTable call
      // including its index callback, and reports a conforming table as having
      // no org-leading index. That false positive cost real debugging time in
      // Wave C and had been "fixed" by banning apostrophes from schema
      // comments — a booby trap for the next author. Skip comments instead.
      if (inComment === "line") {
        if (ch === "\n") inComment = null;
        prevChar = ch;
        continue;
      }
      if (inComment === "block") {
        if (prevChar === "*" && ch === "/") inComment = null;
        prevChar = ch;
        continue;
      }
      if (!inString && ch === "/" && next === "/") {
        inComment = "line";
        prevChar = ch;
        continue;
      }
      if (!inString && ch === "/" && next === "*") {
        inComment = "block";
        prevChar = ch;
        continue;
      }
      // String tracking — skip parens inside strings.
      if (inString) {
        if (ch === inString && prevChar !== "\\") inString = null;
      } else {
        if (ch === '"' || ch === "'" || ch === "`") inString = ch;
        else if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      prevChar = ch;
    }
    if (endIdx === -1) {
      // The walk ran to EOF without closing. Report the table by name — never
      // drop it. Whatever state the walker ended in is the best clue available
      // to whoever has to fix the schema or this parser.
      desyncs.push({
        tableName,
        line: matchLine,
        reason:
          `paren walk from the pgTable( call ran to end-of-file without balancing ` +
          `(ended depth ${depth}` +
          (inString ? `, still inside a ${inString === "`" ? "template literal" : "string"} opened with ${inString}` : "") +
          (inComment ? `, still inside a ${inComment} comment` : "") +
          `)`,
      });
      continue;
    }
    const body = source.slice(openIdx + 1, endIdx);
    blocks.push({ tableName, body, line: matchLine });
  }
  return { blocks, desyncs };
}

// ----------------------------------------------------------------------------
// Column + index detectors
// ----------------------------------------------------------------------------

/**
 * The tenant key is spelled TWO ways in this schema, and until 2026-09-04 this
 * gate only knew one of them.
 *
 * The header used to list `orgId` under "Limitations … raise to the team if
 * they become real". It was real the whole time: 39 pgTables key their tenant
 * on `orgId: integer("org_id")` rather than the canonical
 * `organizationId: integer("organization_id")` — a seventh of the org-scoped
 * population — and every one of them failed `hasOrganizationIdColumn` and was
 * `continue`d before the index rule ran. Eleven had no index leading on the
 * tenant key at all; two (`borrower_messages`, `personal_bests`) carry a NOT
 * NULL FK to organizations.id and declare no index callback whatsoever, so
 * every per-tenant read on them is a full table scan.
 *
 * This is the same front-door blindness `check-org-scoped-fetch.mjs` had when
 * it keyed on `.from(` and could not see Drizzle's relational API: not a rule
 * that was wrong, a POPULATION that was smaller than the claim made about it.
 *
 * Returns the ACCESSOR the table uses (`organizationId` / `orgId`), because
 * the index check downstream must look for the same name the column declared —
 * a table keyed on `orgId` indexes `table.orgId`, and asking for
 * `table.organizationId` there would report every one of them as an offender.
 */
const TENANT_KEY_SPELLINGS = [
  { accessor: "organizationId", column: "organization_id" },
  { accessor: "orgId", column: "org_id" },
];

function tenantKeyAccessor(body) {
  // Look for a property declaration like
  //   organizationId: integer("organization_id")…
  //   orgId: uuid("org_id")…
  // Robust to whitespace + line breaks.
  for (const { accessor, column } of TENANT_KEY_SPELLINGS) {
    const re = new RegExp(`\\b${accessor}\\s*:\\s*[a-zA-Z_]+\\s*\\(\\s*["'\`]${column}["'\`]`);
    if (re.test(body)) return accessor;
  }
  return null;
}

/**
 * Find every `index("…").on(table.X, table.Y, …)` and
 * `uniqueIndex("…").on(table.X, table.Y, …)` call in the body and return the
 * list of leading column accessors.
 */
function extractIndexLeadingColumns(body) {
  const leads = [];
  // Match index("name") or uniqueIndex("name") followed by .on( … )
  const re = /\b(?:index|uniqueIndex)\s*\(\s*["'`][^"'`]+["'`]\s*\)\s*\.on\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const argList = m[1].trim();
    if (argList.length === 0) continue;
    // First arg is the leading column — strip optional `asc()/desc()` wrappers.
    const firstArg = argList.split(",")[0].trim();
    // Accept `table.X`, `t.X`, `tbl.X` — match a trailing identifier.
    const idMatch = firstArg.match(/\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\)?$/);
    if (idMatch) leads.push(idMatch[1]);
  }
  return leads;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main() {
  const files = findSchemaFiles();
  const newOffenders = [];
  const baselineOffenders = [];
  const seenInBaseline = new Set();
  let scannedTables = 0;
  let orgScopedTables = 0;
  /**
   * Per-SPELLING population. The aggregate floor cannot tell "both spellings
   * are being read" from "one spelling is being read and the other silently
   * stopped matching" — the second reads as a healthy 364 while 40 tables go
   * unjudged, which is exactly the state this gate shipped in for months. Each
   * spelling therefore carries its own floor below.
   */
  const orgScopedByKey = Object.create(null);
  let conformingTables = 0;

  const parserDesyncs = [];

  for (const file of files) {
    const rel = file.replace(REPO_ROOT + "/", "");
    const source = readFileSync(file, "utf8");
    const { blocks, desyncs } = extractPgTableBlocks(source);
    for (const d of desyncs) parserDesyncs.push({ ...d, file: rel });
    for (const { tableName, body, line } of blocks) {
      scannedTables += 1;
      const tenantKey = tenantKeyAccessor(body);
      if (!tenantKey) continue;
      orgScopedTables += 1;
      orgScopedByKey[tenantKey] = (orgScopedByKey[tenantKey] ?? 0) + 1;
      const leads = extractIndexLeadingColumns(body);
      // Ask for the SPELLING THIS TABLE USED. A table keyed on `orgId`
      // indexes `table.orgId`; looking for `table.organizationId` there would
      // report all 39 of them as offenders on the gate's own vocabulary.
      const leadsOnOrg = leads.includes(tenantKey);
      if (leadsOnOrg) {
        conformingTables += 1;
        continue;
      }
      const entry = {
        file: rel,
        line,
        tableName,
        leadingColumns: leads,
      };
      if (BASELINE_OFFENDERS.has(tableName)) {
        baselineOffenders.push(entry);
        seenInBaseline.add(tableName);
      } else {
        newOffenders.push(entry);
      }
    }
  }

  // Detect stale allowlist entries — a table that was offending in the
  // baseline but has since been fixed or removed should no longer appear in
  // BASELINE_OFFENDERS. We FAIL on stale entries too so the ratchet is
  // enforced both directions: no new offenders + no dead allowlist entries.
  const staleAllowlistEntries = [];
  for (const name of BASELINE_OFFENDERS) {
    if (!seenInBaseline.has(name)) staleAllowlistEntries.push(name);
  }

  // ── Vacuity guards — evaluated BEFORE any count may read as clean ────────
  const hardFailures = [];

  const relFiles = new Set(files.map((f) => f.replace(REPO_ROOT + "/", "")));
  const missingAnchors = ANCHOR_SCHEMA_FILES.filter((f) => !relFiles.has(f));
  if (missingAnchors.length > 0) {
    hardFailures.push(
      `ANCHOR FILE(S) NOT DISCOVERED — ${missingAnchors.join(", ")} ` +
        `(found ${ANCHOR_SCHEMA_FILES.length - missingAnchors.length}/${ANCHOR_SCHEMA_FILES.length}). ` +
        `findSchemaFiles() is no longer reaching the schema, so every count below is measuring ` +
        `a tree that is not this repo's schema. Fix the discovery walk — do not delete the anchor.`,
    );
  }

  const floors = [
    ["schema files", files.length, MIN_SCHEMA_FILES, "84 on 2026-08-16"],
    ["pgTable blocks", scannedTables, MIN_PGTABLE_BLOCKS, "746 on 2026-08-16"],
    ["org-scoped tables", orgScopedTables, MIN_ORG_SCOPED_TABLES, "364 on 2026-08-16"],
    ["conforming tables", conformingTables, MIN_CONFORMING_TABLES, "217 on 2026-08-16"],
    // Per-spelling, so a regex that stops matching ONE tenant-key name fails
    // here instead of quietly shrinking the population under a healthy total.
    [
      "org-scoped tables keyed on organizationId",
      orgScopedByKey.organizationId ?? 0,
      MIN_TENANT_KEY_TABLES.organizationId,
      "364 on 2026-09-04",
    ],
    [
      "org-scoped tables keyed on orgId",
      orgScopedByKey.orgId ?? 0,
      MIN_TENANT_KEY_TABLES.orgId,
      "40 on 2026-09-04",
    ],
  ];
  for (const [label, observed, floor, measured] of floors) {
    if (observed < floor) {
      hardFailures.push(
        `VACUOUS SCAN — ${label}: ${observed} (floor ${floor}; live was ${measured}). ` +
          `Every count this gate acts on is a count of BAD THINGS FOUND, so a scan that stopped ` +
          `seeing schema reports zero offenders and reads as PASS. Fix the SCAN. If a real ` +
          `deletion wave earned this drop, lower the floor in the same commit and name the wave.`,
      );
    }
  }

  if (parserDesyncs.length > 0) {
    hardFailures.push(
      `PARSER DESYNC — ${parserDesyncs.length} pgTable call site(s) could not be parsed and were ` +
        `therefore NOT in any count above. A table the walker cannot read looks exactly like a ` +
        `table that conforms, which is why this is a failure and not a skip:\n` +
        parserDesyncs
          .map(
            (d) =>
              `        · ${d.file}:${d.line} — pgTable("${d.tableName}"): ${d.reason}`,
          )
          .join("\n") +
        `\n      Fix the schema (an unterminated string / an unbalanced paren inside a template ` +
        `literal is the usual cause) or teach the walker the construct. Do not restore the silent skip.`,
    );
  }

  // Always print a summary so the run is auditable.
  console.log(
    `[check-org-leading-index] scanned ${scannedTables} pgTable blocks ` +
      `across ${files.length} schema files`,
  );
  console.log(
    `[check-org-leading-index] org-scoped: ${orgScopedTables}, ` +
      `conforming: ${conformingTables}, ` +
      `baseline (allowlisted): ${baselineOffenders.length}, ` +
      `new offenders: ${newOffenders.length}, ` +
      `stale allowlist entries: ${staleAllowlistEntries.length}`,
  );
  console.log(
    `[check-org-leading-index] populations vs floors: schema files ${files.length} ` +
      `(floor ${MIN_SCHEMA_FILES}), pgTable blocks ${scannedTables} (floor ${MIN_PGTABLE_BLOCKS}), ` +
      `org-scoped ${orgScopedTables} (floor ${MIN_ORG_SCOPED_TABLES}; ` +
      `organizationId ${orgScopedByKey.organizationId ?? 0}/${MIN_TENANT_KEY_TABLES.organizationId}, ` +
      `orgId ${orgScopedByKey.orgId ?? 0}/${MIN_TENANT_KEY_TABLES.orgId}), ` +
      `conforming ${conformingTables} (floor ${MIN_CONFORMING_TABLES}); ` +
      `anchors found ${ANCHOR_SCHEMA_FILES.length - missingAnchors.length}/${ANCHOR_SCHEMA_FILES.length}; ` +
      `parser desyncs ${parserDesyncs.length} (must be 0)`,
  );

  if (
    newOffenders.length === 0 &&
    staleAllowlistEntries.length === 0 &&
    hardFailures.length === 0
  ) {
    console.log("[check-org-leading-index] PASS");
    process.exit(0);
  }

  if (hardFailures.length > 0) {
    console.error("");
    console.error(
      "[check-org-leading-index] FAIL — the scan itself cannot be trusted, so the counts " +
        "above mean nothing:",
    );
    for (const f of hardFailures) console.error(`  ✗ ${f}`);
    console.error("");
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[check-org-leading-index] FAIL — the following NEW pgTable " +
        "declarations have a TENANT KEY column but no composite index " +
        "leading with it. Add an " +
        "`index(\"<table>_org_…_idx\").on(table.<tenantKey>, …)` covering the " +
        "dominant query pattern — using the SAME spelling the table declared, " +
        "`organizationId` or `orgId` — then mirror the index in " +
        "scripts/migrate.mjs.",
    );
    console.error("");
    for (const off of newOffenders) {
      console.error(
        `  - ${off.file}:${off.line} — pgTable("${off.tableName}")`,
      );
      if (off.leadingColumns.length > 0) {
        console.error(
          `      leading columns observed: ${off.leadingColumns.join(", ")}`,
        );
      } else {
        console.error("      no indexes declared inline");
      }
    }
    console.error("");
  }

  if (staleAllowlistEntries.length > 0) {
    console.error("");
    console.error(
      "[check-org-leading-index] FAIL — the following entries in " +
        "BASELINE_OFFENDERS no longer exist (or have been fixed). Remove " +
        "them from the allowlist to tighten the ratchet:",
    );
    for (const name of staleAllowlistEntries) {
      console.error(`  - "${name}"`);
    }
    console.error("");
  }

  process.exit(1);
}

main();
