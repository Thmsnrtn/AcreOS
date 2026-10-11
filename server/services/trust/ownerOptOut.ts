/**
 * Owner opt-out and deletion requests (W5a) — ready for state data-broker laws
 * (California's Delete Act / DROP and the other state broker registries).
 *
 * The lifecycle, and who may move it:
 *
 *   1. SUBMIT (public, unauthenticated). The owner gives what they want
 *      matched — an email, a phone, a mailing address — and how to verify:
 *      an emailed link, or a code mailed to the address. Nothing else is
 *      collected; never a government identifier. Identifiers are hashed at
 *      once (ownerSuppression.ts); the plaintext lives only for this request.
 *      Candidate matching leads across ALL orgs are found now, while the
 *      plaintext exists, and kept as ids only.
 *   2. VERIFY (the requester). Proportionate: the emailed token, or the mailed
 *      code. On success the identifiers become platform-wide suppressions
 *      IMMEDIATELY, the matched leads in every org are stamped do-not-contact,
 *      and each org's owner is told a lead was suppressed.
 *   3. DELETE (the founder). Deleting an org's records is customer-data
 *      deletion — a founder-only hard stop. Each org with matches becomes a
 *      card on the founder's Decisions door; only the founder's tap erases.
 *   4. DEADLINE. The statutory window (45 days) is tracked per request; the
 *      `owner_optout_deadlines` job raises a founder card 10 days before it
 *      and again on any request past due, and its own absence pages through
 *      the deadman roster.
 */
import { randomBytes, randomInt, createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  leads,
  notifications,
  organizations,
  ownerOptOutRequests,
  ownerSuppressions,
  skipTraces,
  type OwnerOptOutOrgMatch,
  type OwnerOptOutRequest,
} from "@shared/schema";
import {
  DEADLINE_WARNING_DAYS,
  normalizeEmail,
  normalizeMailingAddress,
  normalizePhone,
  statutoryDaysFor,
  type OwnerIdentifiers,
} from "@shared/trust/ownerIdentifiers";
import { ownerIdentifierHashes, OWNER_OPTOUT_REASON } from "./ownerSuppression";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_DAYS = 7;
const MAIL_CODE_VERIFICATION_DAYS = 30;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MATCH_PAGE_SIZE = 5000;

export interface OwnerOptOutSubmission extends OwnerIdentifiers {
  city?: string | null;
  state?: string | null;
  residenceState?: string | null;
  wantsDeletion: boolean;
  verification: "email" | "mail_code";
}

export type SubmitResult =
  | { ok: true; ref: string; dueAt: Date; verification: "email" | "mail_code"; emailed: boolean }
  | { ok: false; reason: string };

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

/** Every lead, in every org, that carries one of these identifiers. Ids only. */
async function findMatchingLeads(ids: OwnerIdentifiers): Promise<Map<number, number[]>> {
  const email = normalizeEmail(ids.email);
  const phone = normalizePhone(ids.phone);
  const address = normalizeMailingAddress(ids.addressLine1, ids.zip);
  const conds = [];
  if (email) conds.push(sql`lower(trim(${leads.email})) = ${email}`);
  if (phone) conds.push(sql`right(regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g'), 10) = ${phone}`);
  if (address) conds.push(sql`left(regexp_replace(coalesce(${leads.zip}, ''), '[^0-9]', '', 'g'), 5) = ${address.split("|")[1]}`);
  const byOrg = new Map<number, number[]>();
  if (conds.length === 0) return byOrg;
  // Paged by id, never truncated: the address predicate is a ZIP prefilter, so
  // one ZIP can hold thousands of candidate rows across every org, and a
  // silently capped read would leave the real owner's leads unmatched — never
  // stamped, never offered for erasure.
  for (let afterId = 0; ; ) {
    const page = await unscopedForPlatformOps(
      "owner opt-out: a data-broker request is platform-wide; matching leads are found in every org",
    )
      .select({ id: leads.id, organizationId: leads.organizationId, email: leads.email, phone: leads.phone, address: leads.address, zip: leads.zip })
      .from(leads)
      .where(and(isNull(leads.deletedAt), gt(leads.id, afterId), or(...conds)))
      .orderBy(asc(leads.id))
      .limit(MATCH_PAGE_SIZE);
    for (const r of page) {
      const hit =
        (email && normalizeEmail(r.email) === email) ||
        (phone && normalizePhone(r.phone) === phone) ||
        (address && normalizeMailingAddress(r.address, r.zip) === address);
      if (!hit) continue;
      const list = byOrg.get(r.organizationId) ?? [];
      list.push(r.id);
      byOrg.set(r.organizationId, list);
    }
    if (page.length < MATCH_PAGE_SIZE) break;
    afterId = page[page.length - 1].id;
  }
  return byOrg;
}

