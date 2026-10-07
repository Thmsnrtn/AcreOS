/**
 * Product facts Pax may cite for how-to questions — caps, roles, where things
 * live, what each send rail needs.
 *
 * WHY THIS IS NOT A DOCUMENT. An oracle pass graded Pax's how-to answers
 * "partial" for being generic ("look for the Import button") with no caps,
 * roles or prices, because Pax had no product knowledge source. A prose doc
 * with "500 rows" typed into it would fix the answer for a week and then
 * drift: the number is enforced somewhere else. So every NUMBER and every
 * permission below is read from the constant or function that ENFORCES it:
 *
 *   import rows per file  → CSV_IMPORT_MAX_ROWS_PER_FILE (the three import routes)
 *   import rows per job   → DATA_IMPORT_JOB_MAX_ROWS   (migrationJobs + route)
 *   smart-import batch    → CSV_IMPORT_MAX_ROWS_PER_REQUEST (csv-import route)
 *   exports per day       → BULK_EXPORT_DAILY_CAP      (both export limiters)
 *   role permissions      → getPermissionsForRole       (requirePermission)
 *   BYO key plan rule     → byokTierAllows              (routes-byok gate)
 *   campaign prices       → quoteOutboundSend           (campaign send handlers)
 *
 * `paxProductFacts.test.ts` mutates each source and watches the fact follow.
 * The PLACES (menu paths) are authored here; the same test pins every path to
 * a real client route and every door to the sidebar, so a moved page fails.
 *
 * Production caller: the `get_product_facts` Pax tool (server/ai/tools.ts).
 */
import {
  BULK_EXPORT_DAILY_CAP,
  CSV_IMPORT_MAX_ROWS_PER_FILE,
  DATA_IMPORT_JOB_MAX_ROWS,
} from "@shared/product-limits";
import { CSV_IMPORT_MAX_ROWS_PER_REQUEST } from "@shared/leads/csvImportMapping";
import { byokTierAllows } from "@shared/billing/byok-tiers";
import type { Tier } from "@shared/billing/tier-pricing";
import { OTHER_PLACES, PLACE_TEXT, SETTINGS_TAB_LABELS, placeDirectory } from "./paxPlaces";
import { CAMPAIGN_SEND_PRICE_CREDITS, DIRECT_MAIL_COSTS, creditsToDollars } from "./sendPricing";

type ProductFactTopic =
  | "imports"
  | "exports"
  | "roles"
  | "navigation"
  | "sending"
  | "billing"
  | "payments"
  | "sequences"
  | "cancellation";

/** The five customer doors and the top bar (CLAUDE.md, "five fixed doors"). */
const CUSTOMER_DOORS = [
  { door: "Today", path: "/today", holds: "your daily briefing, tasks and what is waiting for your tap" },
  { door: "Map", path: "/maps", holds: "the parcel map, your property inventory (/properties), listings and documents" },
  {
    door: "Deals",
    path: "/deals",
    holds:
      "the deal pipeline, Leads (/leads, including Import CSV and Import Tax List), and Outreach (/campaigns: email, SMS and direct-mail campaigns, sequences)",
  },
  { door: "Finance", path: "/money", holds: "seller-finance notes, payments, cash flow and the books" },
  { door: "Pax", path: "/ai", holds: "chat with Pax and the asks waiting for your approval" },
] as const;

const TOP_BAR = [
  { place: "Inbox", path: "/inbox", holds: "replies from sellers by email and text" },
  { place: "Settings", path: "/settings", holds: `its tabs: ${Object.values(SETTINGS_TAB_LABELS).join(", ")}` },
] as const;

/** Menu paths Pax cites. Each `path` must be a real client route (pinned by test). */
export const PLACES = {
  leadsImport: { path: "/leads", steps: "Deals → Leads → Import CSV (or Import Tax List for a county tax-delinquent list), then map your columns" },
  dataImport: { path: "/import", steps: "Data Import page (/import) for large files" },
  export: { path: "/settings", steps: `${PLACE_TEXT.importExport} → Export (one entity) or Backup (everything)` },
  inviteTeam: { path: "/settings", steps: `${PLACE_TEXT.invite}, then pick the role` },
  byok: { path: "/settings/byok", steps: `${PLACE_TEXT.byok} (/settings/byok)` },
  billing: { path: "/settings", steps: PLACE_TEXT.plans },
  outreach: { path: "/campaigns", steps: "Deals → Outreach (/campaigns)" },
  inbox: { path: "/inbox", steps: "Inbox in the top bar" },
  sequences: { path: "/campaigns", steps: OTHER_PLACES.sequences.text },
  activity: { path: "/activity", steps: "Activity (/activity) — what Pax and your team did" },
} as const;

const PAID_TIERS: Tier[] = ["starter", "pro", "scale"];

function tiersAllowing(channel: string): Tier[] {
  return PAID_TIERS.filter((t) => byokTierAllows(t, channel));
}

