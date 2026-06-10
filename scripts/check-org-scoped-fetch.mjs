#!/usr/bin/env node
// ============================================================================
// scripts/check-org-scoped-fetch.mjs
// ----------------------------------------------------------------------------
// Tier 1F tenancy-by-construction ratchet lint — flags storage-layer methods
// that query an ORG-SCOPED table without any organization context.
//
// Why
// ───
// The Tier 1F conversion (elevation blueprint 2026-06-10) moved the
// highest-risk fetch-by-bare-id storage methods onto the org-scoped
// repository layer (`forOrg()` in server/utils/orgScopedDb.ts), so a
// cross-tenant id resolves to "not found" by construction. This lint keeps
// the ratchet from sliding back: any NEW storage method that selects /
// updates / deletes against a table carrying an `organizationId` column,
// while its signature+body never mentions an org identifier, fails CI.
//
// Heuristic
// ─────────
// No TypeScript execution — focused regex passes, same family as
// check-org-leading-index.mjs:
//
//   1. Parse shared/schema*.ts for `export const <ident> = pgTable("<name>",…)`
//      blocks and record the TS identifiers of tables that declare an
//      `organizationId` column ("org-scoped tables").
//   2. Walk server/storage.ts + server/storage/*.ts. For every
//      `async <method>(…) { … }` (brace-matched), collect the org-scoped
//      table identifiers it touches via `from(<ident>)`,
//      `db.update(<ident>)`, or `db.delete(<ident>)`.
//   3. If the method touches at least one org-scoped table and the method
//      text (signature + body) contains NO org context marker
//      (`organizationId`, `orgId`, `forOrg(`, `unscopedForPlatformOps(`),
//      it is an offender.
//
// `unscopedForPlatformOps(reason)` is the sanctioned escape hatch — it is
// greppable and logs its reason, so methods using it are intentionally
// exempt here (the audit surface is the grep, not this lint).
//
// Exit codes
// ──────────
//   0 — no NEW offenders and no stale allowlist entries
//   1 — at least one NEW offender, or a stale baseline entry (ratchet is
//        enforced both directions)
//
// Baseline allowlist
// ──────────────────
// Pre-existing offenders are frozen below so the lint can land NOW and block
// regressions. The list only ratchets DOWN: to remove an entry, convert the
// method to take an org id (preferably via `forOrg(...)`) or route it
// through `unscopedForPlatformOps(reason)` if it is a genuine platform op,
// then delete the entry. NEW entries require Iris-CTO sign-off.
//
// Known limitations (documented, raise if they become real):
//   - A method that ACCEPTS an orgId but forgets to apply the predicate is
//     not caught (text-level heuristic). The vitest suite covers the
//     converted methods' emitted SQL instead.
//   - Tables queried through helper indirection (variable holding the table)
//     are missed. Not a pattern in storage today.
// ============================================================================

const BASELINE_OFFENDERS = new Set([
  "server/storage.ts::acknowledgeAlert",
  "server/storage.ts::acknowledgeAllAlerts",
  "server/storage.ts::cleanExpiredBorrowerSessions",
  "server/storage.ts::countFieldScoutVisits",
  "server/storage.ts::createMessage",
  "server/storage.ts::createPaxProjectFile",
  "server/storage.ts::deleteBorrowerSession",
  "server/storage.ts::deletePaxProjectFile",
  "server/storage.ts::findOrganizationIntegrationByCredential",
  "server/storage.ts::getAbTestByCampaign",
  "server/storage.ts::getAdPostingsByProperty",
  "server/storage.ts::getAdminDashboardData",
  "server/storage.ts::getAgentFeedbackByTask",
  "server/storage.ts::getAllFeatureRequestsForFounder",
  "server/storage.ts::getAllOrganizations",
  "server/storage.ts::getBorrowerSession",
  "server/storage.ts::getBuyerPrequalificationByLead",
  "server/storage.ts::getCampaignByTrackingCode",
  "server/storage.ts::getCampaignResponsesCount",
  "server/storage.ts::getCollectionEnrollmentsByNote",
  "server/storage.ts::getCollectionEnrollmentsBySequence",
  "server/storage.ts::getDocumentSignatures",
  "server/storage.ts::getDueDiligenceChecklist",
  "server/storage.ts::getDueScheduledTasks",
  "server/storage.ts::getEmailSenderIdentityByEmail",
  "server/storage.ts::getEscalatedCases",
  "server/storage.ts::getFieldScoutPhotosByLead",
  "server/storage.ts::getFieldScoutPhotosByVisit",
  "server/storage.ts::getFieldScoutVisit",
  "server/storage.ts::getFieldScoutVisits",
  "server/storage.ts::getMessages",
  "server/storage.ts::getOrganizationsInDunning",
  "server/storage.ts::getParcelSnapshot",
  "server/storage.ts::getPaxScheduledTasksDue",
  "server/storage.ts::getPendingReminders",
  "server/storage.ts::getRecurringTasksDue",
  "server/storage.ts::getRemindersForNote",
  "server/storage.ts::getScheduledTask",
  "server/storage.ts::getSellerCommunicationsByLead",
  "server/storage.ts::getVaAction",
  "server/storage.ts::incrementMailingOrderPieces",
  "server/storage.ts::markNotificationRead",
  "server/storage.ts::resolveAlert",
  "server/storage.ts::resolveAllAlerts",
  "server/storage.ts::seedSystemTemplates",
  "server/storage.ts::setConversationProject",
  "server/storage.ts::updateBorrowerSessionAccess",
  "server/storage.ts::updateSystemAlert",
  "server/storage.ts::upsertParcelSnapshot",
  "server/storage/campaignRepo.ts::getCampaignOptimizations",
  "server/storage/campaignRepo.ts::markOptimizationImplemented",
  "server/storage/dealRepo.ts::_autoGenerateClosingChecklist",
  "server/storage/leadRepo.ts::getLeadActivities",
  "server/storage/orgRepo.ts::getOrganization",
  "server/storage/orgRepo.ts::getOrganizationByOwner",
  "server/storage/orgRepo.ts::getOrganizationBySlug",
  "server/storage/orgRepo.ts::getOrganizationByStripeCustomerId",
  "server/storage/orgRepo.ts::updateOrganization",
]);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");
const SERVER_DIR = join(REPO_ROOT, "server");

