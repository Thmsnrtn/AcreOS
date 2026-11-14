/**
 * T174 — GDPR Data Service
 *
 * Handles GDPR/CCPA data requests:
 * - Data export: delegated to the declared DSAR domain registry
 *   (shared/privacy/dsarDomains.ts) via privacy/dsarExporters.ts
 *   buildSubjectExport — for user AND lead subjects (PKG-1 §4)
 * - Data deletion: permanently delete all personal data for a user
 * - Anonymization: replace personal data with hashed/anonymized values
 *
 * Deletion follows a defined order to respect foreign keys:
 * 1. Agent events (logs)
 * 2. Activity logs
 * 3. Support tickets
 * 4. Team messages
 * 5. Notes (seller-financed notes are retained for legal compliance)
 * 6. Leads (with anonymization option to keep business records)
 * 7. User sessions
 * 8. User account
 */

import { db } from "../db";
import {
  users,
  leads,
  aiConversations,
  teamMessages,
  supportTickets,
  notes,
  teamMembers,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { getActiveHoldsForOrg, assertNotUnderLegalHold, LegalHoldViolationError } from "./legalHold";
import { clock } from "../utils/clock";
import { DSAR_DOMAINS, type DsarSubjectKind } from "@shared/privacy/dsarDomains";
// Type-only: the gate is the only producer of a DsarSubject for the founder
// routes, so erasure cannot be reached around it.
import type { DsarSubject } from "./privacy/dsarActionGate";
import { buildSubjectExport, type DsarSubjectExport } from "./privacy/dsarExporters";

/**
 * Safety limit per export domain. privacy/dsarExporters.ts holds a
 * module-private mirror of this value (it enforces the cap); keep the two equal.
 */
export const MAX_EXPORT_RECORDS = 100_000;

/**
 * The refusal past the cap (413 via Errors.internal's name mapping). Lives in
 * privacy/dsarExporters.ts — the module that enforces it — and is re-exported
 * here so existing imports keep one class and there is no import cycle.
 */
export { ExportTooLargeError } from "./privacy/dsarExporters";

type DeletionReport = {
  userId: string;
  deletedAt: string;
  itemsDeleted: {
    agentEvents: number;
    teamMessages: number;
    supportTickets: number;
    tasks: number;
    sessions: number;
    aiMemory: number;
    aiConversations: number;
  };
  leadsAnonymized: number;
  userAnonymized: boolean;
};

/** What `eraseLeadSubject` changed on the lead row (PKG-1 §3). */
export type LeadErasureReport = {
  organizationId: number;
  leadId: number;
  erasedAt: string;
  /** Lead columns overwritten with a placeholder / null / doNotContact=true. */
  fieldsAnonymized: string[];
  /** Lead rows updated — 1 on success. */
  leadsAnonymized: number;
};

/**
 * A DSAR erasure refused BY NAME (PKG-1 §3). The route maps it to 422 with
 * `details.reason === reason`; nothing has been written when it is thrown.
 */
export class DsarErasureRefusedError extends Error {
  constructor(
    public readonly reason: "SUBJECT_ALREADY_ERASED" | "RETENTION_REQUIRED_LOAN_RECORDS",
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DsarErasureRefusedError";
  }
}

/**
 * Resolve a user subject for the registry export: the account row plus the
 * organizations the user is a member of (teamMembers).
 */
async function resolveUserSubject(userId: string): Promise<Extract<DsarSubject, { kind: "user" }>> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);
  const memberships = await db
    .select({ organizationId: teamMembers.organizationId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return {
    kind: "user",
    userId: user.id,
    email: user.email ?? "",
    organizationIds: Array.from(new Set(memberships.map((m) => m.organizationId))),
  };
}

/**
 * Export all personal data for a user (GDPR Article 15 — Right of Access).
 *
 * PKG-1 §4: delegates to the declared registry. The old inline fan-out is
 * gone — including the hard-coded empty `properties` (now an explicit
 * `properties_user` exclusion: no column links a property to a user) and the
 * assigned leads/deals/tasks reads (now the `assigned_records` exclusion:
 * third parties' data and the org's own records).
 *
 * NOT identity-gated: the founder DSAR routes call gateDsarAction and
 * buildSubjectExport directly. Callers of this function own the
 * authorization decision.
 */
export async function exportUserData(userId: string): Promise<DsarSubjectExport> {
  return buildSubjectExport(await resolveUserSubject(userId));
}

/**
 * Anonymize a user's personal data (GDPR Article 17 — Right to Erasure).
 * Soft-deletion: replaces PII with hashed/placeholder values.
 * Business records (deals, notes with legal significance) are retained.
 */
// Module-private: the only production caller is eraseDsarSubject (PKG-1), which the DSAR gate feeds.
async function anonymizeUser(userId: string): Promise<DeletionReport> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);

  // Phase 3 Week 11 (FRCP 37(e)): GDPR erasure must NOT proceed when the
  // user belongs to an org under an active legal hold. The 30-day GDPR
  // response window contemplates exactly this kind of "lawful obligation
  // overrides erasure" carve-out (Art. 17(3)(b/e)). Operators must release
  // the hold (or carve out the user via scoped erasure outside the
  // automated pipeline) before this path can run.
  //
  // PKG-1 C-5: the error names the FIRST REAL active hold (id, caseRef,
  // scope) so the 423 tells the operator which case blocks it — it used to
  // carry a fabricated `{ id: "(see legal_holds)", caseRef: "active" }`.
  // Strictness is unchanged: ANY active hold in ANY member org blocks.
  const memberships = await db
    .select({ orgId: teamMembers.organizationId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  for (const { orgId } of memberships) {
    const [hold] = await getActiveHoldsForOrg(orgId);
    if (hold) {
      throw new LegalHoldViolationError(orgId, "user", userId, {
        id: hold.id,
        caseRef: hold.caseRef,
        scope: hold.scope,
      });
    }
  }

  const hash = crypto.createHash("sha256").update(String(userId)).digest("hex").substring(0, 8);
  const anonEmail = `deleted-user-${hash}@gdpr-deleted.invalid`;
  const anonName = `[Deleted User ${hash}]`;

  // 1. Delete agent events (logs)
  // TODO(tsc): agent_events has no userId column (events are org-scoped, with
  // any agent identity living in payload), so they cannot be deleted per-user.
  const deletedEvents: { id: number }[] = [];

  // 2. Delete team messages
  const deletedMessages = await db.delete(teamMessages).where(eq(teamMessages.senderId, userId)).returning({ id: teamMessages.id });

  // 3. Delete support tickets
  const deletedTickets = await db.delete(supportTickets).where(eq(supportTickets.userId, userId)).returning({ id: supportTickets.id });

  // 4. REMOVED (PKG-1 C-5): this step deleted every task assigned to the
  // user. Tasks are the organization's own business records, not the
  // subject's personal data — once the users row is anonymized (step 7) a
  // teamMembers.id reference identifies no one. The count stays in the
  // report shape, truthfully zero.
  const deletedTasks: { id: number }[] = [];

  // 5. Sessions: the `sessions` table was dropped 2026-08-01 (founder ruling —
  // Clerk JWT auth, no session store, zero rows ever written; even here it was
  // imported but never queried because its integer userId could not match the
  // UUID users.id). Auth-session revocation is Clerk's job, not a table purge.
  // The count stays in the erasure report shape, truthfully zero.
  const deletedSessions: { id: number }[] = [];

  // 5a. Task #48: Delete AI conversation history and org-scoped agent memory
  // aiConversations are user-scoped; agentMemory is org-scoped (deleted if user owns the org)
  const deletedAiMemory: { id: number }[] = []; // agentMemory is org-scoped, not user-scoped
  // Org-level agentMemory (and every other org-scoped table) is purged by
  // server/services/orgDeletion.ts deleteOrganization(orgId) — implemented
  // 2026-07-04; this comment referenced it for months before it existed.

  const deletedAiConversations = await db.delete(aiConversations)
    .where(eq(aiConversations.userId, String(userId)))
    .returning({ id: aiConversations.id })
    .catch(() => [] as { id: number }[]);

  // 6. REMOVED (PKG-1 C-5): this step anonymized every lead ASSIGNED to the
  // user. Those leads are third parties' personal data and the org's
  // records — the org is their controller, not this user — and they include
  // borrower leads that 1099-INT/1098 read (bookkeeping.ts, form1098Batch.ts),
  // so erasing a team member silently rewrote tax-form recipients
  // (DEFECT-0101 fence). A lead is erased only as its OWN DSAR subject, via
  // eraseLeadSubject. `leadsAnonymized` stays in the report, truthfully zero.
  const leadsAnonymized = 0;

  // 7. Anonymize user account. This MUST stay LAST: the anonymized email is
  // the idempotency marker isUserDeleted() reads. A crash before this line
  // leaves the subject NOT erased, so a retry is allowed rather than locked
  // out. There is deliberately no transaction — the ordering is the guarantee.
  await db.update(users).set({
    email: anonEmail,
    firstName: anonName,
    lastName: "",
    profileImageUrl: null,
  }).where(eq(users.id, userId));

  return {
    userId,
    deletedAt: clock.now().toISOString(),
    itemsDeleted: {
      agentEvents: deletedEvents.length,
      teamMessages: deletedMessages.length,
      supportTickets: deletedTickets.length,
      tasks: deletedTasks.length,
      sessions: deletedSessions.length,
      aiMemory: deletedAiMemory.length,
      aiConversations: deletedAiConversations.length,
    },
    leadsAnonymized,
    userAnonymized: true,
  };
}

/** Lead columns erasure overwrites — the one field set (PKG-1 §3 lead step 3). */
const LEAD_ERASURE_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "notes",
  "address",
  "city",
  "zip",
  "doNotContact",
] as const;

