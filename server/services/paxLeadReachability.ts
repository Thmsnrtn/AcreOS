/**
 * Which channels can reach a lead right now — the pure half of Pax's lead
 * reads. No database import (the lead row is passed in), so it is exercised
 * directly and is never swallowed by a mock of the account reads.
 */
import type { Lead } from "@shared/schema";
import { canSendViaChannel, hasCompleteMailingAddress } from "./tcpaCompliance";
import { assessHeirsProperty, type HeirsAssessment } from "@shared/regulatory/heirsProperty";

// ── Lead reachability ────────────────────────────────────────────────────────

export type LeadChannelVerdict = { usable: boolean; why: string };
export interface LeadReachability {
  canText: LeadChannelVerdict;
  canCall: LeadChannelVerdict;
  canEmail: LeadChannelVerdict;
  canMail: LeadChannelVerdict;
  /** Channels usable now, in plain words; empty when none. */
  usableNow: string[];
  /** Heirs' property / partial-interest markers on the record (a warning, never a block). */
  heirsProperty: HeirsAssessment;
  summary: string;
}

type ReachabilityLead = Pick<
  Lead,
  "tcpaConsent" | "doNotContact" | "optOutDate" | "phone" | "email" | "address" | "city" | "state" | "zip"
> & Partial<Pick<Lead, "firstName" | "lastName" | "notes">>;

function verdict(
  gate: { allowed: boolean; reason?: string },
  hasContactPoint: boolean,
  missing: string,
): LeadChannelVerdict {
  // Consent is decided by tcpaCompliance.canSendViaChannel — the predicate the
  // send paths call. Whether there is anything to send TO is a second,
  // independent condition, and both must hold.
  if (!gate.allowed) return { usable: false, why: gate.reason || "blocked" };
  if (!hasContactPoint) return { usable: false, why: missing };
  return { usable: true, why: "ok" };
}

/**
 * Which channels can actually reach this lead right now: consent and
 * do-not-contact from `canSendViaChannel` (the send paths' own predicate),
 * plus a phone, an email, or a complete mailing address to send to
 * (`hasCompleteMailingAddress`, also the direct-mail send path's check).
 * Texts also respect quiet hours at send time, which this read does not
 * decide. A lead with only a phone and no consent is reachable by NO channel.
 */
export function leadReachabilityForPax(lead: ReachabilityLead): LeadReachability {
  const canText = verdict(canSendViaChannel(lead, "sms"), Boolean(lead.phone), "no phone number on file");
  const canCall = verdict(canSendViaChannel(lead, "phone"), Boolean(lead.phone), "no phone number on file");
  const canEmail = verdict(canSendViaChannel(lead, "email"), Boolean(lead.email), "no email address on file");
  const canMail = verdict(
    canSendViaChannel(lead, "direct_mail"),
    hasCompleteMailingAddress(lead),
    "no complete mailing address on file",
  );
  const usableNow = [
    canText.usable ? "text" : null,
    canCall.usable ? "call" : null,
    canEmail.usable ? "email" : null,
    canMail.usable ? "mail" : null,
  ].filter((c): c is string => c !== null);
  const heirsProperty = assessHeirsProperty({ names: [lead.firstName, lead.lastName, `${lead.firstName ?? ""} ${lead.lastName ?? ""}`], text: [lead.notes] });
  const base =
    usableNow.length > 0
      ? `Reachable now by: ${usableNow.join(", ")}.`
      : "Not reachable by any channel right now — see why on each channel.";
  return {
    canText,
    canCall,
    canEmail,
    canMail,
    usableNow,
    heirsProperty,
    summary: heirsProperty.warning ? `${base} Before any outreach: ${heirsProperty.warning}` : base,
  };
}

/** Counts per channel over a lead list, for "how many can I text/mail?" questions. */
export function summarizeReachabilityForPax(rows: LeadReachability[]) {
  const n = (pick: (r: LeadReachability) => boolean) => rows.filter(pick).length;
  return {
    leads: rows.length,
    canText: n((r) => r.canText.usable),
    canCall: n((r) => r.canCall.usable),
    canEmail: n((r) => r.canEmail.usable),
    canMail: n((r) => r.canMail.usable),
    reachableByNoChannel: n((r) => r.usableNow.length === 0),
  };
}
