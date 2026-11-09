/**
 * Click-to-call — a human operator calls a lead through the ORG'S OWN Twilio.
 *
 * The bridge: AcreOS asks the org's own Twilio account to ring the operator's
 * own verified phone first; when they answer, Twilio dials the lead with the
 * org's own number as caller ID. A human speaks on both legs. Nothing is
 * recorded or transcribed, and AcreOS charges nothing (Twilio bills the org).
 *
 * INERT BY CONSTRUCTION. A call is placed only when ALL of these hold, and the
 * first that fails is the honest reason shown before dialling and logged when
 * a call is refused:
 *   1. the org has its own connected Twilio identity (no platform fallback —
 *      the provider resolves BYO credentials only);
 *   2. DNC scrubbing is configured (the existing seam, `compliance/dncScrub`);
 *      with no vendor selected the seam is inert for SMS, but a call REFUSES —
 *      and the test fixture list is not a scrub outside tests;
 *   3. the operator has a verified phone on their account (Clerk);
 *   4. the lead exists, has a dialable US number, and nobody at that number
 *      has opted out — per lead (do-not-contact / STOP) or platform-wide
 *      (the owner opt-out list);
 *   5. every lead at the number has prior express WRITTEN consent — the
 *      strictest existing rule (the cold-text rule). Whether a non-written
 *      TCPA grant licenses an operator-dialled call is an open founder/legal
 *      question; until it is decided this gate asks for written consent;
 *   6. it is inside 8 AM–9 PM for every lead at the number (their own zone,
 *      or every continental zone when it is unknown);
 *   7. the DNC scrub of the number passes: a litigator or registry hit
 *      refuses, and an unverifiable scrub refuses (fail closed);
 *   8. the contact-frequency cap (evaluated last, as for prospecting texts).
 * Steps 1–6 and 8 cost nothing; the paid scrub runs only when placing a call,
 * so the pre-dial verdict never spends a lookup.
 */
import { storage, db } from "../storage";
import { users, leads, type Lead, type ActivityEvent } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { commsRouter } from "./comms/router";
import { orgByoTwilioNumber } from "./comms/providers/twilio";
import { getConfiguredDncProvider, scrubPhone, evaluateDncGate, type DncScrubOutcome } from "./compliance/dncScrub";
import { checkTcpaConsentFromLead, hasWrittenSmsConsent, isWithinQuietHours } from "./tcpaCompliance";
import { leadHasOptedOut } from "./leadContactability";
import { ownerContactRefusal, assertOwnerContactAllowed } from "./trust/ownerSuppression";
import { frequencyGateForLead, describeFrequencySkip, recordContactTouch } from "./compliance/contactFrequency";

export type CallGateCode =
  | "ok"
  | "no_identity"
  | "dnc_not_configured"
  | "no_operator_phone"
  | "lead_not_found"
  | "no_lead_phone"
  | "opted_out"
  | "no_consent"
  | "quiet_hours"
  | "dnc_refused"
  | "frequency_cap"
  | "unavailable";

export interface CallGateVerdict {
  allowed: boolean;
  code: CallGateCode;
  /** Customer-readable: why it is blocked, or what will happen. */
  reason: string;
  /** The org's own number the lead will see (not a secret). */
  callerId?: string;
  /** The operator's phone, masked to its last four digits. */
  operatorPhoneMasked?: string;
}

interface GateContext {
  verdict: CallGateVerdict;
  lead?: Lead;
  dialTo?: string;
  ringFirst?: string;
}

/** A US number as E.164, or null when it is not a dialable US number. */
function usE164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

function mask(phone: string): string {
  return `•••${phone.replace(/\D/g, "").slice(-4)}`;
}

const refuse = (code: CallGateCode, reason: string): CallGateVerdict => ({ allowed: false, code, reason });

interface ClerkUserPhones {
  primaryPhoneNumberId?: string | null;
  phoneNumbers?: Array<{ id: string; phoneNumber: string; verification?: { status?: string } | null }>;
}

/**
 * The operator's own verified phone, from their sign-in account (Clerk). Only
 * a number Clerk reports as VERIFIED counts: the first leg must ring a phone
 * the operator proved they control, never a number typed into a form.
 */
