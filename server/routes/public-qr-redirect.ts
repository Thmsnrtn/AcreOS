/**
 * Wave B — PUBLIC QR scan redirect: `GET /r/:code`.
 *
 * ⚠️ THIS ROUTE IS DELIBERATELY UNAUTHENTICATED. ⚠️
 *
 * It is scanned off a printed postcard by a stranger holding a phone. There
 * is no session, no organization context, and no possibility of one — so
 * `isAuthenticated` / `getOrCreateOrg` are intentionally absent here. Every
 * other route in the outreach-mail surface is org-scoped; this one is the
 * single public door, and it is built to leak nothing:
 *
 *   - The response is ALWAYS a 302 to the same constant landing URL. A valid
 *     code, an expired code, a forged code and a typo are indistinguishable
 *     from outside — so the endpoint is not an oracle for enumerating codes
 *     or discovering which organizations are mailing.
 *   - No organization name, lead name, address, shipment id or piece id ever
 *     reaches the response body, headers, or the redirect target.
 *   - Codes are HMAC-signed (see services/mail/qrCodes.ts), so a forged code
 *     is rejected arithmetically before a database query is issued. Scan
 *     counts cannot be manufactured for a campaign you did not mail.
 *   - Raw IPs and user agents are never stored; only a truncated,
 *     non-reversible HMAC used for repeat-hit suppression.
 *
 * Mounted by `registerOutreachMailRoutes` (server/routes-outreach-mail.ts)
 * rather than independently from server/routes.ts: it is a sub-surface of
 * the outreach-mail feature, not a standalone route module, which is also
 * why it lives under server/routes/ instead of the top-level
 * `server/routes-*.ts` manifest convention.
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { mailQrScanEvents, mailShipmentPieces } from "@shared/schema";
import { logger } from "../utils/logger";
import { getClientIp } from "../utils/clientIp";
import {
  parseQrCode,
  qrLandingUrl,
  scanFingerprint,
  scanSuppressionReason,
} from "../services/mail/qrCodes";

/**
 * Generous but finite. A real postcard campaign produces a trickle of scans
 * from many different IPs; a single IP hammering `/r/*` is either a crawler
 * or someone trying to brute-force tags. 120/min still lets an office behind
 * one NAT scan freely.
 */
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // A rate-limited scanner still reaches the landing page — we drop the
  // measurement, never the human.
  handler: (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, qrLandingUrl());
  },
});

/** Always the same exit, whatever happened internally. */
function landAnonymously(res: Response): void {
  // 302 (not 301) + no-store: a cached permanent redirect would silently stop
  // reporting scans, which would look like "the campaign went quiet" rather
  // than "we stopped measuring".
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.redirect(302, qrLandingUrl());
}

export function registerQrRedirectRoutes(app: Express): void {
  app.get("/r/:code", scanLimiter, async (req: Request, res: Response) => {
    const code = String(req.params.code ?? "").toLowerCase();

    try {
      const parsed = parseQrCode(code);
      if (!parsed) {
        // Unsigned / malformed / forged. Nothing recorded, nothing revealed.
        logger.debug("[qr-redirect] rejected code (bad signature or format)");
        return landAnonymously(res);
      }

      // The signature says which piece it claims to be; the stored column is
      // the authority. Both must agree, so a code minted under a rotated
      // secret cannot resolve to a piece that never carried it.
      const [piece] = await db
        .select({
          id: mailShipmentPieces.id,
          shipmentId: mailShipmentPieces.shipmentId,
          organizationId: mailShipmentPieces.organizationId,
        })
        .from(mailShipmentPieces)
        .where(
          and(
            eq(mailShipmentPieces.id, parsed.pieceId),
            eq(mailShipmentPieces.qrCode, code),
          ),
        )
        .limit(1);

      if (!piece) {
        logger.debug("[qr-redirect] signed code did not resolve to a piece");
        return landAnonymously(res);
      }

      const fingerprint = scanFingerprint(getClientIp(req), req.get("user-agent"));

      // Most recent COUNTED hit from this same client on this same piece.
      const [previous] = await db
        .select({ scannedAt: mailQrScanEvents.scannedAt })
        .from(mailQrScanEvents)
        .where(
          and(
            eq(mailQrScanEvents.pieceId, piece.id),
            eq(mailQrScanEvents.counted, true),
            fingerprint
              ? eq(mailQrScanEvents.clientFingerprint, fingerprint)
              : sql`${mailQrScanEvents.clientFingerprint} IS NULL`,
          ),
        )
        .orderBy(desc(mailQrScanEvents.scannedAt))
        .limit(1);

      const suppressed = scanSuppressionReason({
        signals: {
          userAgent: req.get("user-agent") ?? undefined,
          purpose:
            req.get("sec-purpose") ?? req.get("purpose") ?? req.get("x-purpose") ?? undefined,
          method: req.method,
        },
        lastCountedScanAt: previous?.scannedAt ? new Date(previous.scannedAt) : null,
      });

      const counted = suppressed === null;
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx.insert(mailQrScanEvents).values({
          pieceId: piece.id,
          shipmentId: piece.shipmentId,
          organizationId: piece.organizationId,
          scannedAt: now,
          clientFingerprint: fingerprint,
          counted,
          suppressedReason: suppressed,
        });

        if (counted) {
          await tx
            .update(mailShipmentPieces)
            .set({
              qrScanCount: sql`${mailShipmentPieces.qrScanCount} + 1`,
              updatedAt: now,
            })
            .where(eq(mailShipmentPieces.id, piece.id));
        }
      });

      logger.info("[qr-redirect] scan recorded", {
        metadata: {
          organizationId: piece.organizationId,
          shipmentId: piece.shipmentId,
          pieceId: piece.id,
          counted,
          suppressedReason: suppressed,
        },
      });

      return landAnonymously(res);
    } catch (err) {
      // A measurement failure must never strand the person holding the
      // postcard. Log loudly, land them anyway, and let the funnel show one
      // fewer scan rather than a 500 page.
      logger.error(
        "[qr-redirect] scan capture failed",
        err instanceof Error ? err : undefined,
      );
      return landAnonymously(res);
    }
  });
}
