/**
 * The DSAR action gate (PKG-1 §2, docs/pkg1-dsar-design-2026-11.md).
 *
 * ONE place decides whether a founder export or erasure may run against a
 * DSAR record, and it is the ONLY producer of a `DsarSubject`.
 * `buildSubjectExport` (./dsarExporters) and `eraseDsarSubject` (../gdprService)
 * take a `DsarSubject`, not raw ids, so neither action can be reached around
 * this gate. Routes stay thin: call the gate, map the refusal, call the action.
 *
 * Gate order — each step refuses, and nothing is written before it passes:
 *   1. load the record                 → 404 DSAR_NOT_FOUND
 *   2. identity verified (posture)     → 422 DSAR_NOT_VERIFIED
 *   3. request type fits the action    → 422 DSAR_TYPE_MISMATCH
 *   4. resolve the subject             → 404 SUBJECT_NOT_FOUND
 *   5. exact email match (posture)     → 422 DSAR_SUBJECT_MISMATCH, or
 *      422 SUBJECT_ALREADY_ERASED when the subject carries the erasure marker
 *      (design §3 ordering decision: an erased subject's email no longer
 *      matches, and "already erased" is the more useful name).
 *
 * The posture switches (`requireOperatorVerification`,
 * `requireExactEmailMatch`) are READ from DSAR_IDENTITY_POSTURE, never
 * hard-coded here — swapping the posture is an edit to that one object.
 *
 * Refusal `details` NEVER carry the subject's email (or the requester's).
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { dsarRequestsLifecycle, leads, notes, teamMembers, users } from "@shared/schema";
import {
  DSAR_IDENTITY_POSTURE,
  DSAR_RECORD_OF_RECORD,
} from "@shared/privacy/dsarIdentityPosture";
import { isLeadErased, isUserDeleted } from "../gdprService";

export type DsarAction = "export" | "erasure";

/** The view of a DSAR record every action reads — one adapter, one table (§1). */
export interface DsarRecordView {
  id: string;
  table: typeof DSAR_RECORD_OF_RECORD;
  requestType: "access" | "erasure" | "portability" | "rectification" | string;
  /** Lower-cased at intake (routes-gdpr.ts, routes-privacy-dsar.ts). */
  requesterEmail: string;
  /** ← dsarRequestsLifecycle.requesterIdentityVerified */
  verified: boolean;
  fulfilledAt: Date | null;
  isSelfTest: boolean;
}

export type DsarSubjectSelector =
  | { kind: "user"; userId: string }
  | { kind: "lead"; organizationId: number; leadId: number };

export type DsarSubject =
  | { kind: "user"; userId: string; email: string; organizationIds: number[] }
  | {
      kind: "lead";
      organizationId: number;
      leadId: number;
      email: string;
      isBorrower: boolean;
      noteIds: number[];
    };

/**
 * Design §2 lists five reasons; SUBJECT_ALREADY_ERASED is added because the
 * §3 ordering decision makes step 5 refuse under that name.
 */
export type DsarRefusalReason =
  | "DSAR_NOT_FOUND"
  | "DSAR_NOT_VERIFIED"
  | "DSAR_TYPE_MISMATCH"
  | "SUBJECT_NOT_FOUND"
  | "DSAR_SUBJECT_MISMATCH"
  | "SUBJECT_ALREADY_ERASED";

export type GateRefusal = {
  status: 404 | 422;
  reason: DsarRefusalReason;
  message: string;
  details?: Record<string, unknown>;
};

export type DsarGateResult =
  | { ok: true; record: DsarRecordView; subject: DsarSubject }
  | { ok: false; refusal: GateRefusal };

/**
 * The ONE adapter over the record of record (DSAR_RECORD_OF_RECORD =
 * "dsar_requests_lifecycle"). If counsel names `dsar_requests` canonical, the
 * swap is a second adapter here plus the constant — routes and UI do not
 * change. Do not build that adapter until then.
 */
