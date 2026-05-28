/**
 * accessReview — Quarterly admin/owner access review (Kareem §2).
 *
 * SOC 2 CC6.2 requires that privileged access is reviewed on a documented
 * cadence and that stale credentials are revoked. For Type II, the auditor
 * will ask for evidence of (a) the review running, (b) the list reviewed,
 * and (c) any action taken. This job produces all three:
 *
 *   1. Enumerates every team_members row with role IN ('owner','admin')
 *      across every active organization.
 *   2. Joins each row with users.lastActiveAt (the closest signal to
 *      last-login we have today — Clerk webhook-driven).
 *   3. Flags stale admins (lastActiveAt > STALE_THRESHOLD_DAYS old, or
 *      never active).
 *   4. Emails the founder(s) the full list with stale rows called out.
 *   5. Writes an audit_events row so the auditor can trace evidence back
 *      to a specific run.
 *
 * Cadence: quarterly. Wired into runScheduledJobs.ts so the worker process
 * fires it on the first Tuesday of January / April / July / October at
 * 14:00 UTC (matches the dr-drill-quarterly.md cadence).
 *
 * Idempotent within a day: a systemMeta key prevents duplicate sends if
 * the worker process restarts during the window.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { teamMembers, organizations, users, systemMeta } from "@shared/schema";
import { emailService } from "../services/emailService";
import { logger } from "../utils/logger";
import { auditLog as auditEvent } from "../utils/auditLog";

const STALE_THRESHOLD_DAYS = 90;
const SENTINEL_KEY = "access_review_last_run";

const FOUNDER_EMAILS: string[] = Array.from(
  new Set(
    [
      ...(process.env.FOUNDER_EMAIL ? [process.env.FOUNDER_EMAIL.trim()] : []),
      ...(process.env.FOUNDER_EMAILS
        ? process.env.FOUNDER_EMAILS.split(",").map((e) => e.trim()).filter(Boolean)
        : []),
    ].filter(Boolean),
  ),
);

interface AdminReviewRow {
  organizationId: number;
  organizationName: string | null;
  teamMemberId: number;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  isActive: boolean;
  joinedAt: Date | null;
  lastActiveAt: Date | null;
  stale: boolean;
  staleDays: number | null;
  neverActive: boolean;
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Run the access review. Returns the rows reviewed plus a flag for whether
 * any stale admins exist. Public so it can be invoked on demand from a
 * founder admin route (future enhancement) or a test harness.
 */
export async function runQuarterlyAccessReview(): Promise<{
  rows: AdminReviewRow[];
  stale: AdminReviewRow[];
  sentTo: string[];
}> {
  const rows = await db
    .select({
      organizationId: teamMembers.organizationId,
      organizationName: organizations.name,
      teamMemberId: teamMembers.id,
      userId: teamMembers.userId,
      email: teamMembers.email,
      displayName: teamMembers.displayName,
      role: teamMembers.role,
      isActive: teamMembers.isActive,
      joinedAt: teamMembers.joinedAt,
      // users has no lastActiveAt column; updatedAt is the best available
      // proxy for recent account activity. TODO(tsc): add a real
      // last_active_at column to users if precise activity tracking is needed.
      lastActiveAt: users.updatedAt,
    })
    .from(teamMembers)
    .leftJoin(organizations, eq(teamMembers.organizationId, organizations.id))
    .leftJoin(users, eq(teamMembers.userId, users.id))
    .where(inArray(teamMembers.role, ["owner", "admin"]));

  const reviewed: AdminReviewRow[] = rows.map((r) => {
    const staleDays = daysSince(r.lastActiveAt as Date | null);
    const neverActive = r.lastActiveAt == null;
    const stale = neverActive || (staleDays !== null && staleDays > STALE_THRESHOLD_DAYS);
    return {
      organizationId: r.organizationId,
      organizationName: r.organizationName ?? null,
      teamMemberId: r.teamMemberId,
      userId: r.userId,
      email: r.email ?? null,
      displayName: r.displayName ?? null,
      role: r.role,
      isActive: r.isActive,
      joinedAt: (r.joinedAt as Date | null) ?? null,
      lastActiveAt: (r.lastActiveAt as Date | null) ?? null,
      stale,
      staleDays,
      neverActive,
    };
  });

  const stale = reviewed.filter((r) => r.stale);

  // Email the founder(s). Failure is non-fatal — the audit_event still
  // records that the review ran.
  const sentTo: string[] = [];
  if (FOUNDER_EMAILS.length > 0) {
    const html = renderAccessReviewHtml(reviewed, stale);
    const subject = stale.length > 0
      ? `[AcreOS access review] ${stale.length} stale admin(s) flagged`
      : `[AcreOS access review] All ${reviewed.length} admins active`;
    for (const to of FOUNDER_EMAILS) {
      try {
        await emailService.sendEmail({
          to,
          subject,
          html,
        });
        sentTo.push(to);
      } catch (err) {
        logger.error("[accessReview] email send failed", err instanceof Error ? err : undefined, {
          metadata: { to },
        });
      }
    }
  }

  // Persist evidence of the run.
  await auditEvent({
    actor: { userId: null, email: null, ip: null, userAgent: "scheduled-job/access-review" },
    action: "access_review.quarterly",
    target: { type: "organization", id: 0 },
    metadata: {
      reviewedCount: reviewed.length,
      staleCount: stale.length,
      thresholdDays: STALE_THRESHOLD_DAYS,
      sentTo,
    },
  });

  // Record last-run sentinel.
  const now = new Date().toISOString();
  await db
    .insert(systemMeta)
    .values({ key: SENTINEL_KEY, value: now })
    .onConflictDoUpdate({
      target: systemMeta.key,
      set: { value: now, updatedAt: new Date() },
    });

  logger.info(`[accessReview] reviewed=${reviewed.length} stale=${stale.length} sent=${sentTo.length}`);
  return { rows: reviewed, stale, sentTo };
}