async function operatorVerifiedPhone(userId: string): Promise<string | null> {
  const [u] = await db.select({ clerkUserId: users.clerkUserId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.clerkUserId) return null;
  const { clerkClient } = await import("@clerk/express");
  const cu = (await clerkClient.users.getUser(u.clerkUserId)) as unknown as ClerkUserPhones;
  const verified = (Array.isArray(cu?.phoneNumbers) ? cu.phoneNumbers : []).filter(
    (p) => p?.verification?.status === "verified" && usE164(p?.phoneNumber),
  );
  const primary = verified.find((p) => p.id === cu?.primaryPhoneNumberId) ?? verified[0];
  return primary ? usE164(primary.phoneNumber) : null;
}

/**
 * Is a DNC scrub actually available for a call? No vendor selected → no.
 * The in-repo fixture list holds only reserved fictional numbers, so it
 * checks no real number: it counts only under the test runner.
 */
function dncScrubAvailableForCalls(): boolean {
  const provider = getConfiguredDncProvider();
  if (!provider) return false;
  if (provider.name === "fixture" && process.env.NODE_ENV !== "test") return false;
  return true;
}

/** The consent verdict for one lead: written consent, not opted out. */
function callConsentVerdict(lead: Lead): { allowed: boolean; reason?: string } {
  if (leadHasOptedOut(lead)) return { allowed: false, reason: "This lead has opted out of contact (do not contact)." };
  if (!checkTcpaConsentFromLead(lead).canCall) {
    return { allowed: false, reason: "This lead has no calling consent on record." };
  }
  if (!hasWrittenSmsConsent(lead)) {
    return {
      allowed: false,
      reason: `This lead's consent is not written (source: ${lead.consentSource ?? "unknown"}). A call needs prior express written consent — a web form, a written form, a texted opt-in or a keypress.`,
    };
  }
  return { allowed: true };
}

async function runFreeGates(organizationId: number, leadId: number, userId: string): Promise<GateContext> {
  const callerId = await orgByoTwilioNumber(organizationId);
  if (!callerId) {
    return {
      verdict: refuse(
        "no_identity",
        "Connect your own Twilio account in Settings to call from your number. AcreOS never places calls on its own account.",
      ),
    };
  }
  if (!dncScrubAvailableForCalls()) {
    return {
      verdict: refuse(
        "dnc_not_configured",
        "DNC scrubbing is not configured, so AcreOS cannot check this number against the Do-Not-Call lists. Calls stay off until it is.",
      ),
    };
  }
  const ringFirst = await operatorVerifiedPhone(userId);
  if (!ringFirst) {
    return {
      verdict: refuse(
        "no_operator_phone",
        "Add and verify your mobile number in Settings → Security. The call rings your phone first, then connects you to the lead.",
      ),
    };
  }
  const lead = await storage.getLead(organizationId, leadId);
  if (!lead) return { verdict: refuse("lead_not_found", "Lead not found.") };
  const dialTo = usE164(lead.phone);
  if (!dialTo) return { verdict: refuse("no_lead_phone", "This lead has no dialable US phone number."), lead };

  // Everyone AcreOS holds at this number must allow the call — two leads
  // sharing a number must not resolve by row order.
  const atNumber = await storage.findLeadsByPhoneLast10(organizationId, dialTo);
  const people = atNumber.some((l) => l.id === lead.id) ? atNumber : [lead, ...atNumber];
  const optedOut = people.find((l) => leadHasOptedOut(l));
  if (optedOut) return { verdict: refuse("opted_out", "This number has opted out of contact (do not contact)."), lead };
  const ownerRefusal = await ownerContactRefusal("voice", { phone: dialTo });
  if (ownerRefusal) return { verdict: refuse("opted_out", ownerRefusal), lead };
  for (const l of people) {
    const consent = callConsentVerdict(l);
    if (!consent.allowed) return { verdict: refuse("no_consent", consent.reason ?? "No consent on record."), lead };
  }
  for (const l of people) {
    const quiet = isWithinQuietHours(dialTo, l.timezone ?? null);
    if (quiet.blocked) return { verdict: refuse("quiet_hours", quiet.reason ?? "Outside 8 AM–9 PM for this lead."), lead };
  }
  const frequency = await frequencyGateForLead(organizationId, lead.id);
  if (!frequency.allowed) return { verdict: refuse("frequency_cap", describeFrequencySkip(frequency)), lead };

  return {
    verdict: {
      allowed: true,
      code: "ok",
      reason: `Your phone (${mask(ringFirst)}) rings first. When you answer, AcreOS dials the lead from your number ${callerId}. The number is checked against the Do-Not-Call lists when you call.`,
      callerId,
      operatorPhoneMasked: mask(ringFirst),
    },
    lead,
    dialTo,
    ringFirst,
  };
}

/** The pre-dial verdict. Spends nothing and writes nothing. */
export async function evaluateCallGate(input: { organizationId: number; leadId: number; userId: string }): Promise<CallGateVerdict> {
  try {
    return (await runFreeGates(input.organizationId, input.leadId, input.userId)).verdict;
  } catch (err) {
    logger.error("[clickToCall] gate could not be evaluated — refusing", err instanceof Error ? err : undefined, {
      metadata: { organizationId: input.organizationId },
    });
    return refuse("unavailable", "The call could not be checked right now, so it was not placed. Try again in a moment.");
  }
}

async function logTimeline(
  organizationId: number,
  leadId: number,
  eventType: "call_made" | "call_not_placed",
  description: string,
  metadata: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await storage.createActivityEvent({ organizationId, entityType: "lead", entityId: leadId, eventType, description, metadata, userId });
  } catch (err) {
    logger.error("[clickToCall] timeline write failed", err instanceof Error ? err : undefined, { metadata: { organizationId } });
  }
}

