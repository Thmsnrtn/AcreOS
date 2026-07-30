#!/usr/bin/env node
// ============================================================================
// scripts/check-org-leading-index.mjs
// ----------------------------------------------------------------------------
// L3 shard-readiness lint — ensures every pgTable declared in shared/schema*.ts
// that exposes an `organizationId` column also declares at least one composite
// index that LEADS with that column.
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
//        allowlist below)
//   1 — at least one offender reported that is NOT in the baseline allowlist
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
//   - Tables that use a column name other than `organizationId` for the FK
//     to `organizations.id` (e.g. `orgId`) aren't picked up — we explicitly
//     require the canonical name.
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
  "automation_executions",
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
  "negotiation_sessions",
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
]);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");

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

function extractPgTableBlocks(source) {
  const blocks = [];
  // Match the literal call site so we can capture the table name and then
  // walk forward to the matching closing paren.
  const callRe = /\bpgTable\s*\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  let match;
  while ((match = callRe.exec(source)) !== null) {
    const tableName = match[1];
    const openIdx = source.indexOf("(", match.index);
    if (openIdx === -1) continue;
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
    if (endIdx === -1) continue;
    const body = source.slice(openIdx + 1, endIdx);
    // Find the line number of the pgTable call for error messages.
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    blocks.push({ tableName, body, line });
  }
  return blocks;
}

// ----------------------------------------------------------------------------
// Column + index detectors
// ----------------------------------------------------------------------------

function hasOrganizationIdColumn(body) {
  // Look for a property declaration like
  //   organizationId: integer("organization_id")…
  // or
  //   organizationId: uuid("organization_id")…
  // Robust to whitespace + line breaks.
  return /\borganizationId\s*:\s*[a-zA-Z_]+\s*\(\s*["'`]organization_id["'`]/.test(
    body,
  );
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
  let conformingTables = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const blocks = extractPgTableBlocks(source);
    for (const { tableName, body, line } of blocks) {
      scannedTables += 1;
      if (!hasOrganizationIdColumn(body)) continue;
      orgScopedTables += 1;
      const leads = extractIndexLeadingColumns(body);
      const leadsOnOrg = leads.includes("organizationId");
      if (leadsOnOrg) {
        conformingTables += 1;
        continue;
      }
      const entry = {
        file: file.replace(REPO_ROOT + "/", ""),
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

  if (newOffenders.length === 0 && staleAllowlistEntries.length === 0) {
    console.log("[check-org-leading-index] PASS");
    process.exit(0);
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[check-org-leading-index] FAIL — the following NEW pgTable " +
        "declarations have an `organizationId` column but no composite " +
        "index leading with it. Add an " +
        "`index(\"<table>_org_…_idx\").on(table.organizationId, …)` " +
        "covering the dominant query pattern, then mirror the index in " +
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
