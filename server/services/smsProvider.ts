/**
 * SMS provider metadata.
 *
 * This module used to carry its own `sendSms` / `sendBulkSms`: a Twilio sender
 * with no consent gate that fell back to AcreOS's PLATFORM credentials when an
 * org had none. It had zero callers, which made it a ready-made bypass of the
 * counterparty choke point — `sendOrgSMS` in smsService.ts, which asks the
 * consent question each send's purpose needs and requires the org's own
 * identity (DEFECT-0104; "be the rail, not the provider"). Removed 2026-09-27.
 * Counterparty SMS goes through `sendOrgSMS`; system SMS through
 * `smsService.sendSMS`. Only the provider listing below has a caller.
 */

export enum SmsProvider {
  TWILIO = "twilio",
}

const TWILIO_COST_PER_SMS = 0.0079;

export function getProviderInfo(): {
  available: SmsProvider[];
  default: SmsProvider | null;
  costs: Record<SmsProvider, number>;
} {
  const available: SmsProvider[] = [];
  let defaultProvider: SmsProvider | null = null;

  if (process.env.TWILIO_ACCOUNT_SID) {
    available.push(SmsProvider.TWILIO);
    defaultProvider = SmsProvider.TWILIO;
  }

  return {
    available,
    default: defaultProvider,
    costs: {
      [SmsProvider.TWILIO]: TWILIO_COST_PER_SMS,
    },
  };
}