export async function loadDsarRecord(id: string): Promise<DsarRecordView | null> {
  const [row] = await db
    .select({
      id: dsarRequestsLifecycle.id,
      requestType: dsarRequestsLifecycle.requestType,
      requesterEmail: dsarRequestsLifecycle.requesterEmail,
      requesterIdentityVerified: dsarRequestsLifecycle.requesterIdentityVerified,
      fulfilledAt: dsarRequestsLifecycle.fulfilledAt,
      isSelfTest: dsarRequestsLifecycle.isSelfTest,
    })
    .from(dsarRequestsLifecycle)
    .where(eq(dsarRequestsLifecycle.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    table: DSAR_RECORD_OF_RECORD,
    requestType: row.requestType,
    requesterEmail: row.requesterEmail,
    verified: row.requesterIdentityVerified,
    fulfilledAt: row.fulfilledAt ?? null,
    isSelfTest: row.isSelfTest,
  };
}

const EXPORT_REQUEST_TYPES: readonly string[] = ["access", "portability"];
const ERASURE_REQUEST_TYPES: readonly string[] = ["erasure"];

function refuse(
  status: 404 | 422,
  reason: DsarRefusalReason,
  message: string,
  details?: Record<string, unknown>,
): { ok: false; refusal: GateRefusal } {
  return { ok: false, refusal: { status, reason, message, ...(details ? { details } : {}) } };
}

/** Ids only — the shape audit rows and refusal details carry (never an email). */
function selectorRef(selector: DsarSubjectSelector): Record<string, unknown> {
  return selector.kind === "user"
    ? { subjectKind: "user", userId: selector.userId }
    : { subjectKind: "lead", organizationId: selector.organizationId, leadId: selector.leadId };
}

/** Org-scoped: the notes on which this lead is the borrower, in that org only. */
async function borrowerNoteIds(organizationId: number, leadId: number): Promise<number[]> {
  const rows = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.borrowerId, leadId), eq(notes.organizationId, organizationId)));
  return rows.map((r) => r.id);
}

type ResolvedSubject = { subject: DsarSubject; erased: () => Promise<boolean> };

async function resolveSubject(selector: DsarSubjectSelector): Promise<ResolvedSubject | null> {
  if (selector.kind === "user") {
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, selector.userId))
      .limit(1);
    if (!user) return null;
    const memberships = await db
      .select({ organizationId: teamMembers.organizationId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id));
    const organizationIds = Array.from(new Set(memberships.map((m) => m.organizationId)));
    return {
      subject: { kind: "user", userId: user.id, email: user.email ?? "", organizationIds },
      erased: () => isUserDeleted(user.id),
    };
  }

  // Lead subjects are acted on one organization at a time
  // (DSAR_IDENTITY_POSTURE.leadSubjectsPerOrganization): the lead must live
  // in the selector's org and not be soft-deleted.
  const [lead] = await db
    .select({ id: leads.id, organizationId: leads.organizationId, email: leads.email })
    .from(leads)
    .where(
      and(
        eq(leads.id, selector.leadId),
        eq(leads.organizationId, selector.organizationId),
        isNull(leads.deletedAt),
      ),
    )
    .limit(1);
  if (!lead) return null;
  const noteIds = await borrowerNoteIds(lead.organizationId, lead.id);
  return {
    subject: {
      kind: "lead",
      organizationId: lead.organizationId,
      leadId: lead.id,
      email: lead.email ?? "",
      isBorrower: noteIds.length > 0,
      noteIds,
    },
    erased: async () => isLeadErased({ id: lead.id, email: lead.email }),
  };
}

/**
 * The gate. The ONLY path to a `DsarSubject`. See the module header for the
 * step order; each step returns a named refusal.
 */
