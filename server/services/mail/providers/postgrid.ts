/**
 * Pillar 2 — PostGrid adapter (pay-as-you-go).
 *
 * Activates the moment POSTGRID_API_KEY appears. Same per-piece API
 * shape as Lob (https://postgrid.com/docs/print-mail-v1/index.html);
 * we wrap the bare minimum endpoints needed for postcards + letters.
 *
 * Pricing is roughly 25-35% cheaper than Lob retail — that's the whole
 * point of routing. We post to the financial ledger here directly
 * (Lob does it inside directMailService; PostGrid has no legacy hook
 * so it owns its own debit).
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

const POSTGRID_BASE_URL = "https://api.postgrid.com/print-mail/v1";

const POSTGRID_COSTS: Record<PieceType, number> = {
  postcard_4x6: 55,
  postcard_6x9: 70,
  letter_10: 85,
  handwritten: 240, // PostGrid does not offer true handwriting; quoted high so router prefers lettrlabs once it ships
};

function postgridApiKey(): string | null {
  return process.env.POSTGRID_API_KEY ?? null;
}

async function postgridFetch(path: string, body: Record<string, unknown>): Promise<any> {
  const key = postgridApiKey();
  if (!key) throw new Error("PostGrid not configured (POSTGRID_API_KEY unset).");

  const form = new URLSearchParams();
  // PostGrid expects flat form-encoded bodies with dot-notation nesting
  // (e.g. `to[addressLine1]=…`). We accept a pre-flattened body.
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    form.set(k, String(v));
  }

  const res = await fetch(`${POSTGRID_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostGrid ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function postPostgridCostToLedger(
  organizationId: number,
  providerEventId: string,
  amountCents: number,
  pieceType: PieceType,
  feature: string,
): Promise<void> {
  if (amountCents <= 0 || !providerEventId) return;
  try {
    const { postOpexSpent } = await import("../../financial-ledger");
    await postOpexSpent({
      organizationId,
      amountCents,
      category: "mail",
      feature,
      providerName: "postgrid",
      providerEventId,
      externalEventId: `postgrid:${pieceType}:${providerEventId}`,
    });
  } catch (err) {
    logger.warn("[postgridAdapter] ledger postOpexSpent failed (non-fatal)", err instanceof Error ? err : undefined);
  }
}

export const postgridAdapter: MailProvider = {
  name: "postgrid",

  isConfigured(): boolean {
    return Boolean(postgridApiKey());
  },

  async quote(shipment: MailShipment): Promise<ProviderQuote> {
    if (!this.isConfigured()) {
      return {
        provider: "postgrid",
        costPerPieceCents: 0,
        deliveryEtaDays: 0,
        minVolume: 0,
        meetsConstraints: false,
        reasonIfNot: "POSTGRID_API_KEY not set",
      };
    }
    const costPerPieceCents = averageCostCentsPerPiece(shipment.pieces, POSTGRID_COSTS);
    const meetsConstraints = shipment.speed !== "eddm_geo" && shipment.speed !== "next_day";
    return {
      provider: "postgrid",
      costPerPieceCents,
      deliveryEtaDays: 6,
      minVolume: 1,
      meetsConstraints,
      reasonIfNot: meetsConstraints
        ? undefined
        : shipment.speed === "next_day"
          ? "PostGrid does not guarantee next-day production"
          : "PostGrid does not route EDDM geo carrier walks",
    };
  },

  async send(shipment: MailShipment): Promise<ProviderSendResult> {
    if (!this.isConfigured()) {
      throw new Error("PostGrid not configured (POSTGRID_API_KEY unset).");
    }

    const { storage } = await import("../../../storage");
    const identities = (storage as any).getMailSenderIdentitiesByOrganizationId
      ? await (storage as any).getMailSenderIdentitiesByOrganizationId(shipment.organizationId)
      : [];
    const senderIdentity = Array.isArray(identities)
      ? identities.find((i: any) => i.isDefault && i.isActive) ?? identities[0]
      : null;
    if (!senderIdentity) {
      throw new Error(
        `PostGrid send requires a verified mail_sender_identity for org ${shipment.organizationId}; none found.`,
      );
    }

    const fromAddress = {
      "from[firstName]": senderIdentity.companyName,
      "from[addressLine1]": senderIdentity.addressLine1,
      "from[addressLine2]": senderIdentity.addressLine2 ?? "",
      "from[city]": senderIdentity.city,
      "from[provinceOrState]": senderIdentity.state,
      "from[postalOrZip]": senderIdentity.zipCode,
      "from[country]": senderIdentity.country ?? "US",
    };

    const pieces: { providerPieceId: string; recipientRef: string }[] = [];
    let totalCostCents = 0;
    const feature = shipment.feature ?? "direct_mail";

    for (const piece of shipment.pieces) {
      const toAddress = {
        "to[firstName]": piece.recipient.firstName ?? "",
        "to[lastName]": piece.recipient.lastName ?? "",
        "to[addressLine1]": piece.recipient.address1,
        "to[addressLine2]": piece.recipient.address2 ?? "",
        "to[city]": piece.recipient.city,
        "to[provinceOrState]": piece.recipient.state,
        "to[postalOrZip]": piece.recipient.zip,
        "to[country]": "US",
      };

      const isLetter = piece.pieceType === "letter_10" || piece.pieceType === "handwritten";
      const path = isLetter ? "/letters" : "/postcards";
      const body: Record<string, unknown> = {
        ...fromAddress,
        ...toAddress,
        description: feature,
      };

      if (isLetter) {
        body.html = piece.vars?.htmlContent ?? piece.templateId ?? "";
        body.color = piece.vars?.color === "true";
        body.doubleSided = piece.vars?.doubleSided === "true";
      } else {
        body.size = piece.pieceType === "postcard_6x9" ? "6x9" : "4x6";
        body.frontHTML = piece.vars?.frontHtml ?? piece.templateId ?? "";
        body.backHTML = piece.vars?.backHtml ?? "";
      }

      const result = await postgridFetch(path, body);
      const providerPieceId = result.id ?? `postgrid_${Date.now()}`;
      const cost = POSTGRID_COSTS[piece.pieceType];

      pieces.push({ providerPieceId, recipientRef: `${shipment.customerId}` });
      totalCostCents += cost;

      // Ledger debit — PostGrid has no legacy hook, so we own the post.
      await postPostgridCostToLedger(shipment.organizationId, providerPieceId, cost, piece.pieceType, feature);
    }

    logger.info(`[postgridAdapter] sent ${pieces.length} pieces for org ${shipment.organizationId}`);

    return {
      provider: "postgrid",
      providerEventId: pieces[0]?.providerPieceId ?? `postgrid_shipment_${Date.now()}`,
      pieces,
      totalCostCents,
    };
  },
};
