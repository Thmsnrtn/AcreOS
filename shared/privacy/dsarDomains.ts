/**
 * The declared DSAR domain registry (PKG-1 §4, docs/pkg1-dsar-design-2026-11.md).
 *
 * One decision per personal-data domain, per subject kind: EXPORT it (with the
 * scope of the WHERE clause and what erasure does to it) or EXCLUDE it (with a
 * named basis and a reason the requester sees in the export).
 *
 * Readers:
 *   - server/services/privacy/dsarExporters.ts — runs an exporter for every
 *     `export` decision; copies every `exclude` decision into the export.
 *   - server/services/gdprService.ts eraseDsarSubject — derives `retained`
 *     from every `retain` erasure action (never hand-written).
 *   - tests/unit/dsarDomainCoverage.test.ts — every personal-data candidate
 *     table must appear here or in DSAR_UNDECIDED_TABLES.
 *
 * Pure, no imports. `tables` are SQL table names, not Drizzle identifiers.
 */

export type DsarSubjectKind = "user" | "lead";

export type DsarExclusionBasis =
  | "third_party_data"      // rows are other people's personal data / the org's records, not the subject's
  | "no_subject_link"       // schema has no column linking the table to this subject kind
  | "hash_only"             // stores only a one-way hash of an identifier
  | "secret_material";      // credentials/tokens — never exported

type DsarErasureAction = "anonymize" | "delete" | "retain";

type DsarDomainDecision =
  | {
      domain: string;
      decision: "export";
      subjectKind: DsarSubjectKind;
      tables: readonly string[]; // SQL table names
      scope: string; // one-line description of the WHERE clause
      erasure: { action: DsarErasureAction; reason?: string }; // reason required when action === "retain"
    }
  | {
      domain: string;
      decision: "exclude";
      subjectKind: DsarSubjectKind | "both";
      tables: readonly string[];
      basis: DsarExclusionBasis;
      reason: string;
    };

const S1_RETAIN =
  "loan, 1099-INT and 1098 records require the borrower's identity to be retained (GDPR Art. 17(3)(b)); founder/counsel ruling S-1 pending";
const S2_RETAIN =
  "communications that reference the lead by id are retained; erasure anonymizes the lead's identity anchor, not free-text bodies (recorded gap S-2)";

