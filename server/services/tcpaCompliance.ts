import { db } from "../db";
import { storage } from "../storage";
import { leads, activityLog } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import type { Lead } from "@shared/schema";
import { logger } from "../utils/logger";

// ─── TCPA QUIET-HOURS NOTE ────────────────────────────────────────────────────
// TCPA § 64.1200(c)(1) and most state mini-TCPAs require contact between
// 8:00 AM and 9:00 PM in the *recipient's* local time. The recipient's
// location is NOT reliably inferable from a phone number — a 503 area
// code could belong to a Portland resident or someone who kept their
// Oregon mobile number after relocating to Miami. The only correct
// source for quiet-hours math is `leads.timezone` (an IANA zone) set
// from explicit user signal (address, profile, IP-geolocation at
// signup). The area-code fallback below is a *defensive* heuristic for
// leads with no timezone on file — when in doubt, it skews toward
// blocking (we use the wider envelope, treating ambiguity as "do not
// send").
//
// TODO: add `timezone` column to `leads` (IANA, e.g. "America/Chicago")
// and call `isWithinQuietHoursForLead(lead, now)` from every send site.
// Area-code inference is preserved only as a last-resort fallback.
// ─────────────────────────────────────────────────────────────────────────────

export interface TcpaConsentResult {
  allowed: boolean;
  reason?: string;
  blockedChannels: ('email' | 'sms' | 'direct_mail' | 'phone')[];
}

export interface TcpaCheckResult {
  canEmail: boolean;
  canSms: boolean;
  canCall: boolean;
  canDirectMail: boolean;
  blocked: boolean;
  reason?: string;
}

