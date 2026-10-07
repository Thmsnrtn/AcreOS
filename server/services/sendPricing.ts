/**
 * What an outbound send costs the customer, in credits — ONE source.
 *
 * Before this module the per-recipient campaign prices were local literals
 * inside the send handlers of `server/routes-campaigns.ts` (`const costPerSms =
 * 3`, `const costPerMms = 5`, `const costPerEmail = 1`) and again, separately,
 * inside `GET /api/pricing/rates`. A quote assembled from either copy could
 * disagree with the charge the moment the other one changed. The handlers and
 * the rates endpoint now read these constants, and Pax's `quote_outbound_cost`
 * tool reads them through `quoteOutboundSend`, so a Pax quote is the charge.
 *
 * Units: AcreOS credits are cents of the org's credit balance (the balance is
 * stored in cents and the app renders it as dollars), so 1 credit = $0.01.
 *
 * Changing a NUMBER here is a pricing change — a founder-only hard-stop
 * (CLAUDE.md). This module only gives the numbers one home.
 */

/**
 * Per-piece direct-mail charges, in credits (cents) — what the campaign
 * direct-mail send debits (routes-campaigns `send-direct-mail`) and what its
 * estimate endpoints show. Moved here from ./directMail, which re-exports it.
 */
export const DIRECT_MAIL_COSTS = {
  postcard_4x6: 75,    // $0.75 - small postcard
  postcard_6x9: 95,    // $0.95 - standard postcard
  postcard_6x11: 115,  // $1.15 - large postcard
  letter_1_page: 125,  // $1.25 - single page letter
  letter_2_page: 145,  // $1.45 - 2 page letter
  letter_extra_page: 15, // $0.15 per additional page
} as const;

export type MailPieceType = keyof typeof DIRECT_MAIL_COSTS;

/** Per-recipient campaign charges, in credits (cents). */
export const CAMPAIGN_SEND_PRICE_CREDITS = {
  /** One campaign email (Outreach → campaign → Send email). */
  email: 1,
  /** One campaign text without media. */
  sms: 3,
  /** One campaign text with an image (carrier MMS surcharge). */
  mms: 5,
} as const;

/**
 * Credits AcreOS charges for ONE send Pax drafts in chat (`send_sms`,
 * `send_email`), after the customer taps Approve. Zero: those executors debit
 * nothing — the message goes out on the org's own connected identity and the
 * org's provider bills it. `paxSendCostIsTheCharge.test.ts` reads the executor
 * bodies, so adding a debit there without changing this number fails.
 */
export const PAX_DIRECT_SEND_PRICE_CREDITS = 0;

export type QuoteChannel = "postcard" | "letter" | "email" | "sms" | "mms";

export interface SendRails {
  /** The org's own Lob account carries mail (AcreOS charges nothing). */
  ownMailAccount: boolean;
  /** The org's own SES account carries email (AcreOS charges nothing). */
  ownEmailAccount: boolean;
  /** A verified sending domain or own SES exists — campaign email can go out at all. */
  emailCanSend: boolean;
  /** A BYO Twilio number is connected — campaign texts can go out at all. */
  smsConnected: boolean;
}

export interface OutboundQuote {
  channel: QuoteChannel;
  pieceType: string | null;
  recipients: number;
  /** Price per recipient in credits, BEFORE any own-account exemption. */
  listPriceCredits: number;
  /** What AcreOS would charge per recipient for this org right now. */
  unitCredits: number;
  totalCredits: number;
  totalDollars: string;
  /** "acreos_credits" or "your_own_account" (the provider bills you). */
  chargedTo: "acreos_credits" | "your_own_account";
  /** True when the org cannot send this channel at all yet. */
  blocked: boolean;
  /** Plain-language notes the customer needs (requirements, exemptions). */
  notes: string[];
}

export function creditsToDollars(credits: number): string {
  const abs = `$${(Math.abs(credits) / 100).toFixed(2)}`;
  return credits < 0 ? `-${abs}` : abs;
}

const MAIL_PIECES = (Object.keys(DIRECT_MAIL_COSTS) as MailPieceType[]).filter((k) => k !== "letter_extra_page");

/** The piece a mail quote prices when the caller names none. */
function defaultPiece(channel: "postcard" | "letter"): MailPieceType {
  return channel === "postcard" ? "postcard_4x6" : "letter_1_page";
}

/**
 * Pure: price `recipients` sends on `channel` for an org whose send rails are
 * `rails`. The same numbers the campaign send handlers debit.
 */
