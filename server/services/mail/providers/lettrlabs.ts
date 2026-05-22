/**
 * Pillar 2 — LettrLabs handwritten adapter. DISABLED STUB.
 *
 * LettrLabs prints true robot-handwritten letters (ballpoint, real pen
 * on cardstock) at ~$2.40/piece. The response rate lift on cold land
 * outreach is 3-5× vs. machine-printed letters but the unit economics
 * only work for high-intent late-funnel motions.
 *
 * TODO (revenue trigger: premium SKU — likely AcreOS Pro tier launch
 * 2026-Q4): gate behind the premium plan flag once it exists. Until
 * then quote() returns meetsConstraints=false.
 */

import type { MailProvider, MailShipment, ProviderQuote, ProviderSendResult } from "../router";

export const lettrlabsAdapter: MailProvider = {
  name: "lettrlabs",

  isConfigured(): boolean {
    return false;
  },

  async quote(_shipment: MailShipment): Promise<ProviderQuote> {
    return {
      provider: "lettrlabs",
      costPerPieceCents: 240,
      deliveryEtaDays: 10,
      minVolume: 25,
      meetsConstraints: false,
      reasonIfNot: "Not yet activated (revenue trigger pending — premium SKU launch).",
    };
  },

  async send(_shipment: MailShipment): Promise<ProviderSendResult> {
    throw new Error("LettrLabs adapter is not activated. Revenue trigger: premium SKU launch.");
  },
};
