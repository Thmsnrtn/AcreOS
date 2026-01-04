import { storage } from "../storage";
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
