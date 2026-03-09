/**
 * @Mention Service (T57)
 *
 * Parses @mention tokens from note/comment bodies, looks up the mentioned
 * team member, and creates an in-app notification + email digest entry.
 *
 * Usage:
 *   import { processMentions } from "./mentionService";
 *   await processMentions(organizationId, noteBody, { entityType: "lead", entityId: 42, authorName: "Jane" });
 */

import { db } from "../db";
import { teamMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";

export interface MentionContext {
  entityType: "lead" | "deal" | "property";
  entityId: number;
  authorName: string;
  notePreview?: string; // first 120 chars of the note body
}

/**
 * Extract @mention tokens from a note body.
 * Supports:
 *   @Jane, @jane.doe, @"Jane Doe", @jane_doe
 * Returns unique lowercase handles.
 */
export function extractMentionHandles(body: string): string[] {
  // Match @word, @word.word, @word_word, @"multi word"
  const quoted = body.match(/@"([^"]+)"/g) ?? [];
  const simple = body.match(/@([A-Za-z0-9_.]+)/g) ?? [];

  const handles = [
    ...quoted.map((m) => m.slice(2, -1).toLowerCase()),
    ...simple.map((m) => m.slice(1).toLowerCase()),
  ];

  return [...new Set(handles)];
}

/**
 * Find team members matching the mention handles (by displayName or email prefix).
 */
async function resolveMentions(
  organizationId: number,
  handles: string[]
): Promise<Array<{ id: number; userId: string; displayName: string; email: string }>> {
  if (handles.length === 0) return [];

  const members = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      displayName: teamMembers.displayName,
      email: teamMembers.email,
    })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.organizationId, organizationId),
        eq(teamMembers.isActive, true)
      )
    );

  const matched: typeof members = [];
  for (const m of members) {
    const name = (m.displayName ?? "").toLowerCase().replace(/\s+/g, "");
    const emailLocal = (m.email ?? "").split("@")[0].toLowerCase();

    for (const handle of handles) {
      const normalizedHandle = handle.replace(/[\s.]/g, "").toLowerCase();
      if (
        name === normalizedHandle ||
        emailLocal === normalizedHandle ||
        emailLocal.startsWith(normalizedHandle) ||
        name.startsWith(normalizedHandle)
      ) {
        matched.push(m);
        break;
      }
    }
  }

  // Deduplicate
  return matched.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
}

/**
 * Parse @mentions in a note body, find matching team members, and send
 * in-app notifications. Returns the list of notified member IDs.
 */
export async function processMentions(
  organizationId: number,
  noteBody: string,
  context: MentionContext
): Promise<number[]> {
  const handles = extractMentionHandles(noteBody);
  if (handles.length === 0) return [];

  const members = await resolveMentions(organizationId, handles);
  if (members.length === 0) return [];

  const preview = (context.notePreview ?? noteBody).slice(0, 120);
  const entityLabel = `${context.entityType} #${context.entityId}`;

  const notifiedIds: number[] = [];

  for (const m of members) {
    if (!m.userId) continue;
    try {
      await storage.createNotification({
        organizationId,
        userId: m.userId,
        type: "team_mention",
        title: `${context.authorName} mentioned you`,
        message: `On ${entityLabel}: "${preview}${preview.length < noteBody.length ? "…" : ""}"`,
        entityType: context.entityType,
        entityId: context.entityId,
        metadata: {
          authorName: context.authorName,
          handle: m.displayName || m.email,
        },
      });
      notifiedIds.push(m.id);
      console.log(
        `[Mention] Notified ${m.displayName || m.email} (member #${m.id}) on ${entityLabel}`
      );
    } catch (err) {
      console.error(`[Mention] Failed to notify member #${m.id}:`, err);
    }
  }

  // Optionally send email digest (non-blocking, low priority)
  if (notifiedIds.length > 0) {
    setImmediate(async () => {
      try {
        await sendMentionEmailDigest(members, context, preview, organizationId);
      } catch (_) {}
    });
  }

  return notifiedIds;
}

async function sendMentionEmailDigest(
  members: Array<{ email: string | null; displayName: string | null }>,
  context: MentionContext,
  preview: string,
  organizationId: number
): Promise<void> {
  const { sendEmail } = await import("./emailService");
  for (const m of members) {
    if (!m.email) continue;
    await sendEmail({
      to: m.email,
      subject: `You were mentioned in AcreOS`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1e3a5f;">You were @mentioned</h2>
          <p>Someone mentioned you on <strong>${context.entityType} #${context.entityId}</strong>:</p>
          <blockquote style="border-left:3px solid #1e3a5f;padding:8px 16px;background:#f8fafc;color:#374151;">
            "${preview}"
          </blockquote>
          <p>Log in to AcreOS to view the full note and reply.</p>
        </div>
      `,
      text: `You were mentioned on ${context.entityType} #${context.entityId}: "${preview}"`,
    });
  }
}
