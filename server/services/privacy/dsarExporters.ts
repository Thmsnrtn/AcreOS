/**
 * DSAR export execution (PKG-1 §4, docs/pkg1-dsar-design-2026-11.md).
 *
 * `shared/privacy/dsarDomains.ts` DECLARES every personal-data domain per
 * subject kind; this module EXECUTES it. `buildSubjectExport` iterates the
 * registry: it runs `DSAR_EXPORTERS[domain]` for every `export` decision of
 * the subject's kind, and copies every `exclude` decision into
 * `exclusions`, so the requester sees what was left out and why.
 *
 * Refuse-not-fabricate:
 *   - a declared `export` domain with no exporter THROWS — never an empty
 *     array that would read as "nothing found";
 *   - a domain reaching MAX_EXPORT_RECORDS throws ExportTooLargeError (413
 *     via Errors.internal's name mapping) — never a silent truncation.
 *
 * Tenant isolation: every lead-subject query is filtered by
 * `organizationId = subject.organizationId` (borrower_messages: `orgId`), or
 * joins through an id set that was itself org-filtered (the gate's
 * org-scoped `noteIds`, this module's org-scoped conversation ids) AND
 * carries the org filter as well. A lead subject is one person in ONE org.
 *
 * Secret hygiene: every row passes through `omitSecretColumns` for its table
 * (server/utils/secretColumns.ts), plus the design §4 per-domain drops:
 *   - account_profile drops `password` (defensive — the users table has no
 *     such column today; identity is Clerk's) and every SECRET_COLUMNS entry
 *     (passwordResetToken);
 *   - lead_profile replaces the taxId ciphertext with `taxIdOnFile: boolean`
 *     (taxIdType, also registered, is dropped);
 *   - loan_notes drops `accessToken` (portal credential);
 *   - borrower_portal_sessions drops `sessionToken` (registered secret);
 *   - borrower_payment_profiles drops SECRET_COLUMNS entries (none registered
 *     today) and the processor references stripeCustomerId,
 *     stripeConnectAccountId, defaultPaymentMethodId.
 *
 * activity_events scope evidence (design §4 asks the builder to confirm the
 * 'lead' literal): `entityType` is `text("entity_type")` with comment
 * "lead, property, deal" and `entityId` is `integer("entity_id")`
 * (shared/schema/comms-email.ts:559-560). `entityType: "lead"` IS written to
 * activity_events — server/routes.ts:1192-1198 calls
 * `storage.createActivityEvent({ organizationId, entityType: "lead",
 * entityId: leadId, eventType: "contact_recorded", ... })`, and
 * server/services/activityLogger.ts logEvent → storage.createActivityEvent
 * takes entityType "lead" | "property" | "deal". So the exporter ships as
 * designed (no fallback to exclude).
 *
 * No mail or SMS imports: an export is a file handed to the founder; AcreOS
 * sends nothing.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../../db";
import {
  activityEvents,
  aiConversations,
  borrowerMessages,
  borrowerPaymentProfiles,
  borrowerSessions,
  conversations,
  emailSuppressions,
  inboxMessages,
  leadActivities,
  leadConsentEvents,
  leads,
  messages,
  notes,
  payments,
  properties,
  sellerCommunications,
  supportTickets,
  teamMembers,
  teamMessages,
  users,
} from "@shared/schema";
import {
  DSAR_DOMAINS,
  type DsarExclusionBasis,
  type DsarSubjectKind,
} from "@shared/privacy/dsarDomains";
import { DSAR_IDENTITY_POSTURE } from "@shared/privacy/dsarIdentityPosture";
import { omitSecretColumns } from "../../utils/secretColumns";
import { clock } from "../../utils/clock";
import type { DsarSubject } from "./dsarActionGate";

/**
 * Safety cap per domain. Module-private: it mirrors gdprService.ts's exported
 * MAX_EXPORT_RECORDS export cap (keep the two equal). Not imported from there
 * because gdprService imports this module for buildSubjectExport (no cycle).
 */
const MAX_EXPORT_RECORDS = 100_000;

/**
 * Deviation from the build brief (code facts): the existing
 * `class ExportTooLargeError` lives in server/storage/wholeBookReads.ts, is
 * NOT exported, and hard-codes that module's 250,000-row ceiling in its
 * message — so it cannot be imported, and that file is outside this
 * session's edit set. This class carries the SAME name and statusCode, so
 * Errors.internal's name-based mapping (server/utils/errors.ts,
 * `error.name === "ExportTooLargeError"` → 413 EXPORT_TOO_LARGE) treats it
 * identically. gdprService re-exports it. Consolidating the two into one
 * exported class is a follow-up for whoever owns wholeBookReads.ts.
 */
