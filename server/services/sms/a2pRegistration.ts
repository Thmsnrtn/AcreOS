/**
 * The org's A2P 10DLC registration — read, refreshed from the org's OWN
 * provider, or self-reported — and the gate sendOrgSMS applies (W5b).
 *
 * WHERE THE STATUS COMES FROM
 *   - The org has its own Twilio connected → the status is READ from Twilio
 *     (`provider_api`). A self-report is refused: the provider is the
 *     authority and we can ask it.
 *   - Anything else (another provider, or a toll-free number, whose status we
 *     do not read) → the customer reports it (`self_reported`) and every
 *     surface labels it so.
 *
 * THE GATE (a2pGateForSms): no confirmed registration → refuse. Refusals are
 * prefixed `A2P gate: ` so callers treat them as a deferral, like the TCPA
 * gate — a registration in review is not a permanent failure.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { smsA2pRegistrations, type SmsA2pRegistration } from "@shared/schema";
import {
  a2pSendVerdict,
  normaliseTwilioBrandStatus,
  normaliseTwilioCampaignStatus,
  numberKindOf,
  type A2pNumberKind,
  type A2pStatus,
  type A2pVerdict,
} from "@shared/sms/a2p10dlc";
import { clock } from "../../utils/clock";
import { logger } from "../../utils/logger";

export async function getA2pRegistration(organizationId: number): Promise<SmsA2pRegistration | null> {
  const [row] = await db
    .select()
    .from(smsA2pRegistrations)
    .where(eq(smsA2pRegistrations.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

interface UpsertInput {
  provider: string;
  numberKind: A2pNumberKind;
  phoneNumber: string | null;
  brandStatus: A2pStatus;
  campaignStatus: A2pStatus;
  statusSource: "provider_api" | "self_reported";
  brandSid?: string | null;
  campaignSid?: string | null;
  messagingServiceSid?: string | null;
  providerDetail?: Record<string, unknown> | null;
  reportedBy?: string | null;
}

async function upsertRegistration(organizationId: number, input: UpsertInput): Promise<SmsA2pRegistration> {
  const now = clock.now();
  const values = {
    organizationId,
    provider: input.provider,
    numberKind: input.numberKind,
    phoneNumber: input.phoneNumber,
    brandStatus: input.brandStatus,
    campaignStatus: input.campaignStatus,
    statusSource: input.statusSource,
    brandSid: input.brandSid ?? null,
    campaignSid: input.campaignSid ?? null,
    messagingServiceSid: input.messagingServiceSid ?? null,
    providerDetail: input.providerDetail ?? null,
    checkedAt: now,
    reportedBy: input.reportedBy ?? null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(smsA2pRegistrations)
    .values(values)
    .onConflictDoUpdate({ target: smsA2pRegistrations.organizationId, set: values })
    .returning();
  return row;
}

export type RefreshOutcome =
  | { ok: true; registration: SmsA2pRegistration }
  | { ok: false; reason: "no_connected_provider" | "provider_not_readable" | "provider_error"; message: string };

/** Read the registration from the org's own Twilio account and store it as `provider_api`. */
export async function refreshA2pFromProvider(organizationId: number): Promise<RefreshOutcome> {
  const { fetchOrgTwilioA2pStatus } = await import("../comms/providers/twilio");
  let snap;
  try {
    snap = await fetchOrgTwilioA2pStatus(organizationId);
  } catch (err) {
    logger.warn("[a2p] reading the registration from the org's Twilio failed", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
    return { ok: false, reason: "provider_error", message: "Your provider didn't answer the registration lookup. Nothing was changed — try again shortly." };
  }
  if (!snap) {
    return {
      ok: false,
      reason: "no_connected_provider",
      message: "No SMS provider of your own is connected, so there is nothing to read. Connect your Twilio account, or report your registration status yourself.",
    };
  }
  if (!snap.readable) {
    return { ok: false, reason: "provider_not_readable", message: `${snap.note}. Report the verification status yourself.` };
  }
  const registration = await upsertRegistration(organizationId, {
    provider: "twilio",
    numberKind: numberKindOf(snap.phoneNumber) ?? "10dlc",
    phoneNumber: snap.phoneNumber,
    brandStatus: normaliseTwilioBrandStatus(snap.rawBrandStatus),
    campaignStatus: normaliseTwilioCampaignStatus(snap.rawCampaignStatus),
    statusSource: "provider_api",
    brandSid: snap.brandSid,
    campaignSid: snap.campaignSid,
    messagingServiceSid: snap.messagingServiceSid,
    providerDetail: {
      rawBrandStatus: snap.rawBrandStatus,
      rawCampaignStatus: snap.rawCampaignStatus,
      note: snap.note,
      errors: snap.errors,
    },
  });
  return { ok: true, registration };
}

export interface SelfReportInput {
  provider: string;
  phoneNumber: string;
  brandStatus: A2pStatus;
  campaignStatus: A2pStatus;
  brandId?: string | null;
  campaignId?: string | null;
}

export type SelfReportOutcome =
  | { ok: true; registration: SmsA2pRegistration }
  | { ok: false; reason: "provider_is_readable" | "bad_number"; message: string };

/**
 * Store what the customer says. Refused when the org's own Twilio is
 * connected for a 10DLC number — its API is the authority and is read instead.
 */
export async function selfReportA2p(organizationId: number, userId: string | null, input: SelfReportInput): Promise<SelfReportOutcome> {
  const kind = numberKindOf(input.phoneNumber);
  if (!kind) return { ok: false, reason: "bad_number", message: "Enter the US number you text from, e.g. +1 512 555 0100." };
  const { orgByoTwilioNumber } = await import("../comms/providers/twilio");
  const twilioNumber = await orgByoTwilioNumber(organizationId);
  if (twilioNumber && numberKindOf(twilioNumber) === "10dlc") {
    return {
      ok: false,
      reason: "provider_is_readable",
      message: "Your own Twilio account is connected, so AcreOS reads the registration from Twilio instead of taking it on report. Use “Check with my provider”.",
    };
  }
  const registration = await upsertRegistration(organizationId, {
    provider: input.provider.trim().slice(0, 60) || "other",
    numberKind: kind,
    phoneNumber: input.phoneNumber.trim(),
    // Toll-free numbers have no 10DLC brand; the verification is the campaign status.
    brandStatus: kind === "toll_free" ? "not_started" : input.brandStatus,
    campaignStatus: input.campaignStatus,
    statusSource: "self_reported",
    brandSid: input.brandId ?? null,
    campaignSid: input.campaignId ?? null,
    reportedBy: userId,
  });
  return { ok: true, registration };
}

/**
 * The send-time gate. Reads this org's registration and the number the text
 * would go from (the org's own Twilio number when connected).
 */
export async function a2pGateForSms(organizationId: number): Promise<A2pVerdict> {
  const [registration, sendingNumber] = await Promise.all([
    db
      .select()
      .from(smsA2pRegistrations)
      .where(and(eq(smsA2pRegistrations.organizationId, organizationId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    import("../comms/providers/twilio").then((m) => m.orgByoTwilioNumber(organizationId)),
  ]);
  // The org's own Twilio is connected for a 10DLC number, so its API is the
  // authority (selfReportA2p refuses a self-report in that case). A
  // self-reported row on file from BEFORE Twilio was connected is not
  // confirmation — read the provider (W5b audit).
  if (registration && sendingNumber && numberKindOf(sendingNumber) === "10dlc" && registration.statusSource !== "provider_api") {
    return {
      allowed: false,
      reason: "your own Twilio account is connected, so the registration must be read from Twilio, not taken on report — use “Check with my provider” in Settings → Integrations → Text-message registration",
    };
  }
  return a2pSendVerdict(registration, sendingNumber);
}
