/**
 * The borrower half of the 90-day wind-down notices (founder ruling
 * 2026-09-29 #3, DEFECT-0106): once the wind-down is over, each borrower is
 * told to pay the lender directly.
 *
 * Its own file because its send lane is different from the lender notice's:
 * this is mail to the lender's COUNTERPARTY, so it goes on the counterparty
 * lane — the lender's own identity (founder decision 2026-07-17). With none
 * connected the send is refused and counted; the lender notice already told
 * them they must then tell their borrowers themselves.
 */
import { logger } from "../../utils/logger";
import { emailService } from "../emailService";

export async function sendBorrowerNotice(
  org: { id: number; name: string },
  to: string,
  firstName: string | null,
  endedAt: Date,
): Promise<boolean> {
  const lender = org.name || "your lender";
  const lines = [
    `${firstName ? `Hi ${firstName},` : "Hello,"}`,
    `${lender} no longer services your loan through AcreOS, so payments can no longer be made through the borrower portal, and any automatic payment set up there has stopped.`,
    `Please contact ${lender} to arrange how to pay them directly. Your loan terms and balance have not changed, and your payment history remains visible when you sign in to the portal.`,
  ];
  try {
    const result = await emailService.sendEmail({
      organizationId: org.id,
      purpose: "counterparty",
      transactional: true,
      to,
      subject: `How to pay ${lender} from now on`,
      html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n"),
      text: lines.join("\n\n"),
      idempotencyKey: `servicing-wind-down:borrower:${org.id}:${to}:${endedAt.toISOString()}`,
    });
    if (!result.success) {
      logger.warn("[servicingWindDown] borrower notice not sent", {
        organizationId: org.id,
        errorType: result.errorType,
        error: result.error,
      });
    }
    return result.success;
  } catch (err) {
    // An in-flight or ambiguous prior claim refuses by throwing; tomorrow's
    // pass tries again (or replays if it went out).
    logger.warn("[servicingWindDown] borrower notice refused", {
      organizationId: org.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