export class ExportTooLargeError extends Error {
  /** 413: surfaced as-is by the error handler instead of a generic 500. */
  readonly statusCode = 413;
  constructor(kind: string) {
    super(
      `This ${kind} export reached the ${MAX_EXPORT_RECORDS.toLocaleString()}-record cap — contact support for a bulk export; nothing was truncated.`,
    );
    this.name = "ExportTooLargeError";
  }
}

export interface DsarSubjectExport {
  exportedAt: string;
  subject: { kind: DsarSubjectKind; userId?: string; organizationId?: number; leadId?: number };
  /** DSAR_IDENTITY_POSTURE.id */
  posture: string;
  domains: Record<string, unknown[]>;
  /** Kept: the generate-export audit row reads it. */
  totalRecords: Record<string, number>;
  exclusions: Array<{ domain: string; basis: DsarExclusionBasis; reason: string }>;
}

type UserSubject = Extract<DsarSubject, { kind: "user" }>;
type LeadSubject = Extract<DsarSubject, { kind: "lead" }>;

function asUser(s: DsarSubject, domain: string): UserSubject {
  if (s.kind !== "user") throw new Error(`DSAR exporter "${domain}" is a user-subject domain; got a ${s.kind} subject`);
  return s;
}

function asLead(s: DsarSubject, domain: string): LeadSubject {
  if (s.kind !== "lead") throw new Error(`DSAR exporter "${domain}" is a lead-subject domain; got a ${s.kind} subject`);
  return s;
}

/** Throw rather than truncate (refuse-not-fabricate). */
function capped<T>(domain: string, rows: T[]): T[] {
  if (rows.length >= MAX_EXPORT_RECORDS) throw new ExportTooLargeError(`DSAR "${domain}"`);
  return rows;
}

/** A copy of `row` without the table's registered secrets and the named keys. */
function clean<T extends object>(table: PgTable, row: T, extraDrops: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(omitSecretColumns(table, row) as Record<string, unknown>) };
  for (const key of extraDrops) delete out[key];
  return out;
}

/** Processor references on a borrower payment profile — never exported. */
const PAYMENT_PROFILE_PROCESSOR_KEYS = [
  "stripeCustomerId",
  "stripeConnectAccountId",
  "defaultPaymentMethodId",
] as const;

/** Org-filtered conversation ids for a lead subject. */
async function leadConversationIds(s: LeadSubject): Promise<number[]> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.leadId, s.leadId), eq(conversations.organizationId, s.organizationId)))
    .limit(MAX_EXPORT_RECORDS);
  return capped("communications", rows).map((r) => r.id);
}

/**
 * One executor per `export` domain in DSAR_DOMAINS, for both subject kinds.
 * The coverage test (tests/unit/dsarDomainCoverage.test.ts) pins key equality
 * with the registry in both directions.
 */