export const DSAR_DOMAINS: readonly DsarDomainDecision[] = [
  // ─── User subjects (account holders) ──────────────────────────────────────
  {
    domain: "account_profile",
    decision: "export",
    subjectKind: "user",
    tables: ["users"],
    scope: "id = userId; drop password and any SECRET_COLUMNS entry",
    erasure: { action: "anonymize" }, // anonymizeUser step 7
  },
  {
    domain: "team_memberships",
    decision: "export",
    subjectKind: "user",
    tables: ["team_members"],
    scope: "userId = userId",
    erasure: {
      action: "retain",
      reason: "org access record; identifies no one once the account row is anonymized",
    },
  },
  {
    domain: "team_messages",
    decision: "export",
    subjectKind: "user",
    tables: ["team_messages"],
    scope: "senderId = userId",
    erasure: { action: "delete" }, // anonymizeUser step 2
  },
  {
    domain: "support_tickets",
    decision: "export",
    subjectKind: "user",
    tables: ["support_tickets"],
    scope: "userId = userId",
    erasure: { action: "delete" }, // anonymizeUser step 3
  },
  {
    domain: "ai_conversations",
    decision: "export",
    subjectKind: "user",
    tables: ["ai_conversations"],
    scope: "userId = String(userId)",
    erasure: { action: "delete" }, // anonymizeUser step 5a
  },
  {
    domain: "assigned_records",
    decision: "exclude",
    subjectKind: "user",
    tables: ["leads", "deals", "tasks"],
    basis: "third_party_data",
    reason:
      "records of other people and the organization's own work that the user was assigned to; the organization is their controller. Removed from the export (was gdprService.ts exportUserData assigned leads/deals/tasks).",
  },
  {
    domain: "properties_user",
    decision: "exclude",
    subjectKind: "user",
    tables: ["properties"],
    basis: "no_subject_link",
    reason:
      "properties link to people only through sellerId/buyerId → leads (shared/schema.ts); no column references a user account",
  },

  // ─── Lead subjects (account-less people in one org: sellers, buyers, borrowers) ──
  {
    domain: "lead_profile",
    decision: "export",
    subjectKind: "lead",
    tables: ["leads"],
    scope:
      "id = leadId AND organizationId = org; includes the consent flags; taxId ciphertext replaced by taxIdOnFile: boolean",
    erasure: { action: "anonymize" }, // eraseLeadSubject
  },
  {
    domain: "consent_records",
    decision: "export",
    subjectKind: "lead",
    tables: ["lead_consent_events"],
    scope: "leadId = leadId AND organizationId = org",
    erasure: { action: "retain", reason: "legal exhibit of consent; append-only by design" },
  },
  {
    domain: "loan_notes",
    decision: "export",
    subjectKind: "lead",
    tables: ["notes"],
    scope: "borrowerId = leadId AND organizationId = org; drop accessToken (portal credential)",
    erasure: { action: "retain", reason: S1_RETAIN },
  },
  {
    domain: "loan_payments",
    decision: "export",
    subjectKind: "lead",
    tables: ["payments"],
    scope: "organizationId = org AND noteId ∈ loan_notes ids",
    erasure: { action: "retain", reason: "loan/tax records (S-1)" },
  },
  {
    domain: "properties",
    decision: "export",
    subjectKind: "lead",
    tables: ["properties"],
    scope: "organizationId = org AND (sellerId = leadId OR buyerId = leadId)",
    erasure: { action: "retain", reason: "transaction record of the organization" },
  },
  {
    domain: "communications",
    decision: "export",
    subjectKind: "lead",
    tables: [
      "lead_activities",
      "conversations",
      "messages",
      "seller_communications",
      "inbox_messages",
      "borrower_messages",
    ],
    scope:
      "lead_activities / seller_communications / inbox_messages / conversations: leadId = leadId AND organizationId = org; messages: conversationId ∈ those conversations; borrower_messages: noteId ∈ loan_notes AND organizationId = org",
    erasure: { action: "retain", reason: S2_RETAIN },
  },
  {
    domain: "borrower_portal_sessions",
    decision: "export",
    subjectKind: "lead",
    tables: ["borrower_sessions"],
    scope: "noteId ∈ loan_notes AND organizationId = org",
    erasure: { action: "retain", reason: S1_RETAIN },
  },
  {
    domain: "borrower_payment_profiles",
    decision: "export",
    subjectKind: "lead",
    tables: ["borrower_payment_profiles"],
    scope:
      "leadId = leadId AND organizationId = org; SECRET_COLUMNS and any token/processor-reference column dropped",
    erasure: { action: "retain", reason: S1_RETAIN },
  },
  {
    domain: "email_suppressions",
    decision: "export",
    subjectKind: "lead",
    tables: ["email_suppressions"],
    scope: "organizationId = org AND lower(email) = subject email",
    erasure: { action: "retain", reason: "must persist to keep honouring the opt-out" },
  },
  {
    domain: "owner_suppressions",
    decision: "exclude",
    subjectKind: "lead",
    tables: ["owner_suppressions"],
    basis: "hash_only",
    reason:
      "stores a one-way hash per identifier, platform-wide (shared/schema/trust.ts); nothing recoverable to export",
  },
  {
    domain: "activity_events",
    decision: "export",
    subjectKind: "lead",
    tables: ["activity_events"],
    // Design §4: the exporter builder confirms the 'lead' entityType literal
    // and the entityId column type (shared/schema/comms-email.ts). If no
    // 'lead' literal is ever written, convert to exclude / no_subject_link
    // with that evidence.
    scope: "organizationId AND entityType = 'lead' AND entityId = leadId",
    erasure: { action: "retain", reason: S2_RETAIN },
  },
];