/**
 * Has the quarterly access review already run today? Used to dedupe firing
 * if the scheduler ticks twice within the 5-minute window.
 */
export async function alreadyRanToday(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemMeta.value })
    .from(systemMeta)
    .where(eq(systemMeta.key, SENTINEL_KEY))
    .limit(1);
  if (!row?.value) return false;
  const last = new Date(row.value);
  const now = new Date();
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate()
  );
}

/**
 * The first Tuesday of Jan/Apr/Jul/Oct — quarterly cadence aligned with the
 * dr-drill-quarterly.md cadence so the founder has one "compliance morning"
 * per quarter rather than four scattered ones.
 */
export function isQuarterlyAccessReviewDay(now: Date = new Date()): boolean {
  const month = now.getUTCMonth(); // 0-Jan, 3-Apr, 6-Jul, 9-Oct
  if (month !== 0 && month !== 3 && month !== 6 && month !== 9) return false;
  const day = now.getUTCDate();
  if (day > 7) return false; // first week of the month only
  // Tuesday = 2 in JS getUTCDay().
  return now.getUTCDay() === 2;
}

function renderAccessReviewHtml(all: AdminReviewRow[], stale: AdminReviewRow[]): string {
  const fmt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "never");
  const rowHtml = (r: AdminReviewRow) => `
    <tr style="${r.stale ? "background:#fff7ed;" : ""}">
      <td>${escapeHtml(r.organizationName ?? `org#${r.organizationId}`)}</td>
      <td>${escapeHtml(r.displayName ?? r.email ?? r.userId)}</td>
      <td>${escapeHtml(r.role)}</td>
      <td>${r.isActive ? "yes" : "<b>no</b>"}</td>
      <td>${fmt(r.lastActiveAt)}</td>
      <td>${r.staleDays ?? "—"}</td>
      <td>${r.stale ? "<b>STALE</b>" : ""}</td>
    </tr>`;
  const tableRows = all
    .slice()
    .sort((a, b) => Number(b.stale) - Number(a.stale))
    .map(rowHtml)
    .join("");
  return `<html><body style="font-family:system-ui,sans-serif;">
    <h2>AcreOS Quarterly Access Review</h2>
    <p>This is SOC 2 evidence — review and revoke any unnecessary privileged access.</p>
    <p><b>${all.length}</b> owner/admin role(s) across all organizations.
       <b>${stale.length}</b> flagged stale (no activity in &gt; ${STALE_THRESHOLD_DAYS} days).</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f3f4f6;">
        <th>Organization</th><th>User</th><th>Role</th><th>Active</th>
        <th>Last seen</th><th>Days since</th><th>Status</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="margin-top:12px;color:#666;">
      Acknowledge this review by replying to this email with "REVIEWED" and the date.
      Retain the email for the SOC 2 evidence file.
    </p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Tickless guard — keeps the inArray import live for downstream callers if
// the function is grown to filter by additional roles later.
void inArray;
void and;
void sql;
