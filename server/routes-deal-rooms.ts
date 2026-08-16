/**
 * Deal Room Routes — Tasks 45-52
 *
 * GET    /deal-rooms/:id                         — deal room details
 * GET    /deal-rooms/:id/messages                — paginated messages
 * POST   /deal-rooms/:id/messages                — send message + WS broadcast
 * GET    /deal-rooms/:id/documents               — list documents + version history
 * POST   /deal-rooms/:id/documents               — upload document
 * GET    /deal-rooms/:id/documents/:docId/download — signed download URL (1 hr)
 * POST   /deal-rooms/:id/participants            — invite participant by email
 * PATCH  /deal-rooms/:id/participants/:userId    — update participant role
 * DELETE /deal-rooms/:id/participants/:userId    — remove participant
 * GET    /deal-rooms/:id/activity                — activity timeline
 * POST   /deal-rooms/:id/nda                    — generate NDA/confidentiality agreement
 * POST   /deal-rooms/:id/notifications           — send notification to participants
 */

import { Router, type Request, type Response } from 'express';
import type { AuthenticatedRequest } from './types/request';
import { getOrganizationId } from './types/request';
import { db } from './db';
import {
  dealRooms,
  dealRoomMessages,
  dealRoomDocuments,
} from '@shared/schema';
import { eq, desc, and, asc } from 'drizzle-orm';
import crypto from 'crypto';
import { asyncHandler } from './middleware/asyncHandler';
import { validateUrl, SSRFBlockedError } from './middleware/fileUploadSecurity';
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUser(req: AuthenticatedRequest) {
  const user = req.user;
  if (!user) throw new Error('Not authenticated');
  return user;
}

// The users table stores firstName/lastName, not a single displayName column.
function userDisplayName(user: { firstName?: string | null; lastName?: string | null }): string | null {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}


function parseId(value: string, res: Response, label = "ID"): number | null {
  const id = parseInt(value, 10);
  if (isNaN(id)) {
    Errors.badRequest(res, `Invalid ${label}`);
    return null;
  }
  return id;
}

async function getDealRoomOrFail(id: number, req: AuthenticatedRequest, res: Response) {
  const organizationId = getOrganizationId(req);
  const results = await db.select().from(dealRooms).where(eq(dealRooms.id, id)).limit(1);
  if (results.length === 0) {
    Errors.notFound(res, "Deal room");
    return null;
  }
  const room = results[0];
  // Verify the requesting organization is a participant in this deal room
  const participants: any[] = (room.participants as any[]) ?? [];
  const isParticipant = participants.some(
    (p: any) => p.organizationId === organizationId
  );
  if (!isParticipant) {
    Errors.notFound(res, "Deal room");
    return null;
  }
  return room;
}

/** Broadcast to all WebSocket clients subscribed to a deal room */
function broadcastToDealRoom(req: Request | AuthenticatedRequest, dealRoomId: number, event: object) {
  try {
    // @ts-expect-error -- wss is attached by WebSocket middleware at runtime
    const wss = req.wss;
    if (!wss) return;
    const payload = JSON.stringify({ dealRoomId, ...event });
    wss.clients?.forEach((client: any) => {
      if (client.readyState === 1 && client.dealRoomId === dealRoomId) {
        client.send(payload);
      }
    });
  } catch {
    // WebSocket broadcast is best-effort
  }
}

// ─── GET /deal-rooms/:id ──────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoom = await getDealRoomOrFail(parseInt(req.params.id), req, res);
    if (!dealRoom) return;
    res.json({ dealRoom });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// ─── GET /deal-rooms/:id/messages ─────────────────────────────────────────────

