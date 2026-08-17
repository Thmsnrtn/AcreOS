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
        // Resolve recipient: deal's primary contact OR property owner email,
        // falling back to the org's own owner. The resolved SOURCE decides the
        // send lane — see resolveRecipientEmail.
        const recipient = await resolveRecipientEmail(row);
        if (!recipient) {
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
            const sendResult = await emailService.sendTransactionalEmail("notification", {
              // The scheduled row carries the org this disclosure belongs to;
              // it scopes the org's own sending identity.
              organizationId: row.organizationId,
              // Lane per founder decision 2026-07-17, decided by WHO resolved
              // (not by what the mail is about): a deal buyer or a property
              // owner is the customer's counterparty and needs the customer's
              // own identity; the org-owner fallback is mail to an AcreOS user
              // and stays on the platform lane. resolveRecipientEmail returns
              // the lane with the address so the two cannot drift apart.
              purpose: recipient.lane,
              to: recipient.email,
              subject: `Required disclosure: ${form.state} ${form.formKey} (${form.statuteCitation ?? "statute"})`,
              templateData: {
                subject: `Required disclosure: ${form.state} ${form.formKey}`,
                title: `${form.state} ${form.formKey} disclosure`,
                message: form.body,
              },
            });
            // sendTransactionalEmail RETURNS failures (refused counterparty
            // lane, SES error) instead of throwing, so the catch below never
            // sees them. Without this check a refused statutory disclosure
            // would be recorded — and reported to counsel — as delivered.
            if (!sendResult.success) {
              const reason = sendResult.error || "Email send failed";
              await db
                .update(disclosureTimingScheduled)
                .set({ status: "failed", sendErrorMessage: reason })
                .where(eq(disclosureTimingScheduled.id, row.id));
              logger.warn(
                `[disclosureTimingDispatcher] row ${row.id} not delivered (${sendResult.errorType ?? "send_failed"})`,
                { metadata: { organizationId: row.organizationId, recipientSource: recipient.source } },
              );
              result = { scheduledId: row.id, status: "failed", reason };
            } else {
              await db
                .update(disclosureTimingScheduled)
                .set({ status: "sent", sentAt: new Date() })
                .where(eq(disclosureTimingScheduled.id, row.id));
              result = { scheduledId: row.id, status: "sent" };
            }
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

/**
 * A resolved disclosure recipient, carrying the lane its SOURCE implies.
 *
 * The two lanes are not a property of the message (a statutory disclosure is
 * "deal mail" either way) — they are a property of WHO receives it. Returning
 * them together is what stops a later edit from adding a fourth source and
 * inheriting whichever lane happened to be hardcoded at the call site.
 */
type ResolvedRecipient = {
  email: string;
  source: "deal_buyer" | "property_owner" | "org_owner";
  lane: "system" | "counterparty";
};

async function resolveRecipientEmail(
  row: typeof disclosureTimingScheduled.$inferSelect,
): Promise<ResolvedRecipient | null> {
  // First try the deal's contact (if dealId present).
  //
  // NOTE (2026-08-16): `deals` has no buyer_email column in shared/schema.ts —
  // hence the untyped cast below. This branch therefore cannot resolve today;
  // it is kept (and labelled) so that adding the column does not silently put
  // buyer mail on the platform sender. Same for the property branch below:
  // there is no owner_email column anywhere in the schema.
  if (row.dealId) {
    try {
      const [d] = await db.select().from(deals).where(eq(deals.id, row.dealId)).limit(1);
      const buyerEmail = (d as any)?.buyerEmail;
      if (typeof buyerEmail === "string" && buyerEmail.includes("@")) {
        // The deal's buyer is the customer's counterparty — their mail rides
        // the customer's own connected identity or it does not go at all.
        return { email: buyerEmail, source: "deal_buyer", lane: "counterparty" };
      }
    } catch {/* tolerate */}
  }
  // Fall back to property owner email.
  if (row.propertyId) {
    try {
      const [p] = await db.select().from(properties).where(eq(properties.id, row.propertyId)).limit(1);
      const ownerEmail = (p as any)?.ownerEmail;
      if (typeof ownerEmail === "string" && ownerEmail.includes("@")) {
        // The parcel's owner is the seller the customer is dealing with —
        // counterparty, same rule.
        return { email: ownerEmail, source: "property_owner", lane: "counterparty" };
      }
    } catch {/* tolerate */}
  }
  // Last resort: org owner email.
  //
  // This recipient is organizations.ownerId → users.email: an AcreOS user, the
  // customer themselves. Mail to our own users is exactly what the platform
  // sender is FOR, so this branch is deliberately labelled "system" rather than
  // left to the interface's silent default.
  //
  // Read the delivery claim carefully, though: a disclosure that reaches only
  // the org owner has NOT reached the buyer or seller the statute names, yet
  // the row above still records status "sent". That mis-recording predates this
  // change and is called out in the wave notes — it is a delivery-truth bug,
  // not a lane bug, and fixing it means deciding what a disclosure with no
  // counterparty address should do.
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, row.organizationId)).limit(1);
    if (org?.ownerId) {
      const [u] = await db.select().from(users).where(eq(users.id, org.ownerId)).limit(1);
      if (u?.email) return { email: u.email, source: "org_owner", lane: "system" };
    }
  } catch {/* tolerate */}
  return null;
}