export function quoteOutboundSend(input: {
  channel: QuoteChannel;
  recipients: number;
  pieceType?: string | null;
  rails: SendRails;
}): OutboundQuote {
  const recipients = Math.max(0, Math.floor(Number(input.recipients) || 0));
  const notes: string[] = [];
  let pieceType: string | null = null;
  let listPrice: number;
  let ownAccount = false;
  let blocked = false;

  switch (input.channel) {
    case "postcard":
    case "letter": {
      const requested = input.pieceType && (MAIL_PIECES as string[]).includes(input.pieceType)
        ? (input.pieceType as MailPieceType)
        : defaultPiece(input.channel);
      if (input.pieceType && requested !== input.pieceType) {
        notes.push(`"${input.pieceType}" is not a piece type AcreOS sends; priced ${requested} instead.`);
      }
      pieceType = requested;
      listPrice = DIRECT_MAIL_COSTS[requested];
      ownAccount = input.rails.ownMailAccount;
      notes.push("Mail needs a return address (Settings → Mail) before a campaign can send.");
      break;
    }
    case "email":
      listPrice = CAMPAIGN_SEND_PRICE_CREDITS.email;
      ownAccount = input.rails.ownEmailAccount;
      if (!input.rails.emailCanSend) {
        blocked = true;
        notes.push(
          "Campaign email goes out only under your own sending identity (a verified domain or your own email account). None is connected yet, so nothing would send.",
        );
      }
      break;
    case "sms":
    case "mms":
      listPrice = input.channel === "mms" ? CAMPAIGN_SEND_PRICE_CREDITS.mms : CAMPAIGN_SEND_PRICE_CREDITS.sms;
      // Campaign texts run only on the org's own Twilio number, which is also
      // what makes them free of AcreOS credits (routes-campaigns send-sms).
      ownAccount = input.rails.smsConnected;
      if (!input.rails.smsConnected) {
        blocked = true;
        notes.push(
          "Campaign texts go out only on your own connected Twilio number. None is connected yet, so nothing would send.",
        );
      }
      notes.push("Texts reach only leads with recorded consent who are not on do-not-contact.");
      break;
    default:
      listPrice = 0;
  }

  const unit = ownAccount ? 0 : listPrice;
  if (ownAccount) {
    notes.push("This goes out on your own provider account, so AcreOS charges no credits; your provider bills you directly.");
  }
  const total = unit * recipients;
  return {
    channel: input.channel,
    pieceType,
    recipients,
    listPriceCredits: listPrice,
    unitCredits: unit,
    totalCredits: total,
    totalDollars: creditsToDollars(total),
    chargedTo: ownAccount ? "your_own_account" : "acreos_credits",
    blocked,
    notes,
  };
}

/** Read the org's send rails through the SAME resolvers the send paths ask. */
export async function readSendRails(organizationId: number): Promise<SendRails> {
  const [{ counterpartyEmailIdentityStatus }, { orgHasConnectedSmsIdentity }, { directMailService }] =
    await Promise.all([import("./emailService"), import("./smsService"), import("./directMail")]);
  const [email, sms, lob] = await Promise.all([
    counterpartyEmailIdentityStatus(organizationId).catch(() => ({ canSend: false, ownSesCredentials: false, verifiedDomain: false })),
    orgHasConnectedSmsIdentity(organizationId).catch(() => false),
    directMailService.hasOrgLobCredentials(organizationId).catch(() => false),
  ]);
  return {
    ownMailAccount: Boolean(lob),
    ownEmailAccount: email.ownSesCredentials,
    emailCanSend: email.canSend,
    smsConnected: Boolean(sms),
  };
}

/**
 * The amount + recipients line for a send Pax drafted in chat and froze as an
 * ask. Pure, so the ask card (server/services/paxAskSummary.ts) and the tool
 * artifact the model reads render the same thing. Null for tools that are not
 * a send to a person.
 */
export interface PaxSendCost {
  recipients: number;
  credits: number;
  dollars: string;
  line: string;
}

const PAX_SEND_TOOLS: Record<string, string> = {
  send_sms: "text",
  send_email: "email",
  send_gmail: "email",
};

export function paxSendCost(toolName: string, args: Record<string, unknown>): PaxSendCost | null {
  const noun = PAX_SEND_TOOLS[toolName];
  if (!noun) return null;
  const hasRecipient =
    typeof args.lead_id === "number" ||
    (typeof args.lead_id === "string" && /^\d+$/.test(args.lead_id)) ||
    ["to", "email", "phone_number", "phone"].some((k) => typeof args[k] === "string" && (args[k] as string).trim() !== "");
  const recipients = hasRecipient ? 1 : 0;
  const credits = PAX_DIRECT_SEND_PRICE_CREDITS * recipients;
  const dollars = creditsToDollars(credits);
  return {
    recipients,
    credits,
    dollars,
    line:
      `${recipients} recipient${recipients === 1 ? "" : "s"} · ${credits} AcreOS credits (${dollars}). ` +
      `The ${noun} goes out on your own connected account, which bills you directly.`,
  };
}
