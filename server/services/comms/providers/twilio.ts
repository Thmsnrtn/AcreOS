/**
 * Twilio CommsProvider adapter.
 *
 * Wraps the same Twilio REST endpoints the legacy `smsService.ts` was
 * calling directly. Keeps the simulation-mode short-circuit (so SIM_MODE
 * still skips real sends) and the BYOK-Twilio org-credential lookup so
 * existing callers see identical behaviour through the router.
 *
 * Cost estimate: 1¢ per SMS as a baseline — refined later by the
 * `comms_provider_quotes` table once we have invoice data to compare
 * against.
 */
import type { Request } from "express";
import crypto from "crypto";
import { db } from "../../../db";
import { organizationIntegrations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../../../utils/logger";
import {
  registerProvider,
  type CommsProvider,
  type SendSmsOpts,
  type SendSmsResult,
  type InitiateCallOpts,
  type InitiateCallResult,
  type RentNumberOpts,
  type RentNumberResult,
  type CostEstimateOpts,
} from "../router";

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

async function getOrgTwilioCredentials(organizationId: number): Promise<TwilioCredentials | null> {
  // Universal BYOK (2026-05-22): prefer the canonical byok_credentials row.
  // The plaintext format is "<accountSid>:<authToken>:<phoneNumber>" so the
  // single-secret vault can carry a multi-secret tuple. If absent, fall
  // back to the legacy organization_integrations row for back-compat.
  try {
    const { getByokCredential } = await import("../../byok/key-vault");
    const blob = await getByokCredential({ organizationId, channel: "twilio" });
    if (blob) {
      const parts = blob.split(":");
      if (parts.length === 3 && parts.every(Boolean)) {
        return { accountSid: parts[0], authToken: parts[1], phoneNumber: parts[2] };
      }
    }
  } catch {
    /* fall through to legacy lookup */
  }

  const [row] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, "twilio"),
        eq(organizationIntegrations.isEnabled, true),
      ),
    )
    .limit(1);
  if (!row || !row.credentials) return null;
  const creds = row.credentials as any;
  if (!creds.accountSid || !creds.authToken || !creds.fromPhoneNumber) return null;
  return {
    accountSid: creds.accountSid,
    authToken: creds.authToken,
    phoneNumber: creds.fromPhoneNumber,
  };
}

function platformCredentials(): TwilioCredentials | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !phone) return null;
  return { accountSid: sid, authToken: token, phoneNumber: phone };
}

/**
 * True iff the org has its OWN connected (BYO) Twilio identity — used by
 * counterparty send paths (e.g. campaign SMS) that must NOT fall back to the
 * platform account per the "be the rail, not the provider" founder ruling.
 */
export async function orgHasByoTwilio(organizationId: number): Promise<boolean> {
  return (await getOrgTwilioCredentials(organizationId).catch(() => null)) != null;
}

/**
 * Resolve effective Twilio creds: BYOK wins, falls back to platform env.
 */
async function resolveCredentials(organizationId?: number): Promise<TwilioCredentials | null> {
  if (organizationId != null) {
    const byok = await getOrgTwilioCredentials(organizationId).catch(() => null);
    if (byok) return byok;
  }
  return platformCredentials();
}

class TwilioProvider implements CommsProvider {
  readonly name = "twilio" as const;

  isConfigured(): boolean {
    return platformCredentials() != null;
  }

