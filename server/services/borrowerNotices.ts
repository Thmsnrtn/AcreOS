/**
 * Borrower notice + letter templates (Wave C, agent C2).
 *
 * ⚠️ NAMING: this file is about BORROWER dunning — a borrower who is late on a
 * seller-financed note the AcreOS customer holds. It has nothing to do with
 * `server/services/dunning.ts` (founder-only SUBSCRIPTION dunning, i.e. an
 * AcreOS customer's own card failed). Do not merge the two.
 *
 * What this module owns:
 *   1. The DETERMINISTIC content for every rung of the borrower reminder
 *      ladder — subject line, email HTML, plain text, and a printable letter
 *      document. No LLM call, no network, no DB: pure functions over values
 *      the caller already read from the note. That makes the notices testable
 *      and makes it impossible for a model outage to turn a regulated
 *      collection notice into an empty string.
 *   2. The FDCPA mini-Miranda gate. Once a note crosses
 *      `MINI_MIRANDA_DAYS_LATE` days delinquent the notice stops being a
 *      friendly nudge and becomes "an attempt to collect a debt". From that
 *      rung onward the disclosure is injected automatically and cannot be
 *      switched off by a caller. (Raised repeatedly in the servicing reviews:
 *      docs/archive/.../octavia-hard-money.md §6.3.)
 *
 * Honesty rules baked in:
 *   - Every number rendered comes from the note row. When a value is missing
 *     we say so in words ("your next scheduled payment") rather than printing
 *     a zero or inventing a date.
 *   - The letter path returns a DOCUMENT, not a delivery. Physical mail for
 *     borrower notices is not wired (see `PHYSICAL_MAIL_STATUS`), so the
 *     caller must surface the artifact for download/print and must never
 *     record it as mailed.
 */

export type BorrowerNoticeStage =
  | "upcoming"
  | "due"
  | "late"
  | "final_warning"
  | "demand_letter";

/** Days delinquent at which the FDCPA mini-Miranda disclosure becomes mandatory. */
export const MINI_MIRANDA_DAYS_LATE = 30;

/**
 * The mini-Miranda. Verbatim statutory phrasing — do NOT paraphrase, and do
 * not append advice about enforcement strategy (that is the operator's
 * counsel's call, not ours).
 */
export const MINI_MIRANDA_TEXT =
  "This is an attempt to collect a debt. Any information obtained will be used for that purpose.";

/**
 * Physical-mail truth for borrower notices, in one place so no UI or route can
 * drift from it. `wired: false` means: generate the document, let the operator
 * download/print/mail it, and never claim AcreOS mailed anything.
 */
export const PHYSICAL_MAIL_STATUS = {
  wired: false,
  reason:
    "Physical mail delivery for borrower notices is not connected. AcreOS generated the notice document — download and mail it yourself, or record the mailing once you have.",
} as const;

export interface BorrowerNoticeInput {
  /** Borrower's display name; null/blank falls back to a neutral salutation. */
  borrowerName?: string | null;
  /** Monthly payment amount as stored on the note (numeric string or number). */
  amountDue?: string | number | null;
  /** Outstanding principal as stored on the note. */
  currentBalance?: string | number | null;
  /** The due date of the period this notice is about. */
  dueDate?: Date | null;
  /** Whole days past `dueDate`. 0 or negative means not yet late. */
  daysLate: number;
  /** The lender/servicer name shown as the sender. Blank falls back to neutral. */
  lenderName?: string | null;
  /** Optional borrower payment portal URL. Omitted entirely when absent. */
  portalUrl?: string | null;
  /** Optional note reference shown in the letter header. */
  noteReference?: string | null;
}

export interface BorrowerNotice {
  stage: BorrowerNoticeStage;
  subject: string;
  /** Plain-text body — this is what the SMS/queue/preview surfaces render. */
  text: string;
  /** HTML body for the email rail. */
  html: string;
  /** True when the FDCPA disclosure was injected into this notice. */
  miniMirandaIncluded: boolean;
}