/**
 * Anonymize a lead's contact fields — the identity anchor (PKG-1 §3). The
 * field set and the `deleted-${id}@gdpr-deleted.invalid` marker are the ones
 * the old anonymizeUser step 6 used, extended with the address fields and
 * doNotContact = true.
 *
 * Deviation from design §3 (code facts): `leads` has NO mailingAddress /
 * mailingCity / mailingZip columns (shared/schema.ts leads table), so only
 * address / city / zip are nulled — all three are nullable. `state`,
 * `propertyAddress` and the parcel fields describe the parcel, not the
 * person, and are left as the org's record. firstName/lastName are NOT NULL,
 * hence placeholders. `taxId` is never written (borrowers are refused before
 * this runs). `deletedAt` is never set — soft-deleting would hide the lead
 * from the org's own records and is a separate decision.
 *
 * Carries its own org scope: the update is filtered by `organizationId` as
 * well as `leadId`.
 */
async function anonymizeLeadContactFields(organizationId: number, leadId: number): Promise<number> {
  const updated = await db.update(leads).set({
    firstName: "[Deleted]",
    lastName: "[User]",
    email: `deleted-${leadId}@gdpr-deleted.invalid`,
    phone: null,
    notes: null,
    address: null,
    city: null,
    zip: null,
    doNotContact: true,
  }).where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId))).returning({ id: leads.id });
  return updated.length;
}