// ----------------------------------------------------------------------------
// Schema discovery — org-scoped table identifiers
// ----------------------------------------------------------------------------

function findSchemaFiles() {
  const files = [];
  for (const entry of readdirSync(SHARED_DIR)) {
    const full = join(SHARED_DIR, entry);
    if (!statSync(full).isFile()) continue;
    if (entry === "schema.ts") files.push(full);
    else if (entry.startsWith("schema-") && entry.endsWith(".ts")) files.push(full);
  }
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

/** Walk parens from `openIdx` (an opening "(") to its match. */
function matchParen(source, openIdx) {
  let depth = 0;
  let inString = null;
  let prevChar = "";
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") inString = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    prevChar = ch;
  }
  return -1;
}

/** Walk braces from `openIdx` (an opening "{") to its match. */
function matchBrace(source, openIdx) {
  let depth = 0;
  let inString = null;
  let prevChar = "";
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") inString = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    prevChar = ch;
  }
  return -1;
}

/**
 * Returns Map<tsIdentifier, tableName> for every exported pgTable whose
 * column map declares an `organizationId` column.
 */
function collectOrgScopedTableIdents() {
  const idents = new Map();
  const callRe = /\bexport\s+const\s+([A-Za-z0-9_]+)\s*=\s*pgTable\s*\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
  for (const file of findSchemaFiles()) {
    const source = readFileSync(file, "utf8");
    let match;
    while ((match = callRe.exec(source)) !== null) {
      const [, ident, tableName] = match;
      const openIdx = source.indexOf("(", match.index + match[0].indexOf("pgTable"));
      if (openIdx === -1) continue;
      const endIdx = matchParen(source, openIdx);
      if (endIdx === -1) continue;
      const body = source.slice(openIdx + 1, endIdx);
      if (/\borganizationId\s*:\s*[a-zA-Z_]+\s*\(\s*["'`]organization_id["'`]/.test(body)) {
        idents.set(ident, tableName);
      }
    }
  }
  return idents;
}

// ----------------------------------------------------------------------------
// Storage-method scanner
// ----------------------------------------------------------------------------

function findStorageFiles() {
  const files = [join(SERVER_DIR, "storage.ts")];
  const subdir = join(SERVER_DIR, "storage");
  if (statSync(subdir, { throwIfNoEntry: false })?.isDirectory()) {
    for (const entry of readdirSync(subdir)) {
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
      files.push(join(subdir, entry));
    }
  }
  return files.sort();
}

/**
 * Extract every `async <name>(…) { … }` method from a source file as
 * { name, text (signature+body), line }.
 */
function extractAsyncMethods(source) {
  const methods = [];
  const methodRe = /\basync\s+([A-Za-z0-9_]+)\s*(?:<[^>(]*>)?\s*\(/g;
  let match;
  while ((match = methodRe.exec(source)) !== null) {
    const name = match[1];
    const parenOpen = source.indexOf("(", match.index + match[0].length - 1);
    if (parenOpen === -1) continue;
    const parenClose = matchParen(source, parenOpen);
    if (parenClose === -1) continue;
    // Find the method-body opening brace (skip return-type annotation).
    const braceOpen = source.indexOf("{", parenClose);
    if (braceOpen === -1) continue;
    const between = source.slice(parenClose + 1, braceOpen);
    // If something other than a return-type annotation sits between the
    // params and the brace (e.g. we ran into the next statement), skip.
    if (/[;=]/.test(between) && !/=>/.test(between)) continue;
    const braceClose = matchBrace(source, braceOpen);
    if (braceClose === -1) continue;
    const text = source.slice(match.index, braceClose + 1);
    const line = source.slice(0, match.index).split("\n").length;
    methods.push({ name, text, line });
    // Resume scanning after the signature (methods can nest async callbacks —
    // we deliberately continue from the params close so inner `async (…)`
    // arrow callbacks aren't double-counted as named methods).
    methodRe.lastIndex = parenClose;
  }
  return methods;
}

const ORG_CONTEXT_RE = /organizationId|orgId|forOrg\s*\(|unscopedForPlatformOps\s*\(/;

function touchedOrgScopedTables(methodText, orgScopedIdents) {
  const touched = new Set();
  const accessRe = /\b(?:from|(?:db|tx)\s*\.\s*update|(?:db|tx)\s*\.\s*delete)\s*\(\s*([A-Za-z0-9_]+)\s*[),]/g;
  let m;
  while ((m = accessRe.exec(methodText)) !== null) {
    const ident = m[1];
    if (orgScopedIdents.has(ident)) touched.add(ident);
  }
  return [...touched];
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main() {
  const orgScopedIdents = collectOrgScopedTableIdents();
  const storageFiles = findStorageFiles();

  const newOffenders = [];
  const baselineSeen = new Set();
  let scannedMethods = 0;
  let methodsTouchingOrgTables = 0;
  let conformingMethods = 0;

  for (const file of storageFiles) {
    const rel = file.replace(REPO_ROOT + "/", "");
    const source = readFileSync(file, "utf8");
    for (const method of extractAsyncMethods(source)) {
      scannedMethods += 1;
      const touched = touchedOrgScopedTables(method.text, orgScopedIdents);
      if (touched.length === 0) continue;
      methodsTouchingOrgTables += 1;
      if (ORG_CONTEXT_RE.test(method.text)) {
        conformingMethods += 1;
        continue;
      }
      const key = `${rel}::${method.name}`;
      if (BASELINE_OFFENDERS.has(key)) {
        baselineSeen.add(key);
      } else {
        newOffenders.push({ key, file: rel, line: method.line, name: method.name, touched });
      }
    }
  }

  const staleAllowlistEntries = [...BASELINE_OFFENDERS].filter((k) => !baselineSeen.has(k));

  console.log(
    `[check-org-scoped-fetch] org-scoped tables: ${orgScopedIdents.size}; ` +
      `scanned ${scannedMethods} storage methods across ${storageFiles.length} files`,
  );
  console.log(
    `[check-org-scoped-fetch] touching org tables: ${methodsTouchingOrgTables}, ` +
      `with org context: ${conformingMethods}, ` +
      `baseline (allowlisted): ${baselineSeen.size}, ` +
      `new offenders: ${newOffenders.length}, ` +
      `stale allowlist entries: ${staleAllowlistEntries.length}`,
  );

  if (newOffenders.length === 0 && staleAllowlistEntries.length === 0) {
    console.log("[check-org-scoped-fetch] PASS");
    process.exit(0);
  }

  if (newOffenders.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following NEW storage methods query " +
        "org-scoped tables without any organization context. Convert them to " +
        "take an organizationId (preferably via forOrg() from " +
        "server/utils/orgScopedDb.ts), or — for genuine platform ops — route " +
        "the access through unscopedForPlatformOps(reason).",
    );
    console.error("");
    for (const off of newOffenders) {
      console.error(`  - ${off.file}:${off.line} — ${off.name}() touches: ${off.touched.join(", ")}`);
    }
    console.error("");
  }

  if (staleAllowlistEntries.length > 0) {
    console.error("");
    console.error(
      "[check-org-scoped-fetch] FAIL — the following BASELINE_OFFENDERS entries " +
        "no longer match an offending method (fixed or removed). Delete them " +
        "from the allowlist to tighten the ratchet:",
    );
    for (const key of staleAllowlistEntries) {
      console.error(`  - "${key}"`);
    }
    console.error("");
  }

  process.exit(1);
}

main();