export interface PlaceCallResult {
  placed: boolean;
  code: CallGateCode;
  reason: string;
  simulated?: boolean;
}

/** Callback URL for one leg. The org and lead are bound by Twilio's signature over it. */
function callStatusCallbackUrl(base: string, organizationId: number, leadId: number, leg: "operator" | "lead"): string {
  return `${base.replace(/\/+$/, "")}/api/webhooks/twilio/call-status/${organizationId}/${leadId}/${leg}`;
}

/**
 * Re-run every gate (the pre-dial verdict is never trusted), scrub the number,
 * and place ONE bridge call on the org's own Twilio. Every outcome is logged
 * to the lead timeline: a refusal with its reason, or the started call.
 */
export async function placeLeadCall(input: { organizationId: number; leadId: number; userId: string }): Promise<PlaceCallResult> {
  const { organizationId, leadId, userId } = input;
  const done = async (r: PlaceCallResult, known?: Lead): Promise<PlaceCallResult> => {
    // A setup refusal stops before the lead is read; read it to log the attempt.
    const lead = known ?? (await storage.getLead(organizationId, leadId).catch(() => undefined));
    if (!r.placed && lead) {
      await logTimeline(organizationId, lead.id, "call_not_placed", `Call not placed: ${r.reason}`, { status: "refused", gate: r.code }, userId);
    }
    return r;
  };
  let ctx: GateContext;
  try {
    ctx = await runFreeGates(organizationId, leadId, userId);
  } catch (err) {
    logger.error("[clickToCall] gate could not be evaluated — refusing", err instanceof Error ? err : undefined, { metadata: { organizationId } });
    return done({ placed: false, code: "unavailable", reason: "The call could not be checked right now, so it was not placed." });
  }
  if (!ctx.verdict.allowed || !ctx.lead || !ctx.dialTo || !ctx.ringFirst) {
    return done({ placed: false, code: ctx.verdict.code, reason: ctx.verdict.reason }, ctx.lead);
  }
  const { lead, dialTo, ringFirst } = ctx;

  // The paid DNC scrub, through the existing seam. A registry listing refuses
  // even with written consent (whether written consent overrides the registry
  // for a CALL is part of the open founder/legal question); a litigator hit
  // refuses; an unverifiable scrub refuses.
  let outcome: DncScrubOutcome | null;
  try {
    outcome = await scrubPhone(organizationId, dialTo);
  } catch {
    outcome = { status: "error", provider: "unknown" };
  }
  if (outcome === null) {
    return done({ placed: false, code: "dnc_not_configured", reason: "DNC scrubbing is not configured, so AcreOS cannot check this number against the Do-Not-Call lists." }, lead);
  }
  const dnc = evaluateDncGate(outcome, { leadMatched: true, hasConsent: false, scrubErrorPosture: "fail_closed" });
  if (!dnc.allowed) {
    return done({ placed: false, code: "dnc_refused", reason: dnc.reason ?? "The Do-Not-Call check refused this number." }, lead);
  }

  const base = (process.env.APP_URL || "").trim();
  if (!/^https?:\/\//.test(base)) {
    return done({ placed: false, code: "unavailable", reason: "Calling is unavailable: this deployment has no public address for call status updates." }, lead);
  }

  let sid: string;
  let simulated = false;
  try {
    // Last check at the send unit, against the person being called.
    await assertOwnerContactAllowed("voice", { phone: dialTo });
    const result = await commsRouter.initiateCall({
      to: dialTo,
      voice: { kind: "human" },
      organizationId,
      preferredProvider: "twilio",
      feature: "click_to_call",
      statusCallbackUrl: callStatusCallbackUrl(base, organizationId, lead.id, "operator"),
      bridge: { ringFirst, counterpartyStatusCallbackUrl: callStatusCallbackUrl(base, organizationId, lead.id, "lead") },
    });
    sid = result.sid;
    simulated = result.simulated === true;
  } catch (err) {
    logger.warn("[clickToCall] call was not placed", { metadata: { organizationId, error: err instanceof Error ? err.message : String(err) } });
    return done({ placed: false, code: "unavailable", reason: "Twilio did not accept the call, so nothing was dialled. Check your Twilio account and try again." }, lead);
  }

  if (simulated) {
    await logTimeline(organizationId, lead.id, "call_not_placed", "Call simulated (simulation mode) — no call was placed.", { status: "simulated" }, userId);
    return { placed: false, code: "unavailable", reason: "Simulation mode is on — the call was recorded, not placed.", simulated: true };
  }
  await logTimeline(
    organizationId,
    lead.id,
    "call_made",
    `Call started from ${ctx.verdict.callerId}: ringing your phone first, then the lead.`,
    { status: "initiated", callSid: sid, callerId: ctx.verdict.callerId, operatorPhone: mask(ringFirst) },
    userId,
  );
  // Counts toward the contact-frequency cap only once Twilio accepted it.
  await recordContactTouch({ organizationId, leadId: lead.id, channel: "phone", messageId: sid, description: "Call placed (click-to-call)" });
  return { placed: true, code: "ok", reason: `Ringing your phone (${mask(ringFirst)}). Answer to be connected.` };
}