router.get('/:id/messages', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    // Verify org-scoped access before returning messages
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const limit = Math.min(100, parseInt(String(req.query.limit ?? '50')));
    const offset = parseInt(String(req.query.offset ?? '0'));

    const messages = await db
      .select()
      .from(dealRoomMessages)
      .where(eq(dealRoomMessages.dealRoomId, dealRoomId))
      .orderBy(asc(dealRoomMessages.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ messages, limit, offset });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// ─── POST /deal-rooms/:id/messages ────────────────────────────────────────────

router.post('/:id/messages', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    // Verify org-scoped access before allowing message send
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const user = getUser(req);
    const { content, messageType = 'text', attachmentUrl } = req.body;

    if (!content?.trim()) {
      return Errors.badRequest(res, 'Message content is required');
    }

    const [message] = await db
      .insert(dealRoomMessages)
      .values({
        dealRoomId,
        senderId: String(user.id),
        senderName: userDisplayName(user) ?? user.email ?? 'Unknown',
        content: content.trim(),
        messageType,
        attachmentUrl: attachmentUrl ?? null,
        isRead: false,
      })
      .returning();

    // Broadcast via WebSocket to room participants
    broadcastToDealRoom(req, dealRoomId, { type: 'new_message', message });

    res.status(201).json({ message });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// ─── GET /deal-rooms/:id/documents ────────────────────────────────────────────

router.get('/:id/documents', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    // Verify org-scoped access before returning documents
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const documents = await db
      .select()
      .from(dealRoomDocuments)
      .where(eq(dealRoomDocuments.dealRoomId, dealRoomId))
      .orderBy(desc(dealRoomDocuments.createdAt));

    // Group by fileName to surface version history
    const byName = new Map<string, typeof documents>();
    for (const doc of documents) {
      const list = byName.get(doc.fileName) ?? [];
      list.push(doc);
      byName.set(doc.fileName, list);
    }

    const grouped = Array.from(byName.entries()).map(([fileName, versions]) => ({
      fileName,
      latestVersion: versions[0].version,
      versions,
    }));

    res.json({ documents: grouped });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// ─── POST /deal-rooms/:id/documents ───────────────────────────────────────────

router.post('/:id/documents', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    // Verify org-scoped access before allowing document upload
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const user = getUser(req);
    const { fileName, fileUrl, fileSize, mimeType, allowedUserIds } = req.body;

    if (!fileName || !fileUrl) {
      return Errors.badRequest(res, 'fileName and fileUrl are required');
    }

    // Validate file URL to prevent SSRF (F1: block internal/metadata addresses + DNS rebind).
    try {
      await validateUrl(fileUrl);
    } catch (urlError: any) {
      if (urlError instanceof SSRFBlockedError) {
        return res.status(422).json({
          error: "ssrf_blocked",
          message: urlError.message,
          statusCode: 422,
        });
      }
      return Errors.badRequest(res, `Invalid file URL: ${urlError.message}`);
    }

    // Block dangerous file extensions
    const ext = fileName.split('.').pop()?.toLowerCase();
    const blocked = ['exe', 'sh', 'bat', 'cmd', 'ps1', 'php', 'py', 'rb', 'pl', 'js', 'ts', 'jar', 'com', 'vbs'];
    if (ext && blocked.includes(ext)) {
      return Errors.badRequest(res, `File type .${ext} is not allowed`);
    }

    // Enforce file size limit (10MB)
    if (fileSize && Number(fileSize) > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }

    // Determine next version for this fileName
    const existing = await db
      .select()
      .from(dealRoomDocuments)
      .where(
        and(
          eq(dealRoomDocuments.dealRoomId, dealRoomId),
          eq(dealRoomDocuments.fileName, fileName)
        )
      )
      .orderBy(desc(dealRoomDocuments.version))
      .limit(1);

    const previousVersionId = existing[0]?.id ?? null;
    const version = existing.length > 0 ? existing[0].version + 1 : 1;

    const [doc] = await db
      .insert(dealRoomDocuments)
      .values({
        dealRoomId,
        uploadedBy: String(user.id),
        fileName,
        fileUrl,
        fileSize: fileSize ?? null,
        mimeType: mimeType ?? null,
        version,
        previousVersionId,
        accessControl: { allowedUserIds: allowedUserIds ?? [] },
      })
      .returning();

    // Log activity via WS
    broadcastToDealRoom(req, dealRoomId, {
      type: 'document_uploaded',
      document: doc,
      uploadedBy: userDisplayName(user) ?? user.email,
    });

    res.status(201).json({ document: doc });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// ─── GET /deal-rooms/:id/documents/:docId/download ────────────────────────────

router.get('/:id/documents/:docId/download', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    // Verify org-scoped access before allowing document download
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const docId = parseInt(req.params.docId);

    const results = await db
      .select()
      .from(dealRoomDocuments)
      .where(and(eq(dealRoomDocuments.id, docId), eq(dealRoomDocuments.dealRoomId, dealRoomId)))
      .limit(1);

    if (results.length === 0) {
      return Errors.notFound(res, "Document");
    }

    const doc = results[0];

    // Generate a signed URL that expires in 1 hour
    // If using S3/GCS, replace with SDK presigned URL generation
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    const signingSecret = process.env.DOCUMENT_SIGNING_SECRET
      || (process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('Missing required secret: DOCUMENT_SIGNING_SECRET'); })()
        : 'dev-fallback-not-for-production');
    const signature = crypto
      .createHmac('sha256', signingSecret)
      .update(`${docId}:${expiresAt}`)
      .digest('hex');

    const signedUrl = `${doc.fileUrl}?expires=${expiresAt}&sig=${signature}`;

    res.json({ url: signedUrl, expiresAt: new Date(expiresAt).toISOString() });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// ─── POST /deal-rooms/:id/participants ────────────────────────────────────────

router.post('/:id/participants', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const { email, role = 'buyer' } = req.body;
    if (!email) return Errors.badRequest(res, 'email is required');

    const currentParticipants: any[] = (dealRoom.participants as any[]) ?? [];

    // Check not already in the room
    const alreadyIn = currentParticipants.some((p: any) => p.email === email);
    if (alreadyIn) {
      return res.status(409).json({ error: 'Participant already in deal room' });
    }

    const newParticipant = {
      email,
      role,
      joinedAt: new Date().toISOString(),
    };

    const updatedParticipants = [...currentParticipants, newParticipant];

    const [updated] = await db
      .update(dealRooms)
      .set({ participants: updatedParticipants, updatedAt: new Date() })
      .where(eq(dealRooms.id, dealRoomId))
      .returning();

    // Send email invitation to the new participant.
    //
    // The participant row is already committed, so a mail failure must not fail
    // the request — but it must not be hidden either: an invitee who never got
    // the link is indistinguishable from one who ignored it. The outcome rides
    // back on the response.
    let invitationSent = false;
    let invitationError: string | undefined;
    try {
      const { emailService } = await import('./services/emailService');
      const org = req.organization;
      const dealRoomUrl = `${process.env.APP_URL ?? 'http://localhost:5000'}/deal-rooms/${dealRoomId}`;
      // COUNTERPARTY (founder decision 2026-07-17). `email` is a free-form
      // address from the request body and the default role is "buyer" — this is
      // the org inviting the other side of its deal into the room. The body is
      // signed "— {org.name} Team", so sending it from the platform identity is
      // the re-front the ruling forbids: the customer's name over AcreOS's
      // envelope. No connected identity → refusal, reported below.
      const inviteResult = await emailService.sendEmail({
        to: email,
        subject: `You've been invited to a deal room`,
        purpose: 'counterparty',
        html: `
          <p>Hi,</p>
          <p>You have been invited to join a deal room as a <strong>${role}</strong>.</p>
          <p><a href="${dealRoomUrl}">Click here to access the deal room</a></p>
          <p>If you don't have an account yet, you'll be prompted to create one.</p>
          <p>— ${org?.name ?? 'AcreOS'} Team</p>
        `,
        text: `You've been invited to join a deal room as a ${role}. Access it here: ${dealRoomUrl}`,
        organizationId: org?.id,
      });
      invitationSent = inviteResult.success;
      if (!inviteResult.success) {
        // sendEmail returns refusals rather than throwing, so the catch below
        // never sees the "no connected identity" case.
        invitationError = inviteResult.error;
        logger.warn('[deal-rooms] Invitation email not sent', {
          metadata: {
            dealRoomId,
            organizationId: org?.id,
            errorType: inviteResult.errorType,
          },
        });
      }
    } catch (emailErr) {
      // Non-fatal: participant is already added; log and continue
      invitationError = emailErr instanceof Error ? emailErr.message : 'Invitation email failed';
      logger.error('[deal-rooms] Failed to send invitation email', undefined, { metadata: { detail: emailErr } });
    }

    broadcastToDealRoom(req, dealRoomId, { type: 'participant_added', participant: newParticipant });

    res.status(201).json({ dealRoom: updated, invitationSent, invitationError });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// ─── PATCH /deal-rooms/:id/participants/:userId ───────────────────────────────

router.patch('/:id/participants/:userId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    const { userId } = req.params;
    const { role } = req.body;

    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const participants: any[] = (dealRoom.participants as any[]) ?? [];
    const idx = participants.findIndex((p: any) => String(p.organizationId) === userId || p.email === userId);
    if (idx === -1) return Errors.notFound(res, "Participant");

    participants[idx] = { ...participants[idx], role };

    const [updated] = await db
      .update(dealRooms)
      .set({ participants, updatedAt: new Date() })
      .where(eq(dealRooms.id, dealRoomId))
      .returning();

    res.json({ dealRoom: updated });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// ─── DELETE /deal-rooms/:id/participants/:userId ──────────────────────────────

router.delete('/:id/participants/:userId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    const { userId } = req.params;

    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const participants: any[] = (dealRoom.participants as any[]) ?? [];
    const filtered = participants.filter(
      (p: any) => String(p.organizationId) !== userId && p.email !== userId
    );

    if (filtered.length === participants.length) {
      return Errors.notFound(res, "Participant");
    }

    const [updated] = await db
      .update(dealRooms)
      .set({ participants: filtered, updatedAt: new Date() })
      .where(eq(dealRooms.id, dealRoomId))
      .returning();

    broadcastToDealRoom(req, dealRoomId, { type: 'participant_removed', userId });

    res.json({ dealRoom: updated });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// ─── GET /deal-rooms/:id/activity ─────────────────────────────────────────────

router.get('/:id/activity', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    // Verify org-scoped access before returning activity
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const limit = Math.min(100, parseInt(String(req.query.limit ?? '50')));

    // Combine messages and documents as an activity timeline
    const [messages, documents] = await Promise.all([
      db
        .select()
        .from(dealRoomMessages)
        .where(eq(dealRoomMessages.dealRoomId, dealRoomId))
        .orderBy(desc(dealRoomMessages.createdAt))
        .limit(limit),
      db
        .select()
        .from(dealRoomDocuments)
        .where(eq(dealRoomDocuments.dealRoomId, dealRoomId))
        .orderBy(desc(dealRoomDocuments.createdAt))
        .limit(limit),
    ]);

    const activity = [
      ...messages.map((m) => ({
        id: `msg-${m.id}`,
        type: 'message' as const,
        actor: m.senderName,
        description: m.messageType === 'document'
          ? `Shared a document`
          : `Sent a message`,
        timestamp: m.createdAt,
        meta: { content: m.content },
      })),
      ...documents.map((d) => ({
        id: `doc-${d.id}`,
        type: 'document' as const,
        actor: d.uploadedBy,
        description: `Uploaded "${d.fileName}" (v${d.version})`,
        timestamp: d.createdAt,
        meta: { fileName: d.fileName, version: d.version },
      })),
    ].sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime());

    res.json({ activity });
  } catch (error: any) {
    Errors.internal(res, error);
  }
}));

// ─── POST /deal-rooms/:id/nda ─────────────────────────────────────────────────

router.post('/:id/nda', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    const user = getUser(req);
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const {
      partyName,
      partyTitle,
      disclosingParty = 'AcreOS Marketplace Seller',
      effectiveDate = new Date().toISOString().split('T')[0],
    } = req.body;

    // Generate a basic NDA document structure
    // In production this would call a document generation service (e.g., DocuSign, Anvil)
    const ndaContent = `
NON-DISCLOSURE AGREEMENT

Effective Date: ${effectiveDate}

This Non-Disclosure Agreement ("Agreement") is entered into as of the Effective Date
between ${disclosingParty} ("Disclosing Party") and ${partyName ?? userDisplayName(user) ?? 'Receiving Party'} ("Receiving Party").

1. CONFIDENTIAL INFORMATION
   The Receiving Party agrees to keep confidential all non-public information disclosed
   in connection with Deal Room #${dealRoomId}.

2. OBLIGATIONS
   The Receiving Party shall not disclose any Confidential Information to third parties
   without prior written consent of the Disclosing Party.

3. TERM
   This Agreement shall remain in effect for a period of two (2) years from the Effective Date.

4. GOVERNING LAW
   This Agreement shall be governed by the laws of the applicable jurisdiction.

Disclosing Party: ${disclosingParty}
Receiving Party: ${partyName ?? userDisplayName(user)}
Title: ${partyTitle ?? ''}
Signed: ${new Date().toISOString()}
Verification Code: ${crypto.randomBytes(8).toString('hex').toUpperCase()}
    `.trim();

    // Store the NDA as a document in the deal room
    const [ndaDoc] = await db
      .insert(dealRoomDocuments)
      .values({
        dealRoomId,
        uploadedBy: String(user.id),
        fileName: `NDA-DealRoom-${dealRoomId}-${Date.now()}.txt`,
        fileUrl: '', // Would be populated by document service
        fileSize: ndaContent.length,
        mimeType: 'text/plain',
        version: 1,
        previousVersionId: null,
        accessControl: { allowedUserIds: [] },
      })
      .returning();

    broadcastToDealRoom(req, dealRoomId, {
      type: 'nda_generated',
      document: ndaDoc,
      generatedFor: partyName ?? userDisplayName(user),
    });

    res.status(201).json({ document: ndaDoc, ndaContent });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// ─── POST /deal-rooms/:id/notifications ───────────────────────────────────────

router.post('/:id/notifications', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dealRoomId = parseInt(req.params.id);
    const user = getUser(req);
    const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
    if (!dealRoom) return;

    const { subject, message, targetUserIds } = req.body;
    if (!message) return Errors.badRequest(res, 'message is required');

    const participants: any[] = (dealRoom.participants as any[]) ?? [];
    const targets =
      targetUserIds && targetUserIds.length > 0
        ? participants.filter((p: any) => targetUserIds.includes(String(p.organizationId)))
        : participants;

    // In production: send emails/push notifications via your notification service
    // For now, broadcast via WebSocket and log a system message
    const [systemMessage] = await db
      .insert(dealRoomMessages)
      .values({
        dealRoomId,
        senderId: String(user.id),
        senderName: 'System',
        content: `[Notification] ${subject ? subject + ': ' : ''}${message}`,
        messageType: 'system',
        attachmentUrl: null,
        isRead: false,
      })
      .returning();

    broadcastToDealRoom(req, dealRoomId, {
      type: 'notification',
      subject,
      message,
      sentBy: userDisplayName(user) ?? user.email,
      targetCount: targets.length,
    });

    res.json({
      success: true,
      notifiedCount: targets.length,
      systemMessage,
    });
  } catch (error: any) {
    Errors.badRequest(res, error.message ?? "Bad request");
  }
}));