// TCPA quiet hours: 8 AM – 9 PM in the recipient's local timezone.
//
// Primary: when the lead has an IANA zone on file (`leads.timezone`),
//   compute the current wall-clock hour in *that* zone via
//   Intl.DateTimeFormat — this is the only DST-correct path.
// Fallback: area-code → IANA-zone lookup. Plaintiff-side experts will
//   point out that area codes are unreliable post-LNP (Local Number
//   Portability, 2003), but it's better than nothing for unknown leads.
//   We pick a representative IANA zone per area code so Intl handles
//   DST automatically.
//
// Data corrections in this revision:
//   * 253 (Tacoma WA) was Pacific in original — now America/Los_Angeles.
//   * 503 (Portland OR) was incorrectly marked Pacific in original
//     code but grouped under the "Central" comment block — now
//     America/Los_Angeles, comment removed.
//   * 670 (Saipan / Northern Marianas) and 671 (Guam) were grouped
//     under "Mountain" — both are ChST (UTC+10, no DST). Now
//     Pacific/Saipan + Pacific/Guam.
//   * 506 (New Brunswick CA) and 787/340 (PR/USVI) were grouped wrong
//     — corrected to America/Halifax / America/Puerto_Rico /
//     America/St_Thomas.
//   * Several area codes lived under a comment block whose UTC range
//     contradicted their actual offset. The comment blocks are gone;
//     IANA zones carry the truth.
const AREA_CODE_TZ: Record<string, string> = {
  // Eastern Time (US)
  '201': 'America/New_York', '202': 'America/New_York', '203': 'America/New_York',
  '207': 'America/New_York', '212': 'America/New_York', '215': 'America/New_York',
  '216': 'America/New_York', '217': 'America/Chicago',  '218': 'America/Chicago',
  '219': 'America/Chicago',  '224': 'America/Chicago',  '225': 'America/Chicago',
  '229': 'America/New_York', '231': 'America/Detroit',  '234': 'America/New_York',
  '239': 'America/New_York', '240': 'America/New_York', '248': 'America/Detroit',
  '251': 'America/Chicago',  '252': 'America/New_York', '253': 'America/Los_Angeles',
  '256': 'America/Chicago',  '267': 'America/New_York', '269': 'America/Detroit',
  '270': 'America/Chicago',  '272': 'America/New_York', '276': 'America/New_York',
  '301': 'America/New_York', '302': 'America/New_York', '304': 'America/New_York',
  '305': 'America/New_York', '309': 'America/Chicago',  '310': 'America/Los_Angeles',
  '312': 'America/Chicago',  '313': 'America/Detroit',  '315': 'America/New_York',
  '317': 'America/Indiana/Indianapolis', '318': 'America/Chicago',
  '319': 'America/Chicago',  '320': 'America/Chicago',  '321': 'America/New_York',
  '323': 'America/Los_Angeles', '325': 'America/Chicago', '330': 'America/New_York',
  '331': 'America/Chicago',  '332': 'America/New_York', '334': 'America/Chicago',
  '336': 'America/New_York', '337': 'America/Chicago',  '339': 'America/New_York',
  '340': 'America/St_Thomas', // USVI — Atlantic, no DST
  '346': 'America/Chicago',  '347': 'America/New_York', '351': 'America/New_York',
  '352': 'America/New_York', '361': 'America/Chicago',  '364': 'America/Chicago',
  '380': 'America/New_York', '385': 'America/Denver',   '386': 'America/New_York',
  '401': 'America/New_York', '404': 'America/New_York', '405': 'America/Chicago',
  '406': 'America/Denver',   '407': 'America/New_York', '408': 'America/Los_Angeles',
  '409': 'America/Chicago',  '410': 'America/New_York', '412': 'America/New_York',
  '413': 'America/New_York', '414': 'America/Chicago',  '415': 'America/Los_Angeles',
  '417': 'America/Chicago',  '419': 'America/New_York', '423': 'America/New_York',
  '424': 'America/Los_Angeles', '425': 'America/Los_Angeles',
  '430': 'America/Chicago',  '432': 'America/Chicago',  '434': 'America/New_York',
  '435': 'America/Denver',   '440': 'America/New_York', '442': 'America/Los_Angeles',
  '443': 'America/New_York', '458': 'America/Los_Angeles', '463': 'America/Indiana/Indianapolis',
  '469': 'America/Chicago',  '470': 'America/New_York', '475': 'America/New_York',
  '478': 'America/New_York', '479': 'America/Chicago',  '480': 'America/Phoenix',
  '484': 'America/New_York',
  '501': 'America/Chicago',  '502': 'America/New_York', '503': 'America/Los_Angeles',
  '504': 'America/Chicago',  '505': 'America/Denver',
  '506': 'America/Halifax',  // New Brunswick CA — Atlantic with DST
  '507': 'America/Chicago',  '508': 'America/New_York', '509': 'America/Los_Angeles',
  '510': 'America/Los_Angeles', '512': 'America/Chicago', '513': 'America/New_York',
  '515': 'America/Chicago',  '516': 'America/New_York', '517': 'America/Detroit',
  '518': 'America/New_York', '520': 'America/Phoenix',  '530': 'America/Los_Angeles',
  '531': 'America/Chicago',  '534': 'America/Chicago',  '539': 'America/Chicago',
  '540': 'America/New_York', '541': 'America/Los_Angeles', '551': 'America/New_York',
  '557': 'America/Chicago',  '559': 'America/Los_Angeles', '561': 'America/New_York',
  '562': 'America/Los_Angeles', '563': 'America/Chicago', '564': 'America/Los_Angeles',
  '567': 'America/New_York', '570': 'America/New_York', '571': 'America/New_York',
  '573': 'America/Chicago',  '574': 'America/Indiana/Indianapolis',
  '575': 'America/Denver',   '580': 'America/Chicago',  '585': 'America/New_York',
  '586': 'America/Detroit',
  '601': 'America/Chicago',  '602': 'America/Phoenix',  '603': 'America/New_York',
  '605': 'America/Chicago',  '606': 'America/New_York', '607': 'America/New_York',
  '608': 'America/Chicago',  '609': 'America/New_York', '610': 'America/New_York',
  '612': 'America/Chicago',  '614': 'America/New_York', '615': 'America/Chicago',
  '616': 'America/Detroit',  '617': 'America/New_York', '618': 'America/Chicago',
  '619': 'America/Los_Angeles', '620': 'America/Chicago', '623': 'America/Phoenix',
  '626': 'America/Los_Angeles', '628': 'America/Los_Angeles', '629': 'America/Chicago',
  '630': 'America/Chicago',  '631': 'America/New_York', '636': 'America/Chicago',
  '641': 'America/Chicago',  '646': 'America/New_York', '650': 'America/Los_Angeles',
  '651': 'America/Chicago',  '657': 'America/Los_Angeles', '659': 'America/Chicago',
  '660': 'America/Chicago',  '661': 'America/Los_Angeles', '662': 'America/Chicago',
  '667': 'America/New_York', '669': 'America/Los_Angeles',
  '670': 'Pacific/Saipan',   // Northern Mariana Islands — ChST UTC+10, no DST
  '671': 'Pacific/Guam',     // Guam — ChST UTC+10, no DST
  '678': 'America/New_York', '679': 'America/Detroit',
  '701': 'America/Chicago',  '702': 'America/Los_Angeles', '703': 'America/New_York',
  '704': 'America/New_York', '706': 'America/New_York', '707': 'America/Los_Angeles',
  '708': 'America/Chicago',  '712': 'America/Chicago',  '713': 'America/Chicago',
  '714': 'America/Los_Angeles', '715': 'America/Chicago', '716': 'America/New_York',
  '717': 'America/New_York', '718': 'America/New_York', '719': 'America/Denver',
  '720': 'America/Denver',   '724': 'America/New_York', '725': 'America/Los_Angeles',
  '726': 'America/Chicago',  '727': 'America/New_York', '731': 'America/Chicago',
  '732': 'America/New_York', '734': 'America/Detroit',  '737': 'America/Chicago',
  '740': 'America/New_York', '747': 'America/Los_Angeles', '754': 'America/New_York',
  '757': 'America/New_York', '760': 'America/Los_Angeles', '762': 'America/New_York',
  '763': 'America/Chicago',  '765': 'America/Indiana/Indianapolis',
  '769': 'America/Chicago',  '770': 'America/New_York', '772': 'America/New_York',
  '773': 'America/Chicago',  '774': 'America/New_York', '775': 'America/Los_Angeles',
  '779': 'America/Chicago',  '781': 'America/New_York', '785': 'America/Chicago',
  '786': 'America/New_York',
  '787': 'America/Puerto_Rico', // PR — Atlantic, no DST
};

