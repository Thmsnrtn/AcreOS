/**
 * Mail provider INFO surface (K7-2a: send paths retired).
 *
 * This module used to carry its own Lob send implementation (sendLetter /
 * sendPostcard) — a fourth `letters.create` site beside the canonical
 * operation in directMailService.ts. Those send paths were retired onto
 * directMailService (org sends through its lane-resolved sendLetter; the
 * one org-less system send through its narrow sendSystemLetter, reachable
 * only from the Founder Autopilot send_letter hand). What remains here is
 * the NON-send surface its other consumers use: the MailProvider enum, the
 * address/option/result types, the recorded per-piece costs, and
 * getProviderInfo() (routes-billing.ts, routes-organization.ts).
 */

export enum MailProvider {
  LOB = "lob",
}

export interface MailAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface LetterOptions {
  to: MailAddress;
  from: MailAddress;
  /** HTML or a PDF URL. */
  file: string;
  color?: boolean;
  doubleSided?: boolean;
  description?: string;
  organizationId?: number;
}

export interface PostcardOptions {
  to: MailAddress;
  from: MailAddress;
  front: string;
  back: string;
  size?: '4x6' | '6x9' | '6x11';
  description?: string;
  organizationId?: number;
}

export interface MailResult {
  success: boolean;
  mailingId?: string;
  expectedDeliveryDate?: string;
  trackingUrl?: string;
  isTestMode: boolean;
  provider: MailProvider;
  cost?: number;
  error?: string;
  /** Set on a failure: true only when Lob certainly did not accept (or bill) the piece. */
  providerNotBilled?: boolean;
}

const LOB_LETTER_COST = 0.85;
const LOB_POSTCARD_COST = 0.45;

export function getProviderInfo(): {
  available: MailProvider[];
  default: MailProvider | null;
  costs: Record<MailProvider, { letter: number; postcard: number }>;
} {
  const available: MailProvider[] = [];
  let defaultProvider: MailProvider | null = null;

  if (process.env.LOB_LIVE_API_KEY || process.env.LOB_TEST_API_KEY || process.env.LOB_API_KEY) {
    available.push(MailProvider.LOB);
    defaultProvider = MailProvider.LOB;
  }

  return {
    available,
    default: defaultProvider,
    costs: {
      [MailProvider.LOB]: { letter: LOB_LETTER_COST, postcard: LOB_POSTCARD_COST },
    },
  };
}