export const DSAR_EXPORTERS: Record<string, (s: DsarSubject) => Promise<unknown[]>> = {
  // ─── User subjects ────────────────────────────────────────────────────────
  account_profile: async (s) => {
    const u = asUser(s, "account_profile");
    const rows = await db.select().from(users).where(eq(users.id, u.userId)).limit(MAX_EXPORT_RECORDS);
    return capped("account_profile", rows).map((r) => clean(users, r, ["password"]));
  },

  team_memberships: async (s) => {
    const u = asUser(s, "team_memberships");
    const rows = await db.select().from(teamMembers).where(eq(teamMembers.userId, u.userId)).limit(MAX_EXPORT_RECORDS);
    return capped("team_memberships", rows).map((r) => clean(teamMembers, r));
  },

  team_messages: async (s) => {
    const u = asUser(s, "team_messages");
    const rows = await db.select().from(teamMessages).where(eq(teamMessages.senderId, u.userId)).limit(MAX_EXPORT_RECORDS);
    return capped("team_messages", rows).map((r) => clean(teamMessages, r));
  },

  support_tickets: async (s) => {
    const u = asUser(s, "support_tickets");
    const rows = await db.select().from(supportTickets).where(eq(supportTickets.userId, u.userId)).limit(MAX_EXPORT_RECORDS);
    return capped("support_tickets", rows).map((r) => clean(supportTickets, r));
  },

  ai_conversations: async (s) => {
    const u = asUser(s, "ai_conversations");
    const rows = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, String(u.userId)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("ai_conversations", rows).map((r) => clean(aiConversations, r));
  },

  // ─── Lead subjects (every query org-filtered) ─────────────────────────────
  lead_profile: async (s) => {
    const l = asLead(s, "lead_profile");
    const rows = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, l.leadId), eq(leads.organizationId, l.organizationId)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("lead_profile", rows).map((r) => {
      const taxIdOnFile = (r.taxId ?? "").length > 0;
      // omitSecretColumns(leads) drops taxId (ciphertext) and taxIdType; the
      // explicit drop keeps the design's rule independent of the registry.
      return { ...clean(leads, r, ["taxId"]), taxIdOnFile };
    });
  },

  consent_records: async (s) => {
    const l = asLead(s, "consent_records");
    const rows = await db
      .select()
      .from(leadConsentEvents)
      .where(and(eq(leadConsentEvents.leadId, l.leadId), eq(leadConsentEvents.organizationId, l.organizationId)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("consent_records", rows).map((r) => clean(leadConsentEvents, r));
  },

  loan_notes: async (s) => {
    const l = asLead(s, "loan_notes");
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.borrowerId, l.leadId), eq(notes.organizationId, l.organizationId)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("loan_notes", rows).map((r) => clean(notes, r, ["accessToken"]));
  },

  loan_payments: async (s) => {
    const l = asLead(s, "loan_payments");
    if (l.noteIds.length === 0) return [];
    const rows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.organizationId, l.organizationId), inArray(payments.noteId, l.noteIds)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("loan_payments", rows).map((r) => clean(payments, r));
  },

  properties: async (s) => {
    const l = asLead(s, "properties");
    const rows = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, l.organizationId),
          or(eq(properties.sellerId, l.leadId), eq(properties.buyerId, l.leadId)),
        ),
      )
      .limit(MAX_EXPORT_RECORDS);
    return capped("properties", rows).map((r) => clean(properties, r));
  },

  communications: async (s) => {
    const l = asLead(s, "communications");
    const conversationIds = await leadConversationIds(l);

    const [activityRows, conversationRows, messageRows, sellerRows, inboxRows, borrowerRows] = await Promise.all([
      db
        .select()
        .from(leadActivities)
        .where(and(eq(leadActivities.leadId, l.leadId), eq(leadActivities.organizationId, l.organizationId)))
        .limit(MAX_EXPORT_RECORDS),
      db
        .select()
        .from(conversations)
        .where(and(eq(conversations.leadId, l.leadId), eq(conversations.organizationId, l.organizationId)))
        .limit(MAX_EXPORT_RECORDS),
      conversationIds.length === 0
        ? Promise.resolve([] as (typeof messages.$inferSelect)[])
        : db
            .select()
            .from(messages)
            .where(and(inArray(messages.conversationId, conversationIds), eq(messages.organizationId, l.organizationId)))
            .limit(MAX_EXPORT_RECORDS),
      db
        .select()
        .from(sellerCommunications)
        .where(and(eq(sellerCommunications.leadId, l.leadId), eq(sellerCommunications.organizationId, l.organizationId)))
        .limit(MAX_EXPORT_RECORDS),
      db
        .select()
        .from(inboxMessages)
        .where(and(eq(inboxMessages.leadId, l.leadId), eq(inboxMessages.organizationId, l.organizationId)))
        .limit(MAX_EXPORT_RECORDS),
      l.noteIds.length === 0
        ? Promise.resolve([] as (typeof borrowerMessages.$inferSelect)[])
        : db
            .select()
            .from(borrowerMessages)
            .where(and(inArray(borrowerMessages.noteId, l.noteIds), eq(borrowerMessages.orgId, l.organizationId)))
            .limit(MAX_EXPORT_RECORDS),
    ]);

    // Each source table is capped on its own, then the combined domain is
    // capped again in buildSubjectExport.
    return [
      ...capped("communications", activityRows).map((r) => ({ table: "lead_activities", record: clean(leadActivities, r) })),
      ...capped("communications", conversationRows).map((r) => ({ table: "conversations", record: clean(conversations, r) })),
      ...capped("communications", messageRows).map((r) => ({ table: "messages", record: clean(messages, r) })),
      ...capped("communications", sellerRows).map((r) => ({ table: "seller_communications", record: clean(sellerCommunications, r) })),
      ...capped("communications", inboxRows).map((r) => ({ table: "inbox_messages", record: clean(inboxMessages, r) })),
      ...capped("communications", borrowerRows).map((r) => ({ table: "borrower_messages", record: clean(borrowerMessages, r) })),
    ];
  },

  borrower_portal_sessions: async (s) => {
    const l = asLead(s, "borrower_portal_sessions");
    if (l.noteIds.length === 0) return [];
    // borrower_sessions.organizationId is nullable. The design scope requires
    // `organizationId = org` as well as the org-filtered note ids, so a
    // legacy session row with a NULL org is not exported (under-export, never
    // a cross-tenant row). Recorded here rather than widened silently.
    const rows = await db
      .select()
      .from(borrowerSessions)
      .where(and(inArray(borrowerSessions.noteId, l.noteIds), eq(borrowerSessions.organizationId, l.organizationId)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("borrower_portal_sessions", rows).map((r) => clean(borrowerSessions, r, ["sessionToken"]));
  },

  borrower_payment_profiles: async (s) => {
    const l = asLead(s, "borrower_payment_profiles");
    const rows = await db
      .select()
      .from(borrowerPaymentProfiles)
      .where(and(eq(borrowerPaymentProfiles.leadId, l.leadId), eq(borrowerPaymentProfiles.organizationId, l.organizationId)))
      .limit(MAX_EXPORT_RECORDS);
    return capped("borrower_payment_profiles", rows).map((r) =>
      clean(borrowerPaymentProfiles, r, PAYMENT_PROFILE_PROCESSOR_KEYS),
    );
  },

  email_suppressions: async (s) => {
    const l = asLead(s, "email_suppressions");
    const email = l.email.trim().toLowerCase();
    // No email on the lead → nothing can link a suppression to this subject.
    if (email === "") return [];
    const rows = await db
      .select()
      .from(emailSuppressions)
      .where(and(eq(emailSuppressions.organizationId, l.organizationId), sql`lower(${emailSuppressions.email}) = ${email}`))
      .limit(MAX_EXPORT_RECORDS);
    return capped("email_suppressions", rows).map((r) => clean(emailSuppressions, r));
  },

  activity_events: async (s) => {
    const l = asLead(s, "activity_events");
    // 'lead' literal confirmed written — see the module header evidence.
    const rows = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.organizationId, l.organizationId),
          eq(activityEvents.entityType, "lead"),
          eq(activityEvents.entityId, l.leadId),
        ),
      )
      .limit(MAX_EXPORT_RECORDS);
    return capped("activity_events", rows).map((r) => clean(activityEvents, r));
  },
};