export interface BorrowerLetterDocument extends BorrowerNotice {
  /** Full printable letter body (plain text, letter layout). */
  letterText: string;
  /** Suggested filename for the downloadable artifact. */
  filename: string;
  /**
   * Delivery truth. `delivered` is ALWAYS false here — this module produces a
   * document; it does not hand it to a mail carrier.
   */
  delivery: {
    delivered: false;
    channel: "document";
    reason: string;
  };
}

/** True once the notice must carry the FDCPA disclosure. */
export function requiresMiniMiranda(stage: BorrowerNoticeStage, daysLate: number): boolean {
  if (stage === "demand_letter") return true;
  return daysLate >= MINI_MIRANDA_DAYS_LATE;
}

function money(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

function longDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  const t = value.getTime();
  if (!Number.isFinite(t)) return null;
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function salutation(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? `Dear ${trimmed},` : "Dear Borrower,";
}

function senderLine(lenderName: string | null | undefined): string {
  const trimmed = (lenderName ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Your note servicer";
}

/**
 * The amount phrase. Falls back to words, never to "$0.00" — a fabricated
 * zero on a collection notice is both a lie and a compliance problem.
 */
function amountPhrase(input: BorrowerNoticeInput): string {
  const amount = money(input.amountDue);
  return amount ? `your payment of ${amount}` : "your scheduled payment";
}

function duePhrase(input: BorrowerNoticeInput): string {
  const date = longDate(input.dueDate);
  return date ? `due ${date}` : "now due";
}

function balanceLine(input: BorrowerNoticeInput): string | null {
  const balance = money(input.currentBalance);
  return balance ? `Outstanding principal balance: ${balance}.` : null;
}

function portalLine(input: BorrowerNoticeInput): string | null {
  const url = (input.portalUrl ?? "").trim();
  return url.length > 0 ? `Make a payment: ${url}` : null;
}

const STAGE_SUBJECTS: Record<BorrowerNoticeStage, string> = {
  upcoming: "Payment reminder — coming due",
  due: "Payment due today",
  late: "Past due notice",
  final_warning: "FINAL NOTICE — your account is seriously past due",
  demand_letter: "NOTICE OF DEFAULT AND DEMAND FOR PAYMENT",
};

function stageBody(input: BorrowerNoticeInput): string[] {
  const amount = amountPhrase(input);
  const due = duePhrase(input);
  const balance = balanceLine(input);
  const portal = portalLine(input);
  const lines: string[] = [];

  switch (stageOf(input)) {
    case "upcoming":
      lines.push(`This is a courtesy reminder that ${amount} is ${due}.`);
      lines.push("No action is needed if your payment is already scheduled.");
      break;
    case "due":
      lines.push(`${capitalize(amount)} is ${due}.`);
      lines.push("Please submit your payment today to keep the account current.");
      break;
    case "late":
      lines.push(
        `${capitalize(amount)} was ${due} and has not been received. Your account is ${input.daysLate} day(s) past due.`,
      );
      lines.push(
        "Please submit payment as soon as possible. If you are having difficulty paying, contact us — payment arrangements are often possible.",
      );
      break;
    case "final_warning":
      lines.push(
        `${capitalize(amount)} was ${due} and remains unpaid. Your account is now ${input.daysLate} day(s) past due.`,
      );
      lines.push(
        "This is a final notice before your account is escalated for further action. Please contact us immediately to resolve the delinquency or discuss options.",
      );
      break;
    case "demand_letter":
      lines.push(
        `Your account is ${input.daysLate} day(s) past due. ${capitalize(amount)}, ${due}, has not been received.`,
      );
      lines.push(
        "Payment in full of the past-due amount is demanded. If the delinquency is not cured, the note holder may pursue the remedies available under your note and applicable state law.",
      );
      lines.push(
        "Required notice content, cure periods and enforcement timelines are set by the law of the state where the property sits. Contact us to discuss the amount required to cure.",
      );
      break;
  }

  if (balance) lines.push(balance);
  if (portal) lines.push(portal);
  return lines;
}

function stageOf(input: BorrowerNoticeInput & { stage?: BorrowerNoticeStage }): BorrowerNoticeStage {
  return input.stage ?? "due";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * Build the email/SMS-ready notice for one rung of the ladder.
 *
 * Deterministic: same input ⇒ byte-identical output. No LLM, no I/O.
 */
export function buildBorrowerNotice(
  stage: BorrowerNoticeStage,
  input: BorrowerNoticeInput,
): BorrowerNotice {
  const withStage = { ...input, stage };
  const miniMiranda = requiresMiniMiranda(stage, input.daysLate);
  const paragraphs = stageBody(withStage);
  const sender = senderLine(input.lenderName);

  const textParts = [salutation(input.borrowerName), "", ...paragraphs.map((p) => p)];
  if (miniMiranda) {
    textParts.push("", MINI_MIRANDA_TEXT);
  }
  textParts.push("", sender);

  const htmlParagraphs = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  const htmlMiniMiranda = miniMiranda
    ? `\n<p style="font-weight:600;">${escapeHtml(MINI_MIRANDA_TEXT)}</p>`
    : "";

  return {
    stage,
    subject: STAGE_SUBJECTS[stage],
    text: textParts.join("\n"),
    html:
      `<p>${escapeHtml(salutation(input.borrowerName))}</p>\n` +
      htmlParagraphs +
      htmlMiniMiranda +
      `\n<p>${escapeHtml(sender)}</p>`,
    miniMirandaIncluded: miniMiranda,
  };
}

/**
 * Build the printable letter artifact for a stage.
 *
 * Returns a DOCUMENT. `delivery.delivered` is hard-coded false because
 * physical mail for borrower notices is not connected — see
 * PHYSICAL_MAIL_STATUS. Callers must surface it as downloadable and must not
 * write a "sent"/"mailed" status off the back of this call.
 */
export function buildBorrowerLetter(
  stage: BorrowerNoticeStage,
  input: BorrowerNoticeInput,
): BorrowerLetterDocument {
  const notice = buildBorrowerNotice(stage, input);
  const today = longDate(new Date()) ?? "";
  const header: string[] = [today, ""];
  const reference = (input.noteReference ?? "").trim();
  if (reference.length > 0) header.push(`Re: ${reference}`, "");

  const letterText = [...header, notice.text].join("\n");

  return {
    ...notice,
    letterText,
    filename: `${stage}-notice${reference ? `-${slug(reference)}` : ""}.txt`,
    delivery: {
      delivered: false,
      channel: "document",
      reason: PHYSICAL_MAIL_STATUS.reason,
    },
  };
}

/**
 * Short SMS variant. Kept under one segment where possible, and it still
 * carries the mini-Miranda once the account crosses the threshold — the
 * disclosure is not optional just because the channel is small. The STOP
 * line is included because the SMS rail does not append one.
 */
export function buildBorrowerSmsText(
  stage: BorrowerNoticeStage,
  input: BorrowerNoticeInput,
): { text: string; miniMirandaIncluded: boolean } {
  const amount = money(input.amountDue);
  const sender = senderLine(input.lenderName);
  const miniMiranda = requiresMiniMiranda(stage, input.daysLate);

  let core: string;
  switch (stage) {
    case "upcoming":
      core = amount
        ? `${sender}: reminder, your ${amount} payment is coming due.`
        : `${sender}: reminder, your next payment is coming due.`;
      break;
    case "due":
      core = amount
        ? `${sender}: your ${amount} payment is due today.`
        : `${sender}: your payment is due today.`;
      break;
    case "late":
      core = `${sender}: your payment is ${input.daysLate} day(s) past due. Please contact us.`;
      break;
    case "final_warning":
      core = `${sender}: FINAL NOTICE — your account is ${input.daysLate} day(s) past due. Please contact us immediately.`;
      break;
    case "demand_letter":
      core = `${sender}: your account is ${input.daysLate} day(s) past due and in default. Please contact us about curing the delinquency.`;
      break;
  }

  const parts = [core];
  if (miniMiranda) parts.push(MINI_MIRANDA_TEXT);
  parts.push("Reply STOP to opt out.");
  return { text: parts.join(" "), miniMirandaIncluded: miniMiranda };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