export async function gateDsarAction(
  dsarId: string,
  selector: DsarSubjectSelector,
  action: DsarAction,
): Promise<DsarGateResult> {
  // 1. Load the record.
  const record = await loadDsarRecord(dsarId);
  if (!record) {
    return refuse(404, "DSAR_NOT_FOUND", "DSAR request not found.", { dsarId });
  }

  // 2. Identity verified — read from the posture, not hard-coded.
  if (DSAR_IDENTITY_POSTURE.requireOperatorVerification && !record.verified) {
    return refuse(
      422,
      "DSAR_NOT_VERIFIED",
      "Identity is not verified on this DSAR record. Record the verification (POST /api/founder/dsar/:id/verify-identity) before any export or erasure.",
      { dsarId: record.id, posture: DSAR_IDENTITY_POSTURE.id },
    );
  }

  // 3. Request type fits the action (mirrors routes-dsar.ts fan-out/erasure checks).
  const allowed = action === "export" ? EXPORT_REQUEST_TYPES : ERASURE_REQUEST_TYPES;
  if (!allowed.includes(record.requestType)) {
    return refuse(
      422,
      "DSAR_TYPE_MISMATCH",
      action === "export"
        ? `This DSAR record is a "${record.requestType}" request; an export is only valid for access or portability requests.`
        : `This DSAR record is a "${record.requestType}" request; erasure is only valid for erasure requests.`,
      { dsarId: record.id, requestType: record.requestType, action },
    );
  }

  // 4. Resolve the subject.
  const resolved = await resolveSubject(selector);
  if (!resolved) {
    return refuse(
      404,
      "SUBJECT_NOT_FOUND",
      selector.kind === "user"
        ? "No AcreOS account matches that user id."
        : "No lead matches that id in that organization (or it has been deleted).",
      { dsarId: record.id, ...selectorRef(selector) },
    );
  }
  const { subject } = resolved;

  // 5. Exact email match — read from the posture. On mismatch, an erased
  //    subject is refused by the more useful name (design §3 ordering).
  if (DSAR_IDENTITY_POSTURE.requireExactEmailMatch) {
    const subjectEmail = subject.email.trim().toLowerCase();
    const requesterEmail = record.requesterEmail.trim().toLowerCase();
    if (subjectEmail === "" || subjectEmail !== requesterEmail) {
      if (await resolved.erased()) {
        return refuse(
          422,
          "SUBJECT_ALREADY_ERASED",
          "This subject was already erased; nothing was changed.",
          { dsarId: record.id, action, ...selectorRef(selector) },
        );
      }
      return refuse(
        422,
        "DSAR_SUBJECT_MISMATCH",
        "The selected subject's email on file does not match this DSAR record's requester email. Pick a subject from the candidates list.",
        { dsarId: record.id, posture: DSAR_IDENTITY_POSTURE.id, ...selectorRef(selector) },
      );
    }
  }

  return { ok: true, record, subject };
}

export type DsarUserCandidate = {
  kind: "user";
  userId: string;
  organizationIds: number[];
  erased: boolean;
};

export type DsarLeadCandidate = {
  kind: "lead";
  organizationId: number;
  leadId: number;
  isBorrower: boolean;
  erased: boolean;
};

/**
 * The users and leads whose email equals the record's requester email, so the
 * founder PICKS a subject instead of typing ids (§3). Returns ids and flags
 * only — no emails, names or contact fields.
 *
 * FOUNDER-PLANE ONLY, CROSS-ORG BY DESIGN: the lead read below spans every
 * organization because the same email in another organization is a separate
 * subject under DSAR_IDENTITY_POSTURE (leadSubjectsPerOrganization), and the
 * founder must see each one to choose. Its only caller is
 * GET /api/founder/dsar/:id/subject-candidates behind requireFounder. Every
 * export and erasure query, by contrast, is org-filtered.
 *
 * Deviation from design §3 (code facts): the design says `leads.email ILIKE
 * requesterEmail`. ILIKE treats `_` and `%` as wildcards, and `_` is common in
 * email local parts, so it would match OTHER people's addresses. This uses an
 * exact case-insensitive equality instead — the posture's "exactly matches".
 */
export async function listDsarSubjectCandidates(
  email: string,
): Promise<{ users: DsarUserCandidate[]; leads: DsarLeadCandidate[] }> {
  const target = email.trim().toLowerCase();
  if (target === "") return { users: [], leads: [] };

  const userRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${target}`);

  const userCandidates: DsarUserCandidate[] = [];
  for (const u of userRows) {
    const memberships = await db
      .select({ organizationId: teamMembers.organizationId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, u.id));
    userCandidates.push({
      kind: "user",
      userId: u.id,
      organizationIds: Array.from(new Set(memberships.map((m) => m.organizationId))),
      erased: (u.email ?? "").endsWith("@gdpr-deleted.invalid"),
    });
  }

  // Cross-org founder-plane read — see the function comment and the posture.
  const leadRows = await db
    .select({
      id: leads.id,
      organizationId: leads.organizationId,
      email: leads.email,
      isBorrower: sql<boolean>`exists (select 1 from ${notes} where ${notes.borrowerId} = ${leads.id} and ${notes.organizationId} = ${leads.organizationId})`,
    })
    .from(leads)
    .where(and(sql`lower(${leads.email}) = ${target}`, isNull(leads.deletedAt)));

  const leadCandidates: DsarLeadCandidate[] = leadRows.map((l) => ({
    kind: "lead",
    organizationId: l.organizationId,
    leadId: l.id,
    isBorrower: Boolean(l.isBorrower),
    erased: isLeadErased({ id: l.id, email: l.email }),
  }));

  return { users: userCandidates, leads: leadCandidates };
}