function subjectRef(subject: DsarSubject): DsarSubjectExport["subject"] {
  return subject.kind === "user"
    ? { kind: "user", userId: subject.userId }
    : { kind: "lead", organizationId: subject.organizationId, leadId: subject.leadId };
}

/**
 * Build the export for a gated subject. Takes a DsarSubject, which only
 * gateDsarAction produces. The subject's email is NOT included in the
 * envelope (it appears only inside the subject's own profile rows).
 */
export async function buildSubjectExport(subject: DsarSubject): Promise<DsarSubjectExport> {
  const domains: Record<string, unknown[]> = {};
  const totalRecords: Record<string, number> = {};
  const exclusions: DsarSubjectExport["exclusions"] = [];

  for (const d of DSAR_DOMAINS) {
    if (d.decision === "exclude") {
      if (d.subjectKind === subject.kind || d.subjectKind === "both") {
        exclusions.push({ domain: d.domain, basis: d.basis, reason: d.reason });
      }
      continue;
    }
    if (d.subjectKind !== subject.kind) continue;
    const exporter = DSAR_EXPORTERS[d.domain];
    if (!exporter) {
      throw new Error(
        `DSAR domain "${d.domain}" is declared export for ${d.subjectKind} subjects but has no exporter — refusing rather than reporting it empty.`,
      );
    }
    const rows = capped(d.domain, await exporter(subject));
    domains[d.domain] = rows;
    totalRecords[d.domain] = rows.length;
  }

  return {
    exportedAt: clock.now().toISOString(),
    subject: subjectRef(subject),
    posture: DSAR_IDENTITY_POSTURE.id,
    domains,
    totalRecords,
    exclusions,
  };
}