/**
 * Resolve an IANA timezone string from a phone number's area code, using
 * Intl-friendly zone names so DST is handled correctly. Defaults to
 * "America/New_York" if the area code is unknown (intentionally pessimistic
 * for North America — see file header).
 */
export function getZoneForPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  // Strip country code if present
  const local = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  const areaCode = local.slice(0, 3);
  return AREA_CODE_TZ[areaCode] ?? 'America/New_York';
}

/**
 * Compute current wall-clock hour & minute for an IANA zone. Uses
 * Intl.DateTimeFormat so DST transitions are honored (this is the only
 * correct way — manually adding a fixed UTC offset is broken twice a year).
 */
function getLocalHourInZone(zone: string, now: Date = new Date()): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '0';
    // Intl with hour12:false can emit "24" at midnight in some locales — normalize.
    let hour = Number(hourPart);
    if (hour === 24) hour = 0;
    return { hour, minute: Number(minutePart) };
  } catch (err) {
    logger.warn(`[TCPA] Unknown IANA zone "${zone}" — defaulting to America/New_York`);
    return getLocalHourInZone('America/New_York', now);
  }
}

/**
 * Check if current time is within TCPA-compliant calling hours
 * (8 AM – 9 PM local time of recipient).
 *
 * Primary path: pass an explicit IANA zone via the second argument when
 * the lead has `leads.timezone` set — this is the only legally defensible
 * source of truth. The fall-back area-code lookup is best-effort.
 */
export function isWithinQuietHours(
  phoneNumber: string,
  recipientZone?: string | null,
): { blocked: boolean; reason?: string; zone: string } {
  const zone = recipientZone || getZoneForPhone(phoneNumber);
  const { hour, minute } = getLocalHourInZone(zone);
  const localTime = hour + minute / 60;

  if (localTime < 8 || localTime >= 21) {
    return {
      blocked: true,
      zone,
      reason: `TCPA quiet hours: cannot contact before 8 AM or after 9 PM recipient local time (${zone}). Current local time: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`,
    };
  }
  return { blocked: false, zone };
}