export async function submitOwnerOptOut(input: OwnerOptOutSubmission): Promise<SubmitResult> {
  const hashes = ownerIdentifierHashes(input);
  if (hashes.length === 0) {
    return { ok: false, reason: "Give at least one of: an email address, a 10-digit phone number, or a street address with its ZIP code." };
  }
  const email = normalizeEmail(input.email);
  const address = normalizeMailingAddress(input.addressLine1, input.zip);
  if (input.verification === "email" && !email) {
    return { ok: false, reason: "To verify by email, give the email address we should send the link to." };
  }
  if (input.verification === "mail_code" && !address) {
    return { ok: false, reason: "To verify by mail, give the street address and ZIP code we should mail the code to." };
  }

  const now = clock.now();
  const statutoryDays = statutoryDaysFor(input.residenceState);
  const ref = randomBytes(12).toString("base64url");
  // A one-time secret (stored only as its sha256), drawn from the CSPRNG like
  // every other credential here: an emailed token, or a 6-digit mailed code.
  const secret =
    input.verification === "email"
      ? randomBytes(24).toString("base64url")
      : String(randomInt(100000, 1000000)) // unbiased, CSPRNG;
  const matches = await findMatchingLeads(input);
  const orgMatches: OwnerOptOutOrgMatch[] = Array.from(matches.entries()).map(([organizationId, leadIds]) => ({
    organizationId,
    leadIds,
    notifiedAt: null,
    deletion: { status: "not_requested", decidedAt: null, rowsErased: null, note: null },
  }));

  let pendingMailAddressEnc: string | null = null;
  if (input.verification === "mail_code") {
    const { encrypt } = await import("../fieldEncryption");
    // Held encrypted ONLY so the founder can mail the code; cleared on mailing.
    pendingMailAddressEnc = encrypt(
      JSON.stringify({ line1: input.addressLine1, city: input.city ?? "", state: input.state ?? "", zip: input.zip, code: secret }),
    );
  }

  await db.insert(ownerOptOutRequests).values({
    publicRef: ref,
    status: "pending_verification",
    verificationMethod: input.verification,
    verificationSecretHash: sha256(secret),
    verificationExpiresAt: new Date(
      now.getTime() + (input.verification === "email" ? EMAIL_VERIFICATION_DAYS : MAIL_CODE_VERIFICATION_DAYS) * DAY_MS,
    ),
    pendingMailAddressEnc,
    identifierHashes: hashes,
    wantsDeletion: input.wantsDeletion,
    residenceState: (input.residenceState ?? "").trim().toUpperCase().slice(0, 2) || null,
    statutoryDays,
    receivedAt: now,
    dueAt: new Date(now.getTime() + statutoryDays * DAY_MS),
    orgMatches,
  });

  let emailed = false;
  if (input.verification === "email" && email) {
    const base = process.env.APP_URL ?? "https://app.acreos.io";
    const link = `${base}/privacy/owner-request?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(secret)}`;
    const { emailService } = await import("../emailService");
    // AcreOS answering a request made to AcreOS itself: system lane,
    // transactional (no marketing footer). Sent once, at submission.
    const sent = await emailService.sendEmail({
      to: email,
      subject: "Confirm your request to AcreOS",
      html:
        `<p>Someone asked AcreOS to stop contacting this person and to delete their records.</p>` +
        `<p>If that was you, confirm here: <a href="${link}">${link}</a></p>` +
        `<p>The link works for ${EMAIL_VERIFICATION_DAYS} days. If you did not ask, ignore this email and nothing will change.</p>`,
      purpose: "system",
      transactional: true,
      idempotencyKey: `owner-optout-verify:${ref}`,
    });
    emailed = sent.success;
    if (!sent.success) {
      logger.warn("[ownerOptOut] verification email was not sent", { metadata: { error: sent.error } });
    }
  }
  return { ok: true, ref, dueAt: new Date(now.getTime() + statutoryDays * DAY_MS), verification: input.verification, emailed };
}

export type VerifyResult = { ok: true; status: "verified" | "completed"; suppressed: number } | { ok: false; reason: string };

