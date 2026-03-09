import { db } from "../db";
import { storage } from "../storage";
import { leads, activityLog } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import type { Lead } from "@shared/schema";

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

// TCPA quiet hours: 8 AM – 9 PM in the recipient's local timezone
// Area code → UTC offset map (approximate, covers US time zones)
const AREA_CODE_OFFSETS: Record<string, number> = {
  // Eastern (UTC-5/-4)
  '201': -5, '202': -5, '203': -5, '207': -5, '212': -5, '215': -5,
  '216': -5, '217': -5, '218': -5, '219': -5, '224': -5, '225': -5,
  '229': -5, '231': -5, '234': -5, '239': -5, '240': -5, '248': -5,
  '251': -5, '252': -5, '253': -8, '256': -5, '267': -5, '269': -5,
  '270': -5, '272': -5, '276': -5, '278': -5, '301': -5, '302': -5,
  '304': -5, '305': -5, '309': -6, '310': -8, '312': -6, '313': -5,
  '315': -5, '317': -5, '318': -6, '319': -6, '320': -6, '321': -5,
  '323': -8, '325': -6, '330': -5, '331': -6, '332': -5, '334': -5,
  '336': -5, '337': -6, '339': -5, '340': -4, '346': -6, '347': -5,
  '351': -5, '352': -5, '361': -6, '364': -5, '380': -5, '385': -7,
  '386': -5, '401': -5, '404': -5, '405': -6, '406': -7, '407': -5,
  '408': -8, '409': -6, '410': -5, '412': -5, '413': -5, '414': -6,
  '415': -8, '417': -6, '419': -5, '423': -5, '424': -8, '425': -8,
  '430': -6, '432': -6, '434': -5, '435': -7, '440': -5, '442': -8,
  '443': -5, '458': -8, '463': -5, '469': -6, '470': -5, '475': -5,
  '478': -5, '479': -6, '480': -7, '484': -5,
  // Central (UTC-6/-5)
  '501': -6, '502': -5, '503': -8, '504': -6, '505': -7, '506': -4,
  '507': -6, '508': -5, '509': -8, '510': -8, '512': -6, '513': -5,
  '515': -6, '516': -5, '517': -5, '518': -5, '520': -7, '530': -8,
  '531': -6, '534': -6, '539': -6, '540': -5, '541': -8, '551': -5,
  '557': -6, '559': -8, '561': -5, '562': -8, '563': -6, '564': -8,
  '567': -5, '570': -5, '571': -5, '573': -6, '574': -5, '575': -7,
  '580': -6, '585': -5, '586': -5,
  // Mountain (UTC-7/-6)
  '601': -6, '602': -7, '603': -5, '605': -6, '606': -5, '607': -5,
  '608': -6, '609': -5, '610': -5, '612': -6, '614': -5, '615': -5,
  '616': -5, '617': -5, '618': -6, '619': -8, '620': -6, '623': -7,
  '626': -8, '628': -8, '629': -6, '630': -6, '631': -5, '636': -6,
  '641': -6, '646': -5, '650': -8, '651': -6, '657': -8, '659': -6,
  '660': -6, '661': -8, '662': -6, '667': -5, '669': -8, '670': 10,
  '671': 10, '678': -5, '679': -5,
  // Pacific (UTC-8/-7)
  '701': -6, '702': -8, '703': -5, '704': -5, '706': -5, '707': -8,
  '708': -6, '712': -6, '713': -6, '714': -8, '715': -6, '716': -5,
  '717': -5, '718': -5, '719': -7, '720': -7, '724': -5, '725': -8,
  '726': -6, '727': -5, '731': -6, '732': -5, '734': -5, '737': -6,
  '740': -5, '747': -8, '754': -5, '757': -5, '760': -8, '762': -5,
  '763': -6, '765': -5, '769': -6, '770': -5, '772': -5, '773': -6,
  '774': -5, '775': -8, '779': -6, '781': -5, '785': -6, '786': -5,
  '787': -4,
  // Default to Eastern if unknown
};

function getAreaCodeOffset(phoneNumber: string): number {
  const digits = phoneNumber.replace(/\D/g, '');
  // Strip country code if present
  const local = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  const areaCode = local.slice(0, 3);
  return AREA_CODE_OFFSETS[areaCode] ?? -5; // Default: Eastern
}

/**
 * Check if current time is within TCPA-compliant calling hours
 * (8 AM – 9 PM local time of recipient)
 */
export function isWithinQuietHours(phoneNumber: string): { blocked: boolean; reason?: string } {
  const offsetHours = getAreaCodeOffset(phoneNumber);
  const nowUTC = new Date();
  const localHour = (nowUTC.getUTCHours() + offsetHours + 24) % 24;
  const localMinutes = nowUTC.getUTCMinutes();
  const localTime = localHour + localMinutes / 60;

  if (localTime < 8 || localTime >= 21) {
    const humanOffset = offsetHours >= 0 ? `UTC+${offsetHours}` : `UTC${offsetHours}`;
    return {
      blocked: true,
      reason: `TCPA quiet hours: cannot contact before 8 AM or after 9 PM recipient local time (${humanOffset}). Current local time: ${localHour}:${String(localMinutes).padStart(2, '0')}.`,
    };
  }
  return { blocked: false };
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

  if (action === 'opt_out') {
    await db
      .update(leads)
      .set({ doNotContact: true, tcpaConsent: false, updatedAt: new Date() })
      .where(and(eq(leads.id, matched.id), eq(leads.organizationId, organizationId)));

    await db.insert(activityLog).values({
      organizationId,
      entityType: 'lead',
      entityId: matched.id,
      action: 'tcpa_opt_out',
      metadata: { messageSid, phone, keyword: messageBody.trim(), channel: 'sms' },
    });
    console.log(`[TCPA] Lead ${matched.id} opted OUT via STOP keyword "${messageBody.trim()}"`);
  } else {
    await db
      .update(leads)
      .set({ doNotContact: false, tcpaConsent: true, updatedAt: new Date() })
      .where(and(eq(leads.id, matched.id), eq(leads.organizationId, organizationId)));

    await db.insert(activityLog).values({
      organizationId,
      entityType: 'lead',
      entityId: matched.id,
      action: 'tcpa_opt_in',
      metadata: { messageSid, phone, keyword: messageBody.trim(), channel: 'sms' },
    });
    console.log(`[TCPA] Lead ${matched.id} opted IN via "${messageBody.trim()}"`);
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
  const quietHours = isWithinQuietHours(phoneNumber);
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