/**
 * Named debt register: personal-data candidate tables with NO decision yet.
 * May only shrink. A named list, not a count, so a new table cannot hide
 * behind one that dropped out. Populated by the session that measures the
 * candidate population (tests/unit/dsarDomainCoverage.test.ts, design §4).
 *
 * Measured 2026-11-09 (PKG-1 session B): the §4 candidate predicate run over
 * every PgTable exported from @shared/schema (plus @shared/models/auth) with
 * the repo's own drizzle getTableConfig and shared/data-classification.ts —
 * (a) a column name satisfying looksLikePII, (b) an FK to leads.id/users.id or
 * a lead_id/borrower_id/user_id column, (c) a CLASSIFICATION_REGISTRY entry of
 * pii/sensitive_financial — minus every table named in DSAR_DOMAINS. 138
 * candidates at measurement (DSAR_CANDIDATE_FLOOR); these 122 are undecided.
 * The coverage test re-derives the set at runtime, so this list cannot go
 * stale in either direction. Deciding a table = add it to a DSAR_DOMAINS
 * entry and delete it here; never add a name here to make the test pass.
 */
export const DSAR_UNDECIDED_TABLES: readonly string[] = [
  "acquired_notes",
  "activation_events",
  "activity_log",
  "adjacent_verticals_waitlist",
  "agent_feedback",
  "agent_tasks",
  "ai_injection_attempts",
  "audit_events",
  "audit_log",
  "auth_fail_attempts",
  "autopay_enrollments",
  "buyer_blast_recipients",
  "buyer_prequalifications",
  "buyer_profiles",
  "buyer_reservations",
  "call_transcripts",
  "campaign_delivery_events",
  "campaign_leads",
  "campaign_responses",
  "cancellation_surveys",
  "certificate_verification",
  "chat_tool_cooldowns",
  "churn_reasons",
  "cohort_assignments",
  "community_letters",
  "connected_mailboxes",
  "contractors",
  "county_research",
  "county_subdivision_timelines",
  "course_enrollments",
  "customer_audit_log",
  "data_processing_agreements",
  "dd_assignments",
  "digest_subscriptions",
  "dsar_requests",
  "dsar_requests_lifecycle",
  "email_events",
  "email_sender_identities",
  "entity_comments",
  "error_boundary_trips",
  "escalation_alerts",
  "export_jobs",
  "fcra_attestations",
  "feature_requests",
  "feedback_submissions",
  "field_scout_photos",
  "field_scout_visits",
  "financial_ledger",
  "generated_documents",
  "import_jobs",
  "lead_conversions",
  "lead_emails",
  "lead_qualification_signals",
  "lead_score_history",
  "legal_holds",
  "lender_network",
  "lifecycle_events",
  "lifecycle_message_sends",
  "mail_shipment_pieces",
  "mailing_order_pieces",
  "market_watchlist_entries",
  "marketing_touch",
  "negotiation_threads",
  "note_ownership_splits",
  "notification_preferences",
  "notifications",
  "nps_micro_surveys",
  "nps_prompt_queue",
  "nps_responses",
  "offer_letters",
  "offers",
  "org_co_owners",
  "organization_invitations",
  "organizations",
  "outcome_telemetry",
  "outreach_ab_outcomes",
  "parcel_alerts",
  "pax_drafts",
  "pax_memory",
  "pax_nudges",
  "pax_observations",
  "pax_projects",
  "pax_scheduled_tasks",
  "pax_user_context",
  "payment_reminders",
  "permit_gates",
  "playbook_instances",
  "purpose_ledger",
  "reactivation_surveys",
  "recourse_drafts",
  "referrals",
  "refund_requests",
  "rehab_photos",
  "retention_events",
  "seller_intent_predictions",
  "sequence_enrollments",
  "signatures",
  "signing_consent_audit",
  "signup_signals",
  "skip_traces",
  "support_cases",
  "team_member_presence",
  "tenants",
  "title_orders",
  "title_partners",
  "tutor_sessions",
  "ui_state",
  "unsubscribe_tokens",
  "user_activation_events",
  "user_feedback",
  "user_map_layer_preferences",
  "user_sessions",
  "user_sign_in_locations",
  "va_actions",
  "va_calendar_events",
  "va_sops",
  "va_tasks",
  "verified_email_domains",
  "white_label_configs",
  "whitelabel_tenants",
  "workspace_presets",
  "writing_style_profiles"
];