export async function verifyOwnerOptOut(ref: string, secret: string): Promise<VerifyResult> {
  const [row] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.publicRef, ref)).limit(1);
  if (!row) return { ok: false, reason: "No request with that reference." };
  if (row.status !== "pending_verification") return { ok: false, reason: "This request is already confirmed." };
  const now = clock.now();
  if (row.verificationExpiresAt.getTime() < now.getTime()) return { ok: false, reason: "This confirmation has expired. Please submit a new request." };
  if (row.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) return { ok: false, reason: "Too many attempts. Please submit a new request." };
  if (!safeEqualHex(sha256(secret.trim()), row.verificationSecretHash)) {
    await db
      .update(ownerOptOutRequests)
      .set({ verificationAttempts: sql`${ownerOptOutRequests.verificationAttempts} + 1` })
      .where(eq(ownerOptOutRequests.id, row.id));
    return { ok: false, reason: "That code does not match." };
  }
  return applyVerifiedRequest(row, now);
}

/** Suppression applies the moment a request is verified — for every org. */
async function applyVerifiedRequest(row: OwnerOptOutRequest, now: Date): Promise<VerifyResult> {
  for (const h of row.identifierHashes) {
    await db
      .insert(ownerSuppressions)
      .values({ kind: h.kind, identifierHash: h.hash, requestId: row.id })
      .onConflictDoNothing({ target: [ownerSuppressions.kind, ownerSuppressions.identifierHash] });
  }

  const matches: OwnerOptOutOrgMatch[] = [];
  for (const m of row.orgMatches) {
    if (m.leadIds.length > 0) {
      await db
        .update(leads)
        .set({ doNotContact: true, optOutDate: now, optOutReason: OWNER_OPTOUT_REASON, updatedAt: now })
        .where(and(eq(leads.organizationId, m.organizationId), inArray(leads.id, m.leadIds)));
    }
    const notifiedAt = (await notifyOrgOfSuppression(m.organizationId, m.leadIds.length)) ? now.toISOString() : null;
    matches.push({
      ...m,
      notifiedAt,
      deletion: row.wantsDeletion
        ? { status: "awaiting_founder", decidedAt: null, rowsErased: null, note: null }
        : m.deletion,
    });
  }
  const done = !row.wantsDeletion || matches.length === 0;
  await db
    .update(ownerOptOutRequests)
    .set({
      status: done ? "completed" : "verified",
      verifiedAt: now,
      completedAt: done ? now : null,
      orgMatches: matches,
      pendingMailAddressEnc: null,
    })
    .where(eq(ownerOptOutRequests.id, row.id));
  logger.info("[ownerOptOut] request verified; suppression applied platform-wide", {
    metadata: { requestId: row.id, identifiers: row.identifierHashes.length, orgs: matches.length },
  });
  return { ok: true, status: done ? "completed" : "verified", suppressed: row.identifierHashes.length };
}

/** Tell the org's owner, in-app, that leads were suppressed. True when written. */
async function notifyOrgOfSuppression(organizationId: number, leadCount: number): Promise<boolean> {
  try {
    const [org] = await db
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return false;
    await db.insert(notifications).values({
      organizationId,
      userId: org.ownerId,
      type: "system_alert",
      title: leadCount === 1 ? "A lead asked not to be contacted" : `${leadCount} leads asked not to be contacted`,
      message:
        "A property owner asked AcreOS to stop all contact. Their records in your account are now marked do-not-contact, " +
        "and AcreOS will not send them mail, email, texts or calls from any account. Deleting the records is reviewed separately.",
      entityType: "lead",
      metadata: { source: "owner_optout", leadCount },
    });
    return true;
  } catch (err) {
    logger.error("[ownerOptOut] org notification failed", err instanceof Error ? err : undefined, { metadata: { organizationId } });
    return false;
  }
}

// ── Founder side ────────────────────────────────────────────────────────────

export interface FounderOptOutView {
  id: number;
  ref: string;
  status: string;
  verificationMethod: string;
  receivedAt: string;
  dueAt: string;
  daysLeft: number;
  wantsDeletion: boolean;
  identifierKinds: string[];
  /** Mail-code requests only, until mailed: where to mail the code, and the code. */
  mailCode: { line1: string; city: string; state: string; zip: string; code: string } | null;
  orgMatches: OwnerOptOutOrgMatch[];
}

