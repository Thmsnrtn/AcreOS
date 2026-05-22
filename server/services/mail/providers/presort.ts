/**
 * Pillar 2 — Presort aggregation adapter. DISABLED STUB.
 *
 * Presort bureaus take a deposit of pieces, sort them to USPS
 * automation tier (5-digit / 3-digit / mixed AADC), apply a discount
 * stamp, and inject. The savings are ~30-40¢ per letter and 5-7¢ per
 * postcard versus retail Lob — but they require a minimum drop of
 * ~500 personalized pieces and 3-business-day handling.
 *
 * TODO (revenue trigger: $1k MRR / 2026-Q3): wire up to a bureau
 * (likely Action Mail or Direct Mail Express). Until then quote()
 * returns meetsConstraints=false so the router never picks presort.
 */

import type { MailProvider, MailShipment, ProviderQuote, ProviderSendResult } from "../router";

export const presortAdapter: MailProvider = {
  name: "presort",

  isConfigured(): boolean {
    return false;
  },

  async quote(_shipment: MailShipment): Promise<ProviderQuote> {
    return {
      provider: "presort",
      costPerPieceCents: 0,
      deliveryEtaDays: 0,
      minVolume: 500,
      meetsConstraints: false,
      reasonIfNot: "Not yet activated (revenue trigger pending — $1k MRR for presort).",
    };
  },

  async send(_shipment: MailShipment): Promise<ProviderSendResult> {
    throw new Error("Presort adapter is not activated. Revenue trigger: $1k MRR.");
  },
};