/**
 * Lead-aware quiet-hours check. Prefers the lead's explicit IANA zone if
 * present; otherwise falls back to area-code inference. Use this from
 * every send site that has the lead object in hand.
 */
export function isWithinQuietHoursForLead(
  lead: Pick<Lead, 'phone'> & { timezone?: string | null },
  phoneOverride?: string,
): { blocked: boolean; reason?: string; zone: string } {
  const phone = phoneOverride ?? lead.phone ?? '';
  return isWithinQuietHours(phone, lead.timezone ?? null);
}

// STOP keywords per CTIA/TCPA guidelines
const STOP_KEYWORDS = new Set([
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt-out',
]);

const START_KEYWORDS = new Set(['start', 'yes', 'unstop', 'optin', 'opt-in']);

/**
 * Detect if an inbound SMS is an opt-out or opt-in signal.
 * Returns: 'opt_out' | 'opt_in' | null
 */
export function detectOptKeyword(messageBody: string): 'opt_out' | 'opt_in' | null {
  const normalized = messageBody.trim().toLowerCase().replace(/[^a-z-]/g, '');
  if (STOP_KEYWORDS.has(normalized)) return 'opt_out';
  if (START_KEYWORDS.has(normalized)) return 'opt_in';
  return null;
}

/**
 * Process an inbound SMS opt-out/opt-in for a lead.
 * Updates doNotContact / tcpaConsent accordingly and logs to audit trail.
 */