function tierList(tiers: Tier[]): string {
  if (tiers.length === 0) return "no plan";
  const names = tiers.map((t) => t[0].toUpperCase() + t.slice(1));
  return names.length === 1 ? `${names[0]} plan` : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]} plans`;
}

const ROLE_ORDER = ["owner", "admin", "member", "viewer", "va"] as const;

async function roleFacts() {
  const { getPermissionsForRole, getRoleLabel } = await import("../utils/permissions");
  const roles = ROLE_ORDER.map((role) => {
    const p = getPermissionsForRole(role);
    return {
      role,
      label: getRoleLabel(role),
      seesOnlyAssignedLeads: p.viewOnlyAssignedLeads,
      canImport: p.canImportData,
      canExport: p.canExportData,
      canManageTeam: p.canManageTeam,
      canManageBilling: p.canManageBilling,
      canAssignLeads: p.canAssignLeads,
      canEditLeads: p.canEditLeads,
    };
  });
  return {
    roles,
    invite: PLACES.inviteTeam.steps,
    vaNote:
      "Invite a virtual assistant with the role `va`. A va sees only the leads assigned to them (the assigned-leads-only setting is on for va by default and an owner or admin can change it per person); an owner or admin assigns leads to them.",
  };
}

/**
 * Sequences and the consent rules each step runs under. The consent column is
 * COMPUTED by asking `canSendViaChannel` (the predicate the sequence processor
 * calls per step) about a lead with no consent and about one on do-not-contact,
 * so the sentence follows the predicate.
 */
async function sequenceFacts() {
  const { canSendViaChannel } = await import("./tcpaCompliance");
  const channels = [
    ["email", "email"],
    ["sms", "text"],
    ["direct_mail", "mail"],
  ] as const;
  const noConsent = { tcpaConsent: false, doNotContact: false };
  const dnc = { tcpaConsent: true, doNotContact: true };
  const needConsent = channels.filter(([c]) => !canSendViaChannel(noConsent, c).allowed).map(([, n]) => n);
  const noConsentOk = channels.filter(([c]) => canSendViaChannel(noConsent, c).allowed).map(([, n]) => n);
  const dncBlocked = channels.filter(([c]) => !canSendViaChannel(dnc, c).allowed).map(([, n]) => n);
  const list = (xs: readonly string[]) => (xs.length === 0 ? "none" : xs.join(", "));
  return {
    where: PLACES.sequences.steps,
    whatItIs:
      "A sequence is a list of steps; each step is an email, a text or a direct-mail piece, sent some days after the previous step, with a condition (always, only if the lead has not responded, or only if it has).",
    enrolling:
      "A lead is enrolled in a sequence one at a time (the enroll action on the lead or sequence). The sequence form also offers 'when a new lead is created' and 'when a lead's stage changes' as triggers, but nothing in the product reads that setting to enroll leads automatically, and nothing starts a sequence when a postcard is sent. So a follow-up after a postcard means enrolling the leads you mailed yourself; do not promise it happens on its own.",
    consent: {
      stepsThatNeedConsentOnFile: needConsent,
      stepsAllowedWithoutConsent: noConsentOk,
      blockedForDoNotContact: dncBlocked,
      rule: `Every step re-checks the lead at send time. Without recorded consent the ${list(needConsent)} steps are skipped (${list(noConsentOk)} still goes); a do-not-contact lead gets none (${list(dncBlocked)} blocked). A text step also waits out the recipient's quiet hours, and a lead who touches too often is deferred by the contact-frequency cap.`,
    },
    ownRails: "Email and text steps go out only on your own connected email identity and your own Twilio number; if one is not connected the step does not send (get_sending_identity_status shows which).",
    pausedPax: "If you paused Pax, steps wait and resume when the pause lifts.",
  };
}

async function paymentFacts() {
  return {
    sellerFinanceNote: `${PLACE_TEXT.recordPayment}. Enter the payment in the form it opens; the note's balance, next due date and late-fee state are updated from the payment, not typed by hand.`,
    boughtNote: OTHER_PLACES.acquiredNotePayment.text,
    whoCan: "Owners and admins only; members and viewers do not see the button.",
    onlyOnce:
      "Each recording carries an idempotency key, so a retry after a slow or dropped connection returns the payment already recorded instead of posting it twice; the same key reused for a different payment is refused.",
    outsideAcreos:
      "This records money you received outside AcreOS (a check, cash, a wire). AcreOS does not move that money; it never holds your borrower's payment.",
    check: "get_notes shows the note's current balance and next payment date after you record it.",
  };
}

async function cancellationFacts() {
  const { WIND_DOWN_DAYS } = await import("./borrower/servicingPhase");
  return {
    where: `${PLACE_TEXT.cancel} (beside Manage subscription).`,
    whoCan: "Owners manage billing.",
    whatHappensToPlan: "The subscription ends and the account moves to the Free plan; get_plan_limits shows what Free allows.",
    whatHappensToData:
      "Cancelling does not delete your records: the cancellation email says your data is preserved and that re-subscribing picks up where you left off. Export what you want to keep first.",
    noRetentionPeriod:
      "No setting or job in the product states how long a cancelled account's data is kept, so there is no number to quote; do not give one. Permanent deletion of an account's data is a separate request that only the AcreOS team can carry out (escalate_to_support).",
    borrowerNotes: `If you service seller-finance notes through AcreOS, your borrowers' autopay, portal and statements keep running for ${WIND_DOWN_DAYS} days after the subscription ends, then new debits stop and borrowers are told to pay you directly. Export your book or move servicing before then.`,
    exportFirst: PLACES.export.steps,
  };
}

