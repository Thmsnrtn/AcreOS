/**
 * Panel-300 #10 — disclosure-timing dispatcher cron service.
 *
 * Picks up disclosure_timing_scheduled rows where status='scheduled' AND
 * send_date ≤ now AND statutory_form is enabled. Renders the form body,
 * sends to the deal/property's primary contact, marks status='sent'.
 *
 * If the form's attorney_reviewed_at is null AND enabled=false, skips
 * the row + status='skipped' with reason="form not attorney-reviewed."
 * The cron does NOT auto-enable forms — that's a manual stamp by counsel.
 *
 * Adjacent-industries (Mariana, Heath): TILA timing violations become
 * impossible by construction. closing_date → T-3 send_date computed at
 * deal-close; cron fires the email; sent_at recorded.
 */

import { db } from "../db";
import {
  disclosureTimingScheduled,
  statutoryForms,
  deals,
  properties,
  organizations,
  users,
} from "@shared/schema";
import { and, eq, lte, sql, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface DispatchResult {
  scheduledId: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

export async function runDisclosureTimingDispatch(): Promise<{
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  results: DispatchResult[];
}> {
  const now = new Date();
  const dueRows = await db
    .select()
    .from(disclosureTimingScheduled)
    .where(and(
      eq(disclosureTimingScheduled.status, "scheduled"),
      lte(disclosureTimingScheduled.sendDate, now),
    ))
    .limit(200);

  const results: DispatchResult[] = [];

  for (const row of dueRows) {
    let result: DispatchResult;

    try {
      const [form] = await db
        .select()
        .from(statutoryForms)
        .where(eq(statutoryForms.id, row.statutoryFormId))
        .limit(1);

      if (!form) {
        result = { scheduledId: row.id, status: "failed", reason: "Statutory form row not found" };
      } else if (!form.enabled || !form.attorneyReviewedAt) {
        result = {
          scheduledId: row.id,
          status: "skipped",
          reason: `Form ${form.state}/${form.formKey} v${form.version} not attorney-reviewed (enabled=${form.enabled}, reviewed_at=${form.attorneyReviewedAt})`,
        };
        await db
          .update(disclosureTimingScheduled)
          .set({ status: "skipped", sendErrorMessage: result.reason })
          .where(eq(disclosureTimingScheduled.id, row.id));
      } else {
        // Resolve recipient: deal's primary contact OR property owner email.
        const recipientEmail = await resolveRecipientEmail(row);
        if (!recipientEmail) {
          result = {
            scheduledId: row.id,
            status: "failed",
            reason: "No recipient email resolvable from deal/property/org",
          };
          await db
            .update(disclosureTimingScheduled)
            .set({ status: "failed", sendErrorMessage: result.reason })
            .where(eq(disclosureTimingScheduled.id, row.id));
        } else {
          try {
            const { emailService } = await import("./emailService");
            await emailService.sendTransactionalEmail("notification", {
              to: recipientEmail,
              subject: `Required disclosure: ${form.state} ${form.formKey} (${form.statuteCitation ?? "statute"})`,
              templateData: {
                subject: `Required disclosure: ${form.state} ${form.formKey}`,
                title: `${form.state} ${form.formKey} disclosure`,
                message: form.body,
              },
            });
            await db
              .update(disclosureTimingScheduled)
              .set({ status: "sent", sentAt: new Date() })
              .where(eq(disclosureTimingScheduled.id, row.id));
            result = { scheduledId: row.id, status: "sent" };
          } catch (sendErr) {
            const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
            await db
              .update(disclosureTimingScheduled)
              .set({ status: "failed", sendErrorMessage: msg })
              .where(eq(disclosureTimingScheduled.id, row.id));
            result = { scheduledId: row.id, status: "failed", reason: msg };
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[disclosureTimingDispatcher] row ${row.id} failed`, err instanceof Error ? err : undefined);
      result = { scheduledId: row.id, status: "failed", reason: msg };
    }

    results.push(result);
  }

  return {
    total: results.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}

async function resolveRecipientEmail(row: typeof disclosureTimingScheduled.$inferSelect): Promise<string | null> {
  // First try the deal's contact (if dealId present).
  if (row.dealId) {
    try {
      const [d] = await db.select().from(deals).where(eq(deals.id, row.dealId)).limit(1);
      const buyerEmail = (d as any)?.buyerEmail;
      if (typeof buyerEmail === "string" && buyerEmail.includes("@")) return buyerEmail;
    } catch {/* tolerate */}
  }
  // Fall back to property owner email.
  if (row.propertyId) {
    try {
      const [p] = await db.select().from(properties).where(eq(properties.id, row.propertyId)).limit(1);
      const ownerEmail = (p as any)?.ownerEmail;
      if (typeof ownerEmail === "string" && ownerEmail.includes("@")) return ownerEmail;
    } catch {/* tolerate */}
  }
  // Last resort: org owner email.
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, row.organizationId)).limit(1);
    if (org?.ownerId) {
      const [u] = await db.select().from(users).where(eq(users.id, org.ownerId)).limit(1);
      if (u?.email) return u.email;
    }
  } catch {/* tolerate */}
  return null;
}