export async function processOptKeyword(
  organizationId: number,
  phone: string,
  messageBody: string,
  messageSid: string
): Promise<{ action: 'opt_out' | 'opt_in' | 'none'; leadId?: number }> {
  const action = detectOptKeyword(messageBody);
  if (!action) return { action: 'none' };

  // Find the lead by phone number
  const allLeads = await db
    .select({ id: leads.id, phone: leads.phone })
    .from(leads)
    .where(eq(leads.organizationId, organizationId));

  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  const matched = allLeads.find(l => (l.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone);
  if (!matched) return { action };

  const now = new Date();
  if (action === 'opt_out') {
    await db
      .update(leads)
      .set({
        doNotContact: true,
        tcpaConsent: false,
        optOutDate: now,
        optOutReason: `SMS STOP keyword: "${messageBody.trim()}" (${messageSid})`,
        updatedAt: now,
      })
      .where(and(eq(leads.id, matched.id), eq(leads.organizationId, organizationId)));

    await db.insert(activityLog).values({
      organizationId,
      entityType: 'lead',
      entityId: matched.id,
      action: 'tcpa_opt_out',
      metadata: { messageSid, phone, keyword: messageBody.trim(), inboundText: messageBody, channel: 'sms', revokedChannels: ['sms','email','phone','direct_mail'] },
    });
    try {
      const { recordConsentRevoked } = await import('./consentEvents');
      await recordConsentRevoked({
        organizationId,
        leadId: matched.id,
        channels: ['sms', 'email', 'phone', 'direct_mail'],
        source: 'inbound_stop',
        inboundMessageText: messageBody,
        inboundMessageSid: messageSid,
        inboundFromPhone: phone,
        recordedBy: 'tcpa_opt_keyword',
      });
    } catch { /* best-effort */ }
    logger.info(`[TCPA] Lead ${matched.id} opted OUT via STOP keyword "${messageBody.trim()}"`);
  } else {
    await db
      .update(leads)
      .set({ doNotContact: false, tcpaConsent: true, consentDate: now, consentSource: 'sms_double_optin', updatedAt: now })
      .where(and(eq(leads.id, matched.id), eq(leads.organizationId, organizationId)));

    await db.insert(activityLog).values({
      organizationId,
      entityType: 'lead',
      entityId: matched.id,
      action: 'tcpa_opt_in',
      metadata: { messageSid, phone, keyword: messageBody.trim(), inboundText: messageBody, channel: 'sms' },
    });
    try {
      const { recordConsentGranted } = await import('./consentEvents');
      await recordConsentGranted({
        organizationId,
        leadId: matched.id,
        channels: ['sms', 'email', 'phone', 'direct_mail'],
        source: 'sms_double_optin',
        consentText: `Inbound consent keyword: "${messageBody.trim()}" (SID ${messageSid})`,
        checkboxChecked: null,
        recordedBy: 'tcpa_opt_keyword',
        metadata: { fromPhone: phone, inboundText: messageBody },
      });
    } catch { /* best-effort */ }
    logger.info(`[TCPA] Lead ${matched.id} opted IN via "${messageBody.trim()}"`);
  }

  return { action, leadId: matched.id };
}

export function checkTcpaConsentFromLead(lead: Pick<Lead, 'tcpaConsent' | 'doNotContact'>): TcpaCheckResult {
  if (lead.doNotContact) {
    return {
      canEmail: false,
      canSms: false,
      canCall: false,
      canDirectMail: false,
      blocked: true,
      reason: "Lead has opted out of all communications (doNotContact is true)",
    };
  }

  if (!lead.tcpaConsent) {
    return {
      canEmail: false,
      canSms: false,
      canCall: false,
      canDirectMail: true,
      blocked: false,
      reason: "TCPA/CAN-SPAM consent not provided - email, SMS and phone calls blocked. Direct mail allowed.",
    };
  }

  return {
    canEmail: true,
    canSms: true,
    canCall: true,
    canDirectMail: true,
    blocked: false,
  };
}

export async function checkTcpaConsent(leadId: number, organizationId: number): Promise<TcpaCheckResult> {
  const lead = await storage.getLead(organizationId, leadId);

  if (!lead) {
    return {
      canEmail: false,
      canSms: false,
      canCall: false,
      canDirectMail: false,
      blocked: true,
      reason: "Lead not found",
    };
  }

  return checkTcpaConsentFromLead(lead);
}

/**
 * Full TCPA gate for SMS: checks consent + quiet hours.
 * Returns { allowed, reason } — gate at the send site.
 */
export async function tcpaGateForSms(
  leadId: number,
  organizationId: number,
  phoneNumber: string
): Promise<{ allowed: boolean; reason?: string }> {
  const consent = await checkTcpaConsent(leadId, organizationId);
  if (!consent.canSms) {
    return { allowed: false, reason: consent.reason };
  }
  // Prefer the lead's explicit IANA zone over area-code inference.
  const lead = await storage.getLead(organizationId, leadId).catch(() => null);
  const recipientZone = (lead as any)?.timezone as string | null | undefined;
  const quietHours = isWithinQuietHours(phoneNumber, recipientZone ?? null);
  if (quietHours.blocked) {
    return { allowed: false, reason: quietHours.reason };
  }
  return { allowed: true };
}

export function canSendViaChannel(
  lead: Pick<Lead, 'tcpaConsent' | 'doNotContact'>,
  channel: 'email' | 'sms' | 'direct_mail' | 'phone'
): { allowed: boolean; reason?: string } {
  const consent = checkTcpaConsentFromLead(lead);

  switch (channel) {
    case 'email':
      return consent.canEmail
        ? { allowed: true }
        : { allowed: false, reason: consent.reason };
    case 'sms':
      return consent.canSms
        ? { allowed: true }
        : { allowed: false, reason: consent.reason || "TCPA consent required for SMS" };
    case 'phone':
      return consent.canCall
        ? { allowed: true }
        : { allowed: false, reason: consent.reason || "TCPA consent required for phone calls" };
    case 'direct_mail':
      return consent.canDirectMail
        ? { allowed: true }
        : { allowed: false, reason: consent.reason };
    default:
      return { allowed: false, reason: "Unknown channel" };
  }
}

export function requiresTcpaConsent(channel: 'email' | 'sms' | 'direct_mail' | 'phone'): boolean {
  return channel === 'sms' || channel === 'phone';
}