  async sendSms(opts: SendSmsOpts): Promise<SendSmsResult> {
    // Preserve the original simulation-mode short-circuit: a fake SID
    // gets returned, no Twilio API call happens.
    const { shouldSimulate, recordSimulatedAction } = await import(
      "../../../utils/simulationMode"
    );
    let org: any = null;
    if (opts.organizationId != null) {
      try {
        const { storage } = await import("../../../storage");
        org = await storage.getOrganization(opts.organizationId);
      } catch {}
    }
    if (shouldSimulate("sms", org)) {
      const rec = await recordSimulatedAction(
        "sms",
        "twilio.messages.create",
        {
          to: opts.to,
          from: opts.from,
          body: opts.body.slice(0, 500),
          mediaUrls: opts.mediaUrls,
        },
        org,
      );
      return { sid: rec.id, costCents: 0 };
    }

    const creds = await resolveCredentials(opts.organizationId);
    if (!creds) {
      // FAIL VISIBLY (product-truth audit): with no credentials and NOT in
      // simulation mode, an SMS genuinely cannot be sent. Previously this
      // returned a fake `mock-<ts>` SID + success, so an unconfigured prod
      // silently "succeeded" (callers saw success:true; the ledger only
      // skipped a mock- prefix). Throw — exactly like initiateCall below — so
      // the caller's catch surfaces a real failure. A deliberate dry-run still
      // goes through the simulation-mode path above (a recorded, honest sim).
      throw new Error(
        "twilio.sendSms: credentials unavailable (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER, or enable simulation mode)",
      );
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const body = new URLSearchParams({
      To: opts.to,
      From: opts.from || creds.phoneNumber,
      Body: opts.body,
    });
    if (opts.mediaUrls?.length) {
      for (const mu of opts.mediaUrls) body.append("MediaUrl", mu);
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const errText = await response.text();
      const err: any = new Error(`twilio.sendSms failed: ${response.status} ${errText}`);
      err.status = response.status;
      throw err;
    }
    const data: any = await response.json();
    return {
      sid: data.sid,
      costCents: this.estimateCostCents({ kind: "sms" }),
    };
  }

  async initiateCall(opts: InitiateCallOpts): Promise<InitiateCallResult> {
    const creds = await resolveCredentials(opts.organizationId);
    if (!creds) throw new Error("twilio.initiateCall: credentials unavailable");
    const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json`;
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const body = new URLSearchParams({
      To: opts.to,
      From: opts.from || creds.phoneNumber,
    });
    if (opts.twimlUrl) body.append("Url", opts.twimlUrl);
    if (opts.statusCallbackUrl) body.append("StatusCallback", opts.statusCallbackUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const errText = await response.text();
      const err: any = new Error(`twilio.initiateCall failed: ${response.status} ${errText}`);
      err.status = response.status;
      throw err;
    }
    const data: any = await response.json();
    return { sid: data.sid, statusCallbackUrl: opts.statusCallbackUrl };
  }

  async rentNumber(opts: RentNumberOpts): Promise<RentNumberResult> {
    const creds = await resolveCredentials(opts.organizationId);
    if (!creds) throw new Error("twilio.rentNumber: credentials unavailable");
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

    // Step 1: search for an available local number.
    const searchUrl = new URL(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/US/Local.json`,
    );
    if (opts.areaCode) searchUrl.searchParams.set("AreaCode", opts.areaCode);
    searchUrl.searchParams.set("SmsEnabled", "true");
    searchUrl.searchParams.set("VoiceEnabled", "true");
    searchUrl.searchParams.set("PageSize", "1");
    const searchResp = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!searchResp.ok) {
      const err: any = new Error(`twilio.rentNumber search failed: ${searchResp.status}`);
      err.status = searchResp.status;
      throw err;
    }
    const searchData: any = await searchResp.json();
    const candidate = searchData?.available_phone_numbers?.[0]?.phone_number;
    if (!candidate) throw new Error("twilio.rentNumber: no available numbers");

    // Step 2: provision it.
    const provisionUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`;
    const body = new URLSearchParams({ PhoneNumber: candidate });
    const provResp = await fetch(provisionUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!provResp.ok) {
      const err: any = new Error(`twilio.rentNumber provision failed: ${provResp.status}`);
      err.status = provResp.status;
      throw err;
    }
    const provData: any = await provResp.json();
    return {
      number: provData.phone_number,
      costCentsPerMonth: 115, // Twilio local-number cost — $1.15/mo at list price.
    };
  }

  async releaseNumber(number: string): Promise<void> {
    const creds = platformCredentials();
    if (!creds) throw new Error("twilio.releaseNumber: credentials unavailable");
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    // Look up the SID for this number.
    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`;
    const listResp = await fetch(listUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!listResp.ok) {
      const err: any = new Error(`twilio.releaseNumber lookup failed: ${listResp.status}`);
      err.status = listResp.status;
      throw err;
    }
    const listData: any = await listResp.json();
    const sid = listData?.incoming_phone_numbers?.[0]?.sid;
    if (!sid) {
      logger.warn(`[twilio.releaseNumber] no SID for ${number}; treating as already released`);
      return;
    }
    const delUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${sid}.json`;
    const delResp = await fetch(delUrl, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!delResp.ok && delResp.status !== 404) {
      const err: any = new Error(`twilio.releaseNumber failed: ${delResp.status}`);
      err.status = delResp.status;
      throw err;
    }
  }

  /**
   * Twilio webhook signature check — HMAC-SHA1(URL + sorted-body-params)
   * keyed by the account auth token. Mirrors the existing middleware in
   * `server/middleware/twilioSignature.ts` so the router and the
   * legacy middleware agree on validity.
   */
  webhookSignatureValid(req: Request): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) return false;
    const sig = req.headers["x-twilio-signature"] as string | undefined;
    if (!sig) return false;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const url = `${protocol}://${host}${req.originalUrl}`;
    const body = (req.body as Record<string, any>) || {};
    const sortedKeys = Object.keys(body).sort();
    const paramString = sortedKeys.reduce((s, k) => s + k + body[k], "");
    const expected = crypto
      .createHmac("sha1", authToken)
      .update(Buffer.from(url + paramString, "utf-8"))
      .digest("base64");
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, "base64"), Buffer.from(sig, "base64"));
    } catch {
      return false;
    }
  }

  estimateCostCents(opts: CostEstimateOpts): number {
    switch (opts.kind) {
      case "sms":
        // Twilio US SMS list price ≈ $0.0079; round to 1¢ for budgeting.
        return 1;
      case "voice":
        // $0.014/min outbound US local — cents-per-minute × minutes.
        return Math.max(1, Math.ceil(1.4 * (opts.durationMinutes ?? 1)));
      case "number":
        // Monthly rental.
        return 115;
    }
  }
}

export const twilioProvider = new TwilioProvider();
registerProvider(twilioProvider);
