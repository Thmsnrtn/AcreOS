/**
 * server/ai/supportToolScopes.ts — the permission ladder, on the SECOND switch.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `server/ai/tools.ts` gates every intent on the scope it declares
 * (`scopeForIntent` → `userHasScope`), and its own comment says exactly why:
 * the REST door for an operation could require `tenant_pii_write` while the
 * Pax door for the SAME operation required nothing at all, and a member could
 * reach it by typing a sentence.
 *
 * That gate was installed on ONE dispatch switch. `executeSupportTool` in
 * `supportAgent.ts` is the other one — 91 case labels, driven by a model — and
 * it had no scope check of any kind. It is reachable by any authenticated org
 * member: `POST /api/support/tickets/:id/pax-resolve` sits behind
 * `isAuthenticated, getOrCreateOrg` and runs the ticket end-to-end through
 * `paxSupportResolver`, which calls `executeSupportTool` directly.
 *
 * This is CLAUDE.md's third law in its purest form. The rule was real, the
 * enforcement was real, and the population it was installed over was one file.
 * `paxToolsReportRealEffects` has the identical story about the identical
 * switch, which is why the population is derived here rather than typed.
 *
 * ── WHO THE CALLER IS ───────────────────────────────────────────────────────
 * Pax resolving a ticket acts ON BEHALF OF the person who filed it, so the
 * ladder is checked against THAT person: `support_tickets.userId` is NOT NULL
 * and the resolver passes it. Pax must never be able to do more for someone
 * than they could do themselves — the whole confused-deputy problem in one
 * sentence.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────
 * Only tools on `PAUSE_SAFE_SUPPORT_TOOLS` (the read-only set) are ungated. A
 * side-effecting tool with NO declared scope is REFUSED, so adding a 22nd
 * mutating case without classifying it fails at runtime and in
 * `supportToolsHonorThePermissionLadder.test.ts` — rather than shipping an
 * ungated capability, which is precisely how this hole was made.
 */

import type { Scope } from "../middleware/roleScope";

/**
 * Scope required to run each side-effecting support tool.
 *
 * Read-only tools are not listed and are not gated — they are the
 * `PAUSE_SAFE_SUPPORT_TOOLS` set, and the test derives the two populations
 * from the source so they cannot drift apart.
 *
 * Assignments follow the ladder's own definitions in
 * `server/middleware/roleScope.ts`:
 *   financial_write — money: invoices, payment methods, billing state
 *   settings_write  — org configuration and preferences (owner/admin only)
 *   comms_write     — anything that sends to a person
 *   deal_write      — records in the pipeline
 */
export const SUPPORT_TOOL_SCOPES: Readonly<Record<string, Scope>> = {
  // ── Money ────────────────────────────────────────────────────────────────
  // Billing state and anything that moves or re-bills a customer's money.
  // `apply_credit` is additionally model-unreachable (a concession on what the
  // customer pays AcreOS is the founder's pricing hard-stop, refused before
  // any gate); it is declared here so the registry is complete over the
  // switch and the refusal is not the only thing standing in front of it.
  resync_stripe: "financial_write",
  apply_billing_fix: "financial_write",
  retry_payment: "financial_write",
  send_update_payment_link: "financial_write",
  cancel_pending_invoice: "financial_write",
  apply_credit: "financial_write",

  // ── Org configuration ────────────────────────────────────────────────────
  // `settings_write` is owner/admin only, which is the right bar for wiping
  // another person's preferences or re-running onboarding for a whole org.
  reset_onboarding: "settings_write",
  reset_notification_preferences: "settings_write",
  reset_ai_settings: "settings_write",
  reset_user_preferences: "settings_write",

  // ── Platform operations ──────────────────────────────────────────────────
  // Bulk fixes, data-integrity repairs and job-queue surgery are the most
  // consequential things on this switch and had the least protection. Held at
  // the owner/admin bar deliberately: "the org did it" is not an answer
  // anyone can give about a bulk mutation.
  fix_common_issue: "settings_write",
  apply_bulk_fix: "settings_write",
  fix_data_integrity_issue: "settings_write",
  apply_self_healing_fix: "settings_write",
  resolve_alert: "settings_write",
  retry_failed_jobs: "settings_write",
  unlock_stuck_jobs: "settings_write",

  // ── Outbound ─────────────────────────────────────────────────────────────
  send_proactive_warning: "comms_write",
  schedule_proactive_outreach: "comms_write",

  // ── Records ──────────────────────────────────────────────────────────────
  create_followup_task: "deal_write",
  enrich_property_coordinates: "deal_write",
};

/**
 * The scope a side-effecting support tool requires, or `undefined` when the
 * tool is not declared. `undefined` is NOT "no scope needed" — the caller
 * refuses on it. Read-only tools never reach this function.
 */
export function supportScopeFor(toolName: string): Scope | undefined {
  return SUPPORT_TOOL_SCOPES[toolName];
}

/** Refusal for a side-effecting support tool nobody classified. */
export function undeclaredSupportScopeMessage(toolName: string): string {
  return (
    `"${toolName}" changes something and has no declared permission, so it was not run. ` +
    `A side-effecting support capability must name the permission it requires ` +
    `(server/ai/supportToolScopes.ts) before Pax can use it.`
  );
}

/** Refusal for a caller who does not hold the tool's declared scope. */
export function supportScopeRefusalMessage(toolName: string, scope: Scope): string {
  return (
    `You do not have permission to do that here. "${toolName}" requires the ` +
    `"${scope}" permission in this workspace. An owner or admin can grant it ` +
    `under Settings → Team.`
  );
}
