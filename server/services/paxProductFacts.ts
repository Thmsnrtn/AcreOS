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
import { CAMPAIGN_SEND_PRICE_CREDITS, DIRECT_MAIL_COSTS, creditsToDollars } from "./sendPricing";

export const PRODUCT_FACT_TOPICS = ["imports", "exports", "roles", "navigation", "sending", "billing"] as const;
export type ProductFactTopic = (typeof PRODUCT_FACT_TOPICS)[number];

/** The five customer doors and the top bar (CLAUDE.md, "five fixed doors"). */
export const CUSTOMER_DOORS = [
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

export const TOP_BAR = [
  { place: "Inbox", path: "/inbox", holds: "replies from sellers by email and text" },
  { place: "Settings", path: "/settings", holds: "account, organization and team, billing, import/export, communications" },
] as const;

/** Menu paths Pax cites. Each `path` must be a real client route (pinned by test). */
export const PLACES = {
  leadsImport: { path: "/leads", steps: "Deals → Leads → Import CSV (or Import Tax List for a county tax-delinquent list), then map your columns" },
  dataImport: { path: "/import", steps: "Data Import page (/import) for large files" },
  export: { path: "/settings", steps: "Settings → Tax & Compliance → Import / Export Data → Export (one entity) or Backup (everything)" },
  inviteTeam: { path: "/settings", steps: "Settings → Organization → Invite someone, then pick the role" },
  byok: { path: "/settings/byok", steps: "Settings → Bring your own keys (/settings/byok)" },
  billing: { path: "/settings", steps: "Settings → Billing" },
  outreach: { path: "/campaigns", steps: "Deals → Outreach (/campaigns)" },
  inbox: { path: "/inbox", steps: "Inbox in the top bar" },
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
  if (want("navigation")) facts.navigation = { doors: CUSTOMER_DOORS, topBar: TOP_BAR, activity: PLACES.activity.steps };
  if (want("sending")) {
    const smsTiers = tiersAllowing("twilio");
    facts.sending = {
      texts: `Texts go out only on your own Twilio number. Connect it in ${PLACES.byok.steps} with your Account SID, Auth Token and number; that needs the ${tierList(smsTiers)}. US numbers also need A2P 10DLC registration with your carrier.`,
      textsPlanRequirement: smsTiers,
      email: "Campaign email goes out only under your own identity: a verified sending domain or your own connected email account. AcreOS does not email your leads from its own address.",
      mail: "Direct mail needs a return address (Settings → Communications).",
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
      cancel: `${PLACES.billing.steps} → Cancel subscription. Owners manage billing.`,
      beforeCancelling: `Export what you want to keep first (${PLACES.export.steps}).`,
    };
  }
  return facts;
}