/** A lead is erased when its email carries the per-id erasure marker. */
export function isLeadErased(lead: { id: number; email: string | null }): boolean {
  return lead.email === `deleted-${lead.id}@gdpr-deleted.invalid`;
}

/**
 * Erase an account-less lead subject in ONE organization (PKG-1 §3).
 *
 * Order — every refusal happens before the first write:
 *   1. legal hold (org_wide or lead_specific) → LegalHoldViolationError naming the hold;
 *   2. borrower on ANY note in the org, any status → RETENTION_REQUIRED_LOAN_RECORDS (S-1);
 *   3. already erased → SUBJECT_ALREADY_ERASED;
 *   4. anonymize the contact fields.
 */
async function eraseLeadSubject(organizationId: number, leadId: number): Promise<LeadErasureReport> {
  await assertNotUnderLegalHold(organizationId, "lead", leadId);

  const borrowerNotes = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.borrowerId, leadId), eq(notes.organizationId, organizationId)));
  if (borrowerNotes.length > 0) {
    const noteIds = borrowerNotes.map((n) => n.id);
    throw new DsarErasureRefusedError(
      "RETENTION_REQUIRED_LOAN_RECORDS",
      `This person is the borrower on note(s) ${noteIds.map((id) => `#${id}`).join(", ")} — loan, 1099-INT and 1098 records require their identity to be retained (GDPR Art. 17(3)(b)). Erasure is refused; the export is available. Founder/counsel ruling S-1 pending.`,
      { noteIds },
    );
  }

  const [lead] = await db
    .select({ id: leads.id, email: leads.email })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  if (!lead) throw new Error(`Lead ${leadId} not found in organization ${organizationId}`);
  if (isLeadErased(lead)) {
    throw new DsarErasureRefusedError(
      "SUBJECT_ALREADY_ERASED",
      "This subject was already erased; nothing was changed.",
    );
  }

  const leadsAnonymized = await anonymizeLeadContactFields(organizationId, leadId);

  return {
    organizationId,
    leadId,
    erasedAt: clock.now().toISOString(),
    fieldsAnonymized: [...LEAD_ERASURE_FIELDS],
    leadsAnonymized,
  };
}

