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
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  connectedMailboxes,
  MAILBOX_OAUTH_PROVIDERS,
  type MailboxOAuthProvider,
} from "@shared/schema";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { getLinkedMailAccount } from "./services/mailbox/clerkMailbox";
import {
  listMessages,
  getMessage,
  sendMessage,
  MailboxNotConnectedError,
  MailboxApiError,
} from "./services/mailbox/mailboxClient";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";

const router = Router();

function isKnownProvider(p: string): p is (typeof MAILBOX_OAUTH_PROVIDERS)[number] {
  return (MAILBOX_OAUTH_PROVIDERS as readonly string[]).includes(p);
}

/**
 * Load an active (non-revoked), org-owned mailbox row by id, or null. Shared
 * by the read/send/settings routes so ownership + revocation are enforced in
 * exactly one place.
 */
async function loadOwnedMailbox(organizationId: number, id: number) {
  const [row] = await db
    .select()
    .from(connectedMailboxes)
    .where(
      and(
        eq(connectedMailboxes.id, id),
        eq(connectedMailboxes.organizationId, organizationId),
        isNull(connectedMailboxes.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Map a mailboxClient throw onto the right Errors.* response. Returns true if handled. */
function handleMailboxError(res: Response, err: unknown): boolean {
  if (err instanceof MailboxNotConnectedError) {
    Errors.badRequest(res, err.message);
    return true;
  }
  if (err instanceof MailboxApiError) {
    // Upstream provider failure — surface as a 502 (their dependency, not our bug).
    Errors.badGateway(res, err.message);
    return true;
  }
  return false;
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

// ── Read: list messages on-demand (nothing persisted) ───────────────────────
router.get("/:id/messages", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const mailbox = await loadOwnedMailbox(organizationId, id);
    if (!mailbox) return Errors.notFound(res, "Mailbox");
    if (!isKnownProvider(mailbox.provider)) return Errors.badRequest(res, "Unsupported mailbox provider");

    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;

    const result = await listMessages(userId, mailbox.provider as MailboxOAuthProvider, { query: q, pageToken });
    res.json(result);
  } catch (err) {
    if (handleMailboxError(res, err)) return;
    Errors.internal(res, err);
  }
});

// ── Read: full single message on-demand ─────────────────────────────────────
router.get("/:id/messages/:messageId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const mailbox = await loadOwnedMailbox(organizationId, id);
    if (!mailbox) return Errors.notFound(res, "Mailbox");
    if (!isKnownProvider(mailbox.provider)) return Errors.badRequest(res, "Unsupported mailbox provider");

    const message = await getMessage(userId, mailbox.provider as MailboxOAuthProvider, req.params.messageId);
    res.json({ message });
  } catch (err) {
    if (handleMailboxError(res, err)) return;
    Errors.internal(res, err);
  }
});

// ── Send: compose/reply on-demand through the customer's own mailbox ─────────
const sendSchema = z.object({
  to: z.string().email(),
  subject: z.string().max(998).default(""),
  body: z.string().min(1).max(200_000),
  inReplyTo: z.string().max(998).optional(),
  threadId: z.string().max(4096).optional(),
});

router.post("/:id/send", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    const mailbox = await loadOwnedMailbox(organizationId, id);
    if (!mailbox) return Errors.notFound(res, "Mailbox");
    if (!isKnownProvider(mailbox.provider)) return Errors.badRequest(res, "Unsupported mailbox provider");

    const sent = await sendMessage(userId, mailbox.provider as MailboxOAuthProvider, parsed.data);
    logger.info(`[mailbox] sent via ${mailbox.provider} for org=${organizationId}`);
    res.json({ ok: true, id: sent.id });
  } catch (err) {
    if (handleMailboxError(res, err)) return;
    Errors.internal(res, err);
  }
});

// ── Fine-tuning: merge per-mailbox settings (non-secret) ─────────────────────
const settingsSchema = z
  .object({
    signature: z.string().max(4000).optional(),
    aiReplyTone: z.enum(["professional", "friendly", "concise", "warm", "direct"]).optional(),
    showLabels: z.boolean().optional(),
  })
  .strict();

router.patch("/:id/settings", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    const mailbox = await loadOwnedMailbox(organizationId, id);
    if (!mailbox) return Errors.notFound(res, "Mailbox");

    const merged = { ...(mailbox.settings ?? {}), ...parsed.data };
    const [row] = await db
      .update(connectedMailboxes)
      .set({ settings: merged })
      .where(and(eq(connectedMailboxes.id, id), eq(connectedMailboxes.organizationId, organizationId)))
      .returning({ id: connectedMailboxes.id, settings: connectedMailboxes.settings });

    res.json({ mailbox: row });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Mounted in routes.ts behind `isAuthenticated, getOrCreateOrg` (byok posture).
export default router;
