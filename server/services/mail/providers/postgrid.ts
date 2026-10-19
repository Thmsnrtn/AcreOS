/**
 * Pillar 2 — PostGrid adapter (pay-as-you-go).
 *
 * OWN-KEY ONLY (founder decision 2026-10-17). AcreOS house mail runs on
 * AcreOS's own Lob account; PostGrid is a lane only for an org that connected
 * its OWN PostGrid key, which pays PostGrid directly — so this adapter never
 * reads a platform PostGrid key, never charges credits and never posts the
 * spend to AcreOS's opex ledger. An org without its own key gets a
 * non-viable quote and the router uses Lob instead.
 * Same per-piece API shape as Lob
 * (https://postgrid.com/docs/print-mail-v1/index.html).
 */

import type {
  MailProvider,
  MailShipment,
  PieceType,
  ProviderQuote,
  ProviderSendResult,
} from "../router";
import { averageCostCentsPerPiece, PartialMailSendError } from "../router";
import { logger } from "../../../utils/logger";
import { clock } from "../../../utils/clock";
import { assertOwnerContactAllowed } from "../../trust/ownerSuppression";

const POSTGRID_BASE_URL = "https://api.postgrid.com/print-mail/v1";

const POSTGRID_COSTS: Record<PieceType, number> = {
  postcard_4x6: 55,
  postcard_6x9: 70,
  letter_10: 85,
  handwritten: 240, // PostGrid does not offer true handwriting; quoted high so router prefers lettrlabs once it ships
};

/** The org's OWN PostGrid key (BYOK vault), or null. */
async function orgPostgridKey(organizationId: number): Promise<string | null> {
  try {
    const { getByokCredential } = await import("../../byok/key-vault");
    return await getByokCredential({ organizationId, channel: "postgrid" });
  } catch (err) {
    logger.warn("[postgridAdapter] own-key lookup failed", { metadata: { organizationId, error: err instanceof Error ? err.message : String(err) } });
    return null;
  }
}

async function postgridFetch(key: string, path: string, body: Record<string, unknown>): Promise<any> {

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

export const postgridAdapter: MailProvider = {
  name: "postgrid",

  // Participation is per org (its own key), decided in quote(); there is no
  // platform PostGrid account to be configured.
  isConfigured(): boolean {
    return true;
  },

  async quote(shipment: MailShipment): Promise<ProviderQuote> {
    const { orgHasOwnMailKey } = await import("../mailLane");
    if (!(await orgHasOwnMailKey(shipment.organizationId, "postgrid"))) {
      return {
        provider: "postgrid",
        costPerPieceCents: 0,
        deliveryEtaDays: 0,
        minVolume: 0,
        meetsConstraints: false,
        reasonIfNot: "PostGrid is own-key only and this org has no PostGrid key",
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
    // Platform-wide owner opt-out (W5a): every recipient is checked BEFORE
    // the first piece is sent, so a suppressed owner refuses the shipment
    // with nothing printed (ProviderNotContactedError) rather than half-sent.
    for (const piece of shipment.pieces) {
      await assertOwnerContactAllowed("mail", { addressLine1: piece.recipient.address1, zip: piece.recipient.zip });
    }

    // The lane: own PostGrid key or nothing. Resolved before any piece.
    const { resolveMailLane, assertSendableLane, letterSpec, postcardSpec } = await import("../mailLane");
    const isLetter = shipment.pieces.some((p) => p.pieceType === "letter_10" || p.pieceType === "handwritten");
    await assertSendableLane(
      await resolveMailLane(shipment.organizationId, isLetter ? letterSpec() : postcardSpec("4x6"), { via: "postgrid" }),
    );
    const key = await orgPostgridKey(shipment.organizationId);
    if (!key) {
      const { ProviderNotContactedError } = await import("../../actions/outwardAction");
      throw new ProviderNotContactedError("Your own PostGrid key could not be read, so nothing was mailed.");
    }

    const { storage } = await import("../../../storage");
    const identities = await storage.getMailSenderIdentities(shipment.organizationId);
    const senderIdentity = Array.isArray(identities)
      ? identities.find((i) => i.isDefault && i.isActive) ?? identities[0]
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

      let result: Awaited<ReturnType<typeof postgridFetch>>;
      try {
        result = await postgridFetch(key, path, body);
      } catch (err) {
        // DEFECT-0105: pieces already accepted are printed — say which.
        if (pieces.length > 0) {
          throw new PartialMailSendError("postgrid", pieces, shipment.pieces.length, err instanceof Error ? err.message : String(err));
        }
        throw err;
      }
      const providerPieceId = result.id ?? `postgrid_${clock.nowMs()}`;
      const cost = POSTGRID_COSTS[piece.pieceType];

      pieces.push({ providerPieceId, recipientRef: `${shipment.customerId}` });
      totalCostCents += cost;

      // No opex ledger post: the org's own PostGrid account paid for it.
    }

    logger.info(`[postgridAdapter] sent ${pieces.length} pieces for org ${shipment.organizationId}`);

    return {
      provider: "postgrid",
      providerEventId: pieces[0]?.providerPieceId ?? `postgrid_shipment_${clock.nowMs()}`,
      pieces,
      totalCostCents,
    };
  },
};