// FW-MIREILLE-1 (push-forward 2026-05-08): deal-room growth-loop retrofit.
// POST /deal-rooms/:id/share-link — operator opts in to public sharing.
// Generates a slug (16 hex chars) and stamps publicShareEnabledAt. Idempotent;
// re-calling returns the existing slug. Operator can opt out by deleting.
router.post('/:id/share-link', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const dealRoomId = parseInt(req.params.id);
  if (isNaN(dealRoomId)) return Errors.badRequest(res, 'Invalid deal room ID');
  const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
  if (!dealRoom) return;

  const existingSlug = (dealRoom as any).publicShareSlug as string | null | undefined;
  if (existingSlug) {
    return res.json({ slug: existingSlug, url: `/deal-rooms/share/${existingSlug}` });
  }

  const slug = crypto.randomBytes(8).toString('hex');
  await db
    .update(dealRooms)
    .set({
      publicShareSlug: slug,
      publicShareEnabledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dealRooms.id, dealRoomId));

  return res.json({ slug, url: `/deal-rooms/share/${slug}` });
}));

// DELETE /deal-rooms/:id/share-link — operator revokes public sharing.
router.delete('/:id/share-link', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const dealRoomId = parseInt(req.params.id);
  if (isNaN(dealRoomId)) return Errors.badRequest(res, 'Invalid deal room ID');
  const dealRoom = await getDealRoomOrFail(dealRoomId, req, res);
  if (!dealRoom) return;

  await db
    .update(dealRooms)
    .set({ publicShareSlug: null, publicShareEnabledAt: null, updatedAt: new Date() })
    .where(eq(dealRooms.id, dealRoomId));

  return res.json({ revoked: true });
}));

