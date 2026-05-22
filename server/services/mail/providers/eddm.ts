/**
 * Pillar 2 — EDDM (Every Door Direct Mail) adapter. DISABLED STUB.
 *
 * EDDM lets us blanket a carrier route by ZIP+carrier for ~17¢/piece —
 * by far the cheapest channel — but it can't personalize, can't target
 * individual recipients, and requires USPS forms BMEU + a USPS account.
 *
 * TODO (revenue trigger: $5k MRR / 2026-Q4): activate when the
 * aggregation queue is built. Until then this stub keeps the router
 * shape stable so quote() returns a coherent meetsConstraints=false.
 */

import type { MailProvider, MailShipment, ProviderQuote, ProviderSendResult } from "../router";

export const eddmAdapter: MailProvider = {
  name: "eddm",

  isConfigured(): boolean {
    return false;
  },

  async quote(_shipment: MailShipment): Promise<ProviderQuote> {
    return {
      provider: "eddm",
      costPerPieceCents: 0,
      deliveryEtaDays: 0,
      minVolume: 200,
      meetsConstraints: false,
      reasonIfNot: "Not yet activated (revenue trigger pending — $5k MRR aggregation queue).",
    };
  },

  async send(_shipment: MailShipment): Promise<ProviderSendResult> {
    throw new Error("EDDM adapter is not activated. Revenue trigger: $5k MRR aggregation queue.");
  },
};
