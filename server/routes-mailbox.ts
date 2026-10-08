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
  teamMembers,
  MAILBOX_OAUTH_PROVIDERS,
  type MailboxOAuthProvider,
} from "@shared/schema";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { normalizeRole } from "./middleware/roleGuard";
import { getLinkedMailAccount } from "./services/mailbox/clerkMailbox";
import {
  listMessages,
  getMessage,
  sendMessage,
  MailboxNotConnectedError,
  MailboxApiError,
} from "./services/mailbox/mailboxClient";
import { summarizeThread } from "./services/mailbox/threadSummary";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { clock } from "./utils/clock";

const router = Router();

function isKnownProvider(p: string): p is (typeof MAILBOX_OAUTH_PROVIDERS)[number] {
  return (MAILBOX_OAUTH_PROVIDERS as readonly string[]).includes(p);
}

/**
 * Load an active (non-revoked), org-owned mailbox row by id, or null. Shared
 * by the read/send/settings routes so ownership + revocation are enforced in
 * exactly one place.
 */
async function loadOrgMailbox(organizationId: number, id: number) {
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

/**
 * The mailbox a request may READ or SEND through: this org's row, linked by
 * THIS user. Reading and sending act as a person's own mailbox; a teammate's
 * row being in the same org does not make it theirs (quality directive
 * 2026-09-29: the row was resolved by org alone and the REQUESTER's token
 * used, so a teammate opening another member's mailbox read and sent from
 * their own account under the other member's address). Delegation is not
 * built; until it is, only the linking user may use a mailbox. Responds and
 * returns null when the request may not.
 */
async function loadUsableMailbox(req: AuthenticatedRequest, res: Response, id: number) {
  const mailbox = await loadOrgMailbox(getOrganizationId(req), id);
  if (!mailbox) {
    Errors.notFound(res, "Mailbox");
    return null;
  }
  if (mailbox.userId !== getUserId(req)) {
    Errors.forbidden(res, "This mailbox was connected by another team member — only they can read or send from it.");
    return null;
  }
  if (!isKnownProvider(mailbox.provider)) {
    Errors.badRequest(res, "Unsupported mailbox provider");
    return null;
  }
  return {
    row: mailbox,
    account: { userId: mailbox.userId, provider: mailbox.provider as MailboxOAuthProvider, emailAddress: mailbox.emailAddress },
  };
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Map a mailboxClient throw onto the right Errors.* response. Returns true if handled. */
function handleMailboxError(res: Response, err: unknown): boolean {
  if (err instanceof MailboxNotConnectedError) {
    Errors.badRequest(res, err.message);
    return true;
  }
  if (err instanceof MailboxApiError && err.outcome === "unknown") {
    // The provider may have received it. Never presented as a plain failure
    // (which invites a second send).
    sendError(res, 502, "send_outcome_unknown", err.message, { outcome: "unknown" });
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

    const preferred = (req.body as { emailAddress?: unknown }).emailAddress;
    const linked = await getLinkedMailAccount(userId, provider, typeof preferred === "string" ? preferred : undefined);
    if (!linked) {
      return Errors.badRequest(
        res,
        `No linked ${provider} account found${typeof preferred === "string" ? ` for ${preferred}` : ""}. Connect it first, then try again.`,
      );
    }
    if ("ambiguous" in linked) {
      return Errors.badRequest(res, `Several ${provider} accounts are linked — choose which address to connect.`, {
        reason: "choose_account",
        addresses: linked.ambiguous,
      });
    }

    const [row] = await db.transaction(async (tx) => {
      await tx
        .update(connectedMailboxes)
        .set({ revokedAt: clock.now() })
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
        // The settings the dialog edits — GET omitted them, so the dialog
        // showed defaults over what was saved.
        settings: connectedMailboxes.settings,
        userId: connectedMailboxes.userId,
      })
      .from(connectedMailboxes)
      .where(and(eq(connectedMailboxes.organizationId, organizationId), isNull(connectedMailboxes.revokedAt)))
      .orderBy(desc(connectedMailboxes.createdAt));
    const me = getUserId(req);
    res.json({
      // `mine`: only the linking user may read or send through a mailbox.
      mailboxes: rows.map(({ userId: owner, ...r }) => ({ ...r, mine: owner === me })),
      providers: [...MAILBOX_OAUTH_PROVIDERS],
    });
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

    // Disconnecting another member's mailbox is an admin act: the linking
    // member, or an org owner/admin — not any member (audit of 60ebfd9).
    const mailbox = await loadOrgMailbox(organizationId, id);
    if (!mailbox) return Errors.notFound(res, "Mailbox");
    const requester = getUserId(req);
    if (mailbox.userId !== requester) {
      const [member] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.organizationId, organizationId),
            eq(teamMembers.userId, requester),
            eq(teamMembers.isActive, true),
          ),
        )
        .limit(1);
      const role = normalizeRole(member?.role ?? "");
      if (role !== "owner" && role !== "admin") {
        return Errors.forbidden(res, "Only the member who connected this mailbox, or an org owner or admin, can disconnect it.");
      }
    }

    const [row] = await db
      .update(connectedMailboxes)
      .set({ revokedAt: clock.now(), status: "revoked" })
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
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const usable = await loadUsableMailbox(req, res, id);
    if (!usable) return;

    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;

    const result = await listMessages(usable.account, { query: q, pageToken });
    res.json(result);
  } catch (err) {
    if (handleMailboxError(res, err)) return;
    Errors.internal(res, err);
  }
});

// ── Read: full single message on-demand ─────────────────────────────────────
router.get("/:id/messages/:messageId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const usable = await loadUsableMailbox(req, res, id);
    if (!usable) return;

    const message = await getMessage(usable.account, req.params.messageId);
    res.json({ message });
  } catch (err) {
    if (handleMailboxError(res, err)) return;
    Errors.internal(res, err);
  }
});

// ── Read: one-line Pax summary of a thread (on-demand, never persisted) ──────
router.get("/:id/messages/:messageId/summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const usable = await loadUsableMailbox(req, res, id);
    if (!usable) return;

    const message = await getMessage(usable.account, req.params.messageId);
    const summary = await summarizeThread(message, `${getOrganizationId(req)}:${usable.account.emailAddress}`);
    res.json({ summary });
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
  replyToMessageId: z.string().max(4096).optional(),
});

router.post("/:id/send", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid mailbox id");

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

    const usable = await loadUsableMailbox(req, res, id);
    if (!usable) return;

    // The saved signature is applied — it was stored and shown in the
    // settings dialog but never reached a sent message.
    const signature = typeof usable.row.settings?.signature === "string" ? usable.row.settings.signature.trim() : "";
    const body = signature
      ? `${parsed.data.body}<br><br>${escapeHtml(signature).replace(/\n/g, "<br>")}`
      : parsed.data.body;
    const sent = await sendMessage(usable.account, { ...parsed.data, body });
    logger.info(`[mailbox] send accepted by ${usable.account.provider} for org=${organizationId}`);
    // Accepted by the provider — not "delivered". Microsoft's 202 means
    // accepted for processing; Gmail's id means Gmail took it.
    res.json({ ok: true, id: sent.id, outcome: sent.outcome, provider: usable.account.provider, from: usable.account.emailAddress });
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

    // The signature is appended to every message sent from this mailbox, so
    // only the member who linked it may change it — a teammate editing it
    // would be writing into someone else's outgoing mail.
    const usable = await loadUsableMailbox(req, res, id);
    if (!usable) return;
    const mailbox = usable.row;

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