/** Domains erasure RETAINS for a subject kind — derived from the registry, never hand-written. */
function retainedDomainsFor(kind: DsarSubjectKind): Array<{ domain: string; reason: string }> {
  const retained: Array<{ domain: string; reason: string }> = [];
  for (const d of DSAR_DOMAINS) {
    if (d.decision === "export" && d.subjectKind === kind && d.erasure.action === "retain") {
      retained.push({ domain: d.domain, reason: d.erasure.reason ?? "" });
    }
  }
  return retained;
}

/**
 * Execute a DSAR erasure for a gated subject (PKG-1 §3). Takes a DsarSubject,
 * which only gateDsarAction produces, so this cannot be reached around the
 * verification gate.
 *
 * Idempotency is proved by the SUBJECT'S OWN state (not the DSAR record), and
 * is checked first: an already-erased subject is refused by name.
 */
export async function eraseDsarSubject(subject: DsarSubject): Promise<{
  report: DeletionReport | LeadErasureReport;
  retained: Array<{ domain: string; reason: string }>;
  operatorFollowUps: string[];
}> {
  if (subject.kind === "user") {
    if (await isUserDeleted(subject.userId)) {
      throw new DsarErasureRefusedError(
        "SUBJECT_ALREADY_ERASED",
        "This subject was already erased; nothing was changed.",
      );
    }
    const report = await anonymizeUser(subject.userId);
    return {
      report,
      retained: retainedDomainsFor("user"),
      // S-3: the Clerk identity is an external system; this action makes no
      // external call. The founder deletes it out-of-band.
      operatorFollowUps: [
        `Delete the Clerk identity for user ${subject.userId} out-of-band — this erasure anonymized the AcreOS users row only; the Clerk user was not deleted (S-3).`,
      ],
    };
  }

  const [lead] = await db
    .select({ id: leads.id, email: leads.email })
    .from(leads)
    .where(and(eq(leads.id, subject.leadId), eq(leads.organizationId, subject.organizationId)));
  if (!lead) throw new Error(`Lead ${subject.leadId} not found in organization ${subject.organizationId}`);
  if (isLeadErased(lead)) {
    throw new DsarErasureRefusedError(
      "SUBJECT_ALREADY_ERASED",
      "This subject was already erased; nothing was changed.",
    );
  }
  const report = await eraseLeadSubject(subject.organizationId, subject.leadId);
  return {
    report,
    retained: retainedDomainsFor("lead"),
    operatorFollowUps: [],
  };
}

/**
 * Check if a user has an active GDPR deletion request.
 * Returns true if the user's email matches the deletion pattern.
 */
export async function isUserDeleted(userId: string): Promise<boolean> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user?.email) return false;
  return user.email.endsWith("@gdpr-deleted.invalid");
}
