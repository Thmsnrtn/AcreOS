/**
 * Pillar 2 — Lob adapter.
 *
 * Wraps the existing `server/services/directMailService.ts` so the
 * Pillar 1.6 ledger hook (postOpexSpent) inside that file remains the
 * sole writer to opex_available for Lob spend. We do NOT post here —
 * directMailService already does, and double-posting would corrupt
 * contribution margin.
 *
 * Per-piece cost constants (cents) live in this adapter for quoting.
 * The actual debit uses the (slightly different) numbers inside
 * directMailService's `lobPieceCostCents` — those drive the ledger
 * row, these drive the router's decision. Keeping them separate lets
 * a founder retune routing without retraining the books.
 */

import type {
  MailProvider,
  MailShipment,
  PieceType,
  ProviderQuote,
  ProviderSendResult,
} from "../router";
import { averageCostCentsPerPiece } from "../router";
import { logger } from "../../../utils/logger";

// Approximate Lob 2026 retail per-piece cost in cents (HTML templates).
// Numbers used purely for routing decisions; the ledger reads its own
// env-overridable table inside directMailService.
const LOB_COSTS: Record<PieceType, number> = {
  postcard_4x6: 75,
  postcard_6x9: 95,
  letter_10: 120,
  handwritten: 350, // Lob handwriting integration premium
};

function lobApiKey(): string | null {
  const isProd = process.env.NODE_ENV === "production";
  return (isProd ? process.env.LOB_LIVE_API_KEY : process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY) ?? null;
}

export const lobAdapter: MailProvider = {
  name: "lob",

  isConfigured(): boolean {
    return Boolean(lobApiKey());
  },

  async quote(shipment: MailShipment): Promise<ProviderQuote> {
    const costPerPieceCents = averageCostCentsPerPiece(shipment.pieces, LOB_COSTS);
    // Lob handles every speed except the geo-aggregation EDDM lane.
    const meetsConstraints = shipment.speed !== "eddm_geo";
    return {
      provider: "lob",
      costPerPieceCents,
      deliveryEtaDays: shipment.speed === "next_day" ? 1 : 5,
      minVolume: 1,
      meetsConstraints,
      reasonIfNot: meetsConstraints ? undefined : "Lob does not route EDDM geo carrier walks",
    };
  },

  async send(shipment: MailShipment): Promise<ProviderSendResult> {
    if (!this.isConfigured()) {
      throw new Error("Lob is not configured (LOB_LIVE_API_KEY / LOB_TEST_API_KEY unset).");
    }

    // Defer to the legacy directMailService so the existing Pillar 1.6
    // ledger hook continues to write opex_available exactly once.
    const directMail = await import("../../directMailService");
    const { storage } = await import("../../../storage");

    // We need a sender identity. The router doesn't pass one (per the
    // simplified MailShipment interface), so we default to the org's
    // primary verified identity. If none exists, callers that need
    // mid-flight identity selection should call directMailService
    // directly until we add senderIdentityId to MailShipment.
    const identities = await storage.getMailSenderIdentities(shipment.organizationId);
    const senderIdentity = Array.isArray(identities)
      ? identities.find((i) => i.isDefault && i.isActive) ?? identities[0]
      : null;
    if (!senderIdentity) {
      throw new Error(
        `Lob send requires a verified mail_sender_identity for org ${shipment.organizationId}; none found.`,
      );
    }

    const pieces: { providerPieceId: string; recipientRef: string }[] = [];
    let totalCostCents = 0;

    for (const piece of shipment.pieces) {
      const recipientName = `${piece.recipient.firstName ?? ""} ${piece.recipient.lastName ?? ""}`.trim() || "Resident";
      const recipientAddress = {
        line1: piece.recipient.address1,
        line2: piece.recipient.address2,
        city: piece.recipient.city,
        state: piece.recipient.state,
        zip: piece.recipient.zip,
      };

      if (piece.pieceType === "letter_10" || piece.pieceType === "handwritten") {
        const html = piece.vars?.htmlContent ?? piece.templateId ?? "";
        const result = await directMail.sendLetter({
          organizationId: shipment.organizationId,
          senderIdentity,
          recipientName,
          recipientAddress,
          htmlContent: html,
          color: piece.vars?.color === "true",
          doubleSided: piece.vars?.doubleSided === "true",
        });
        pieces.push({ providerPieceId: result.lobId, recipientRef: `${shipment.customerId}` });
        totalCostCents += LOB_COSTS[piece.pieceType];
      } else {
        const size = piece.pieceType === "postcard_6x9" ? "6x9" : "4x6";
        const result = await directMail.sendPostcard({
          organizationId: shipment.organizationId,
          senderIdentity,
          recipientName,
          recipientAddress,
          frontHtml: piece.vars?.frontHtml ?? piece.templateId ?? "",
          backHtml: piece.vars?.backHtml ?? "",
          size: size as "4x6" | "6x9",
        });
        pieces.push({ providerPieceId: result.lobId, recipientRef: `${shipment.customerId}` });
        totalCostCents += LOB_COSTS[piece.pieceType];
      }
    }

    logger.info(`[lobAdapter] sent ${pieces.length} pieces for org ${shipment.organizationId}`);

    return {
      provider: "lob",
      providerEventId: pieces[0]?.providerPieceId ?? `lob_shipment_${Date.now()}`,
      pieces,
      totalCostCents,
    };
  },
};