export async function getPaxProductFacts(topic?: string | null): Promise<Record<string, unknown>> {
  const want = (t: ProductFactTopic) => !topic || topic === "all" || topic === t;
  const facts: Record<string, unknown> = {
    source: "AcreOS product facts — read from the constants the product enforces",
    creditUnit: "1 AcreOS credit = $0.01 of your credit balance",
  };

  if (want("imports")) {
    facts.imports = {
      where: PLACES.leadsImport.steps,
      rowsPerFile: CSV_IMPORT_MAX_ROWS_PER_FILE,
      rule: `One CSV import from the Leads page (Import CSV or Import Tax List) takes at most ${CSV_IMPORT_MAX_ROWS_PER_FILE} rows; split a bigger list into files of ${CSV_IMPORT_MAX_ROWS_PER_FILE} or fewer.`,
      largeFiles: `${PLACES.dataImport.steps} takes up to ${DATA_IMPORT_JOB_MAX_ROWS.toLocaleString("en-US")} rows as a background job.`,
      smartImportBatchRows: CSV_IMPORT_MAX_ROWS_PER_REQUEST,
      planLimit: "Imported leads count against your plan's lead limit (get_plan_limits).",
    };
  }
  if (want("exports")) {
    facts.exports = {
      where: PLACES.export.steps,
      perPersonPerDay: BULK_EXPORT_DAILY_CAP,
      rule: `Bulk exports are capped at ${BULK_EXPORT_DAILY_CAP} per person per day; support can lift it for a one-off.`,
      whoCan: "Owners and admins (the export permission).",
    };
  }
  if (want("roles")) facts.team = await roleFacts();
  if (want("navigation")) {
    const dir = placeDirectory();
    facts.navigation = {
      doors: CUSTOMER_DOORS,
      topBar: TOP_BAR,
      activity: PLACES.activity.steps,
      settingsTabs: Object.values(dir.settingsTabs),
      financeTabs: Object.values(dir.financeTabs),
      settingsPlaces: Object.fromEntries(Object.entries(dir.sections).map(([k, v]) => [k, v.place])),
    };
  }
  if (want("sending")) {
    const smsTiers = tiersAllowing("twilio");
    facts.sending = {
      texts: `Texts go out only on your own Twilio number. Connect it in ${PLACES.byok.steps} with your Account SID, Auth Token and number; that needs the ${tierList(smsTiers)}. US numbers also need A2P 10DLC registration with your carrier.`,
      textsPlanRequirement: smsTiers,
      email: "Campaign email goes out only under your own identity: a verified sending domain or your own connected email account. AcreOS does not email your leads from its own address.",
      mail: `Direct mail needs a return address (${PLACE_TEXT.returnAddress}).`,
      consent: "Texts reach only leads with recorded consent who are not on do-not-contact; quiet hours are 8am–9pm in the lead's time zone.",
      pricesPerRecipientCredits: {
        email: CAMPAIGN_SEND_PRICE_CREDITS.email,
        sms: CAMPAIGN_SEND_PRICE_CREDITS.sms,
        mms: CAMPAIGN_SEND_PRICE_CREDITS.mms,
        postcard_4x6: DIRECT_MAIL_COSTS.postcard_4x6,
        postcard_6x9: DIRECT_MAIL_COSTS.postcard_6x9,
        postcard_6x11: DIRECT_MAIL_COSTS.postcard_6x11,
        letter_1_page: DIRECT_MAIL_COSTS.letter_1_page,
      },
      pricesInDollars: {
        postcard_4x6: creditsToDollars(DIRECT_MAIL_COSTS.postcard_4x6),
        sms: creditsToDollars(CAMPAIGN_SEND_PRICE_CREDITS.sms),
        email: creditsToDollars(CAMPAIGN_SEND_PRICE_CREDITS.email),
      },
      ownAccountRule: "A send that goes out on your own provider account (your Lob, your email account, your Twilio) costs no AcreOS credits; that provider bills you.",
      where: PLACES.outreach.steps,
    };
  }
  if (want("billing")) {
    facts.billing = {
      cancel: `${PLACE_TEXT.cancel} (beside Manage subscription). Owners manage billing.`,
      beforeCancelling: `Export what you want to keep first (${PLACES.export.steps}).`,
      plans: PLACES.billing.steps,
      moreOnCancelling: "topic cancellation",
    };
  }
  if (want("payments")) facts.payments = await paymentFacts();
  if (want("sequences")) facts.sequences = await sequenceFacts();
  if (want("cancellation")) facts.cancellation = await cancellationFacts();
  return facts;
}
