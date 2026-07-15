/**
 * Native business inbox — mailbox routes (R1c, Clerk rewire).
 *
 * The customer LINKS their Google/Microsoft mailbox through Clerk (client-side
 * `createExternalAccount` with mail scopes). These routes then RECORD that
 * connection (org-scoped metadata + per-account settings) and read the live
 * token from Clerk on-demand for the read/send slices. AcreOS stores ZERO
 * tokens — Clerk holds them (minimal-custody at its floor).
 *
 * Mounted at /api/mailbox behind isAuthenticated + getOrCreateOrg.
 */

import { Router, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { connectedMailboxes, MAILBOX_OAUTH_PROVIDERS } from "@shared/schema";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { getLinkedMailAccount } from "./services/mailbox/clerkMailbox";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";

const router = Router();

function isKnownProvider(p: string): p is (typeof MAILBOX_OAUTH_PROVIDERS)[number] {
  return (MAILBOX_OAUTH_PROVIDERS as readonly string[]).includes(p);
}

// ── Record a mailbox the user linked via Clerk ──────────────────────────────
// The client runs Clerk's createExternalAccount (Google/Microsoft + mail
// scopes); on return it POSTs here. We verify the Clerk link exists, read the
// linked address from Clerk, and store the org-scoped connection (no tokens).
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = String((req.body as { provider?: string }).provider ?? "");
    if (!isKnownProvider(provider)) return Errors.badRequest(res, "Unknown mailbox provider");

    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);

    const linked = await getLinkedMailAccount(userId, provider);
    if (!linked) {
      return Errors.badRequest(
        res,
        `No linked ${provider} account found. Connect it first, then try again.`,
      );
    }

    const [row] = await db.transaction(async (tx) => {
      await tx
        .update(connectedMailboxes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(connectedMailboxes.organizationId, organizationId),
            eq(connectedMailboxes.emailAddress, linked.emailAddress),
            isNull(connectedMailboxes.revokedAt),
          ),
        );
      return tx
        .insert(connectedMailboxes)
        .values({
          organizationId,
          userId,
          provider,
          emailAddress: linked.emailAddress,
          status: "connected",
        })
        .returning({
          id: connectedMailboxes.id,
          provider: connectedMailboxes.provider,
          emailAddress: connectedMailboxes.emailAddress,
          status: connectedMailboxes.status,
        });
    });

    logger.info(`[mailbox] linked ${provider} for org=${organizationId}`);
    res.json({ mailbox: row });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── List connected mailboxes (metadata only — never tokens) ─────────────────
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const rows = await db
      .select({
        id: connectedMailboxes.id,
        provider: connectedMailboxes.provider,
        emailAddress: connectedMailboxes.emailAddress,
        status: connectedMailboxes.status,
        lastError: connectedMailboxes.lastError,
        lastSyncedAt: connectedMailboxes.lastSyncedAt,
        createdAt: connectedMailboxes.createdAt,
      })
      .from(connectedMailboxes)
      .where(and(eq(connectedMailboxes.organizationId, organizationId), isNull(connectedMailboxes.revokedAt)))
      .orderBy(desc(connectedMailboxes.createdAt));
    res.json({ mailboxes: rows, providers: [...MAILBOX_OAUTH_PROVIDERS] });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── Disconnect (revoke) ─────────────────────────────────────────────────────
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const [row] = await db
      .update(connectedMailboxes)
      .set({ revokedAt: new Date(), status: "revoked" })
      .where(
        and(
          eq(connectedMailboxes.id, id),
          eq(connectedMailboxes.organizationId, organizationId),
          isNull(connectedMailboxes.revokedAt),
        ),
      )
      .returning({ id: connectedMailboxes.id });

    if (!row) return Errors.notFound(res, "Mailbox");
    res.json({ ok: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Mounted in routes.ts behind `isAuthenticated, getOrCreateOrg` (byok posture).
export default router;