const LEAD_LEG_TEXT: Record<string, string> = {
  completed: "Call completed",
  busy: "The lead's line was busy",
  "no-answer": "The lead did not answer",
  failed: "The call to the lead failed",
  canceled: "The call was canceled before the lead answered",
};
const OPERATOR_LEG_TEXT: Record<string, string> = {
  busy: "Your phone was busy, so the lead was not dialled",
  "no-answer": "You did not answer, so the lead was not dialled",
  failed: "Your phone could not be reached, so the lead was not dialled",
  canceled: "The call was canceled before the lead was dialled",
};

/**
 * Record a VERIFIED Twilio status callback (verifyOrgTwilioCallCallback ran
 * first). Writes only to this org's lead, and only for a call AcreOS started
 * for that lead — a callback naming any other call writes nothing.
 */
export async function recordCallStatus(input: {
  organizationId: number;
  leadId: number;
  leg: "operator" | "lead";
  body: Record<string, unknown>;
}): Promise<{ written: boolean }> {
  const { organizationId, leadId, leg, body } = input;
  const status = String(body.CallStatus ?? "");
  const parentSid = String((leg === "lead" ? body.ParentCallSid : body.CallSid) ?? "");
  if (!parentSid) return { written: false };
  const text = leg === "lead" ? LEAD_LEG_TEXT[status] : OPERATOR_LEG_TEXT[status];
  if (!text) return { written: false }; // operator "completed" → the lead leg reports the outcome
  // Existence only: the callback needs no contact field, so it reads the id
  // and nothing else (a status callback is not a person-adjacent read).
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.id, leadId)))
    .limit(1);
  if (!lead) return { written: false };
  const events: ActivityEvent[] = await storage.getActivityEvents(organizationId, "lead", leadId, ["call_made", "call_not_placed"]);
  const meta = (e: ActivityEvent) => (e.metadata ?? {}) as Record<string, unknown>;
  const ours = events.some((e) => meta(e).callSid === parentSid && meta(e).status === "initiated");
  if (!ours) return { written: false };
  const already = events.some((e) => meta(e).callSid === parentSid && meta(e).leg === leg && meta(e).status !== "initiated");
  if (already) return { written: false };
  const duration = Number(body.CallDuration);
  const callDuration = leg === "lead" && status === "completed" && Number.isFinite(duration) ? duration : undefined;
  await storage.createActivityEvent({
    organizationId,
    entityType: "lead",
    entityId: leadId,
    eventType: leg === "lead" ? "call_made" : "call_not_placed",
    description: text + ".",
    metadata: { status, leg, callSid: parentSid, ...(callDuration !== undefined ? { callDuration } : {}) },
  });
  return { written: true };
}