export async function listOwnerOptOutsForFounder(): Promise<FounderOptOutView[]> {
  const rows = await db
    .select()
    .from(ownerOptOutRequests)
    .where(or(ne(ownerOptOutRequests.status, "completed"), sql`${ownerOptOutRequests.completedAt} > now() - interval '30 days'`))
    .orderBy(ownerOptOutRequests.dueAt)
    .limit(200);
  const now = clock.nowMs();
  const { decrypt } = await import("../fieldEncryption");
  return rows.map((r) => {
    let mailCode: FounderOptOutView["mailCode"] = null;
    if (r.pendingMailAddressEnc && !r.mailCodeMailedAt) {
      try {
        mailCode = JSON.parse(decrypt(r.pendingMailAddressEnc));
      } catch {
        mailCode = null;
      }
    }
    return {
      id: r.id,
      ref: r.publicRef,
      status: r.status,
      verificationMethod: r.verificationMethod,
      receivedAt: r.receivedAt.toISOString(),
      dueAt: r.dueAt.toISOString(),
      daysLeft: Math.ceil((r.dueAt.getTime() - now) / DAY_MS),
      wantsDeletion: r.wantsDeletion,
      identifierKinds: r.identifierHashes.map((h) => h.kind),
      mailCode,
      orgMatches: r.orgMatches,
    };
  });
}

export async function markMailCodeSent(requestId: number): Promise<boolean> {
  const updated = await db
    .update(ownerOptOutRequests)
    .set({ mailCodeMailedAt: clock.now() })
    .where(and(eq(ownerOptOutRequests.id, requestId), eq(ownerOptOutRequests.verificationMethod, "mail_code")))
    .returning({ id: ownerOptOutRequests.id });
  return updated.length > 0;
}

/**
 * The founder's ruling on ONE org's records for ONE request. Founder-only by
 * the route (requireFounder); there is no other caller, and no job calls it.
 * Approve = erase the personal fields of the matched leads (name, email,
 * phone, mailing address, notes), soft-delete them, and delete their
 * skip-trace results. The org keeps that a lead existed, never who it was.
 */
export async function decideOwnerDeletion(
  requestId: number,
  organizationId: number,
  approve: boolean,
  note: string | null,
): Promise<{ ok: true; rowsErased: number } | { ok: false; reason: string }> {
  const [row] = await db.select().from(ownerOptOutRequests).where(eq(ownerOptOutRequests.id, requestId)).limit(1);
  if (!row) return { ok: false, reason: "No such request." };
  const match = row.orgMatches.find((m) => m.organizationId === organizationId);
  if (!match) return { ok: false, reason: "That organization holds no matched records for this request." };
  if (match.deletion.status !== "awaiting_founder") return { ok: false, reason: "Already decided." };

  const now = clock.now();
  let rowsErased = 0;
  if (approve && match.leadIds.length > 0) {
    rowsErased = await db.transaction(async (tx) => {
      await tx
        .delete(skipTraces)
        .where(and(eq(skipTraces.organizationId, organizationId), inArray(skipTraces.leadId, match.leadIds)));
      const erased = await tx
        .update(leads)
        .set({
          firstName: "Deleted",
          lastName: "on request",
          email: null,
          phone: null,
          address: null,
          city: null,
          zip: null,
          notes: null,
          doNotContact: true,
          optOutReason: OWNER_OPTOUT_REASON,
          deletedAt: now,
          deletedBy: "owner_optout_request",
          updatedAt: now,
        })
        .where(and(eq(leads.organizationId, organizationId), inArray(leads.id, match.leadIds)))
        .returning({ id: leads.id });
      return erased.length;
    });
  }
  const orgMatches = row.orgMatches.map((m) =>
    m.organizationId === organizationId
      ? { ...m, deletion: { status: approve ? ("executed" as const) : ("declined" as const), decidedAt: now.toISOString(), rowsErased, note } }
      : m,
  );
  const allDecided = orgMatches.every((m) => m.deletion.status !== "awaiting_founder");
  await db
    .update(ownerOptOutRequests)
    .set({ orgMatches, status: allDecided ? "completed" : row.status, completedAt: allDecided ? now : null })
    .where(eq(ownerOptOutRequests.id, requestId));
  return { ok: true, rowsErased };
}

/**
 * The status a REQUESTER may see. Internally a confirmed request is
 * "completed" at once when no org held a matching record and "verified" while
 * an org's records await the founder — so exposing it would tell anyone who
 * controls one email whether ANY AcreOS customer holds a lead with the phone
 * or address they typed beside it (an enumeration oracle across every org).
 * Both read "confirmed" publicly.
 */