export default router;

// FW-MIREILLE-1: PUBLIC unauthenticated view route.
// Mounted separately at /api/public/deal-rooms in registerPublicDealRoomRoute
// (called from server/routes.ts). Returns sanitized deal-room view for the
// "growth loop" surface — no PII, no internal notes, just enough deal shape
// to make a viewer think "I'd want this for my own deals" + signup CTA.
import type { Express } from 'express';
import { sql } from 'drizzle-orm';
export function registerPublicDealRoomRoute(app: Express): void {
  app.get('/api/public/deal-rooms/:slug', async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug;
      if (!slug || !/^[a-f0-9]{16}$/.test(slug)) {
        return Errors.notFound(res, 'Deal room');
      }
      const [room] = await db
        .select()
        .from(dealRooms)
        .where(eq(dealRooms.publicShareSlug, slug))
        .limit(1);
      if (!room) return Errors.notFound(res, 'Deal room');

      // Increment view counter; fire-and-forget.
      db.update(dealRooms)
        .set({ publicViewCount: sql`${dealRooms.publicViewCount} + 1` })
        .where(eq(dealRooms.id, room.id))
        .then(() => undefined)
        .catch(() => undefined);

      // Referral loop (S2d): attribute conversions from this shared artifact
      // to the sharing org. Resolve the first (seller-side) participant org's
      // referral code and expose ONLY the opaque code — no org identity.
      let refCode: string | null = null;
      try {
        const participants = Array.isArray(room.participants)
          ? (room.participants as Array<{ organizationId?: number; role?: string }>)
          : [];
        const sharerOrgId =
          participants.find((p) => p.role === "seller")?.organizationId ??
          participants[0]?.organizationId;
        if (sharerOrgId) {
          const codeRows = await db.execute<{ referral_code: string }>(
            sql`SELECT referral_code FROM users WHERE organization_id = ${sharerOrgId} AND referral_code IS NOT NULL LIMIT 1`,
          );
          const rows = Array.isArray(codeRows) ? codeRows : (codeRows as { rows?: Array<{ referral_code: string }> }).rows ?? [];
          refCode = rows[0]?.referral_code ?? null;
        }
      } catch {
        refCode = null; // attribution is best-effort — never break the public page
      }

      // Sanitized projection — strip participants, internal notes, prices.
      // The viewer sees "a deal happened on AcreOS" + dealType + status +
      // documents-shared-count, NOT the actual price or PII.
      return res.json({
        slug,
        refCode,
        dealType: room.dealType,
        status: room.status,
        sharedDocumentsCount: Array.isArray(room.sharedDocuments)
          ? (room.sharedDocuments as unknown[]).length
          : 0,
        participantCount: Array.isArray(room.participants)
          ? (room.participants as unknown[]).length
          : 0,
        closedAt: room.closedAt,
        createdAt: room.createdAt,
        viewCount: (room.publicViewCount ?? 0) + 1,
      });
    } catch (err) {
      logger.error('[public-deal-rooms] failed', err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });
}