type PublicOwnerOptOutStatus = "pending_verification" | "confirmed" | "expired";
export function publicOwnerOptOutStatus(status: string): PublicOwnerOptOutStatus {
  if (status === "pending_verification") return "pending_verification";
  if (status === "expired") return "expired";
  return "confirmed";
}

/** What the requester may see by reference: no identifiers, no org names, nothing that varies with matches. */
export async function publicStatusOf(ref: string): Promise<{ status: PublicOwnerOptOutStatus; receivedAt: string; dueAt: string } | null> {
  const [row] = await db
    .select({ status: ownerOptOutRequests.status, receivedAt: ownerOptOutRequests.receivedAt, dueAt: ownerOptOutRequests.dueAt })
    .from(ownerOptOutRequests)
    .where(eq(ownerOptOutRequests.publicRef, ref))
    .limit(1);
  return row ? { status: publicOwnerOptOutStatus(row.status), receivedAt: row.receivedAt.toISOString(), dueAt: row.dueAt.toISOString() } : null;
}

// ── The statutory clock ─────────────────────────────────────────────────────

/** Pure: which open requests need the founder now. */
export function requestsNeedingDeadlineAlert(
  rows: Array<Pick<OwnerOptOutRequest, "id" | "status" | "dueAt" | "deadlineAlertedAt">>,
  now: Date,
): Array<{ id: number; overdue: boolean; daysLeft: number }> {
  const out: Array<{ id: number; overdue: boolean; daysLeft: number }> = [];
  for (const r of rows) {
    if (r.status === "completed" || r.status === "expired") continue;
    const msLeft = r.dueAt.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / DAY_MS);
    const overdue = msLeft <= 0;
    if (daysLeft > DEADLINE_WARNING_DAYS) continue;
    // Warn once; once overdue, re-raise daily until it is closed.
    if (!overdue && r.deadlineAlertedAt) continue;
    if (overdue && r.deadlineAlertedAt && now.getTime() - r.deadlineAlertedAt.getTime() < DAY_MS) continue;
    out.push({ id: r.id, overdue, daysLeft });
  }
  return out;
}

export async function runOwnerOptOutDeadlineCheck(now: Date = clock.now()): Promise<{ alerted: number; expired: number }> {
  // Unconfirmed requests whose confirmation window lapsed: nothing was
  // verified, so nothing was suppressed — they close as expired.
  const expired = await db
    .update(ownerOptOutRequests)
    .set({ status: "expired", pendingMailAddressEnc: null })
    .where(and(eq(ownerOptOutRequests.status, "pending_verification"), lte(ownerOptOutRequests.verificationExpiresAt, now)))
    .returning({ id: ownerOptOutRequests.id });

  const open = await db
    .select({
      id: ownerOptOutRequests.id,
      status: ownerOptOutRequests.status,
      dueAt: ownerOptOutRequests.dueAt,
      deadlineAlertedAt: ownerOptOutRequests.deadlineAlertedAt,
    })
    .from(ownerOptOutRequests)
    .where(inArray(ownerOptOutRequests.status, ["pending_verification", "verified"]));
  const due = requestsNeedingDeadlineAlert(open, now);
  if (due.length > 0) {
    const overdue = due.filter((d) => d.overdue).length;
    const subject = overdue > 0
      ? `${overdue} owner deletion request(s) are PAST their legal deadline`
      : `${due.length} owner deletion request(s) are due within ${DEADLINE_WARNING_DAYS} days`;
    logger.error(`[ownerOptOut] ${subject}`, undefined, { metadata: { kind: "founder_alert", requests: due } });
    const { decisionsInboxService } = await import("../decisionsInbox");
    await decisionsInboxService.createDirectDecisionCard({
      itemType: "critical_alert",
      riskLevel: overdue > 0 ? "critical" : "high",
      urgencyScore: overdue > 0 ? 95 : 75,
      sophieAnalysis:
        `${subject}. The statutory window is counted from the day each request was received; this card is raised ` +
        `${DEADLINE_WARNING_DAYS} days before it closes, and every day once it has. ` +
        "Open Decisions → Owner requests to mail codes or rule on each org's records.",
      recommendedAction: "Rule on the open owner requests",
      recommendedActionLabel: "Open owner requests",
      subject,
      options: [],
    });
    await db
      .update(ownerOptOutRequests)
      .set({ deadlineAlertedAt: now })
      .where(inArray(ownerOptOutRequests.id, due.map((d) => d.id)));
  }
  return { alerted: due.length, expired: expired.length };
}
