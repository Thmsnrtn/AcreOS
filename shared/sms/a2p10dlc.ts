/**
 * A2P 10DLC — what an org must register with its OWN SMS provider before
 * texting US numbers from a 10-digit long code, and the rule the send
 * chokepoint applies.
 *
 * BYO, ALWAYS. The brand is the ORG's business and the campaign is the ORG's
 * messaging; both are registered on the org's own provider account. AcreOS
 * never registers on its own account for a customer and never texts a
 * counterparty from a platform number ("be the rail, not the provider").
 *
 * THE FIELDS are transcribed from Twilio's "Gather the required business
 * information" page (twilio.com/docs/messaging/compliance/a2p-10dlc/
 * collect-business-info, read 2026-10-11) and the UsAppToPerson resource
 * (twilio.com/docs/messaging/api/usapptoperson-resource). The attribute names
 * are Twilio's; other providers register with The Campaign Registry (TCR) and
 * ask for the same facts under their own labels.
 *
 * STATUS PROVENANCE. A status read from the provider's API is labelled
 * `provider_api`; one the customer typed is `self_reported` and the guide says
 * so wherever it is shown. Both can confirm a registration — a provider whose
 * API we have not built is not a reason to lock a customer out — but the label
 * never lies about which it is.
 *
 * Pure; browser-safe.
 */

export const A2P_STATUSES = ["not_started", "pending", "approved", "failed"] as const;
export type A2pStatus = (typeof A2P_STATUSES)[number];

const A2P_STATUS_SOURCES = ["provider_api", "self_reported"] as const;
export type A2pStatusSource = (typeof A2P_STATUS_SOURCES)[number];

const A2P_NUMBER_KINDS = ["10dlc", "toll_free"] as const;
export type A2pNumberKind = (typeof A2P_NUMBER_KINDS)[number];

export interface A2pField {
  /** The provider's attribute name (Twilio). */
  attribute: string;
  label: string;
  required: "yes" | "if_applicable" | "optional";
  note?: string;
}

export interface A2pStep {
  id: "business_profile" | "authorized_representative" | "brand" | "campaign";
  title: string;
  why: string;
  fields: A2pField[];
}

export const A2P_10DLC_STEPS: readonly A2pStep[] = [
  {
    id: "business_profile",
    title: "Business profile (your provider's customer profile)",
    why: "Carriers register the BUSINESS sending the texts — yours, under its legal name and tax ID.",
    fields: [
      { attribute: "business_name", label: "Legal business name (exactly as on your EIN letter)", required: "yes" },
      { attribute: "business_type", label: "Business type (sole proprietorship, partnership, corporation, LLC, co-operative, non-profit)", required: "yes" },
      { attribute: "business_industry", label: "Industry (real estate)", required: "yes" },
      { attribute: "business_registration_identifier", label: "Registration ID type (EIN for a US business)", required: "yes" },
      { attribute: "business_registration_number", label: "EIN", required: "yes" },
      { attribute: "website_url", label: "Business website", required: "yes", note: "Carriers check it matches the business; it should show your opt-in and privacy policy." },
      { attribute: "social_media_profile_urls", label: "Social profiles", required: "optional" },
      { attribute: "business_regions_of_operation", label: "Regions of operation (USA and Canada)", required: "yes" },
      { attribute: "business_identity", label: "Business identity (direct customer)", required: "yes" },
      { attribute: "street / city / region / postal_code / iso_country", label: "Business address", required: "yes" },
    ],
  },
  {
    id: "authorized_representative",
    title: "Authorized representative",
    why: "A person at the business the carriers can hold responsible.",
    fields: [
      { attribute: "first_name", label: "First name", required: "yes" },
      { attribute: "last_name", label: "Last name", required: "yes" },
      { attribute: "business_title", label: "Title", required: "yes" },
      { attribute: "job_position", label: "Job position (Director, GM, VP, CEO, CFO, General Counsel, Other)", required: "yes" },
      { attribute: "phone_number", label: "Phone", required: "yes" },
      { attribute: "email", label: "Email", required: "yes" },
    ],
  },
  {
    id: "brand",
    title: "Brand registration",
    why: "The brand is your business as The Campaign Registry knows it. Approval usually takes days, sometimes weeks.",
    fields: [
      { attribute: "company_type", label: "Company type (private, public, non-profit, government)", required: "yes" },
      { attribute: "stock_exchange", label: "Stock exchange", required: "if_applicable", note: "Public companies only." },
      { attribute: "stock_ticker", label: "Stock ticker", required: "if_applicable", note: "Public companies only." },
      { attribute: "brand_contact_email", label: "Brand contact email (receives a verification code)", required: "yes" },
      { attribute: "skip_automatic_sec_vet", label: "Skip secondary vetting", required: "optional", note: "Only for Low-Volume Standard brands." },
    ],
  },
  {
    id: "campaign",
    title: "Campaign registration",
    why: "The campaign says what you text, to whom, and how they agreed to it. It needs a Messaging Service with your 10DLC number in its sender pool.",
    fields: [
      { attribute: "us_app_to_person_usecase", label: "Use case (e.g. MIXED or MARKETING for seller outreach)", required: "yes" },
      { attribute: "description", label: "Campaign description (40–4096 characters)", required: "yes" },
      { attribute: "message_flow", label: "How people opt in (40–2048 characters) — e.g. the web form or reply that gives consent", required: "yes" },
      { attribute: "message_samples", label: "2–5 sample messages (20–1024 characters each), with opt-out language", required: "yes" },
      { attribute: "has_embedded_links", label: "Messages contain links?", required: "yes" },
      { attribute: "has_embedded_phone", label: "Messages contain phone numbers?", required: "yes" },
      { attribute: "opt_in_message / opt_in_keywords", label: "Opt-in reply and keywords", required: "if_applicable", note: "Only if people can text a keyword to opt in." },
      { attribute: "opt_out_message / opt_out_keywords", label: "Opt-out reply and keywords (STOP)", required: "if_applicable", note: "Only if you manage opt-outs yourself instead of the provider's defaults." },
      { attribute: "help_message / help_keywords", label: "Help reply and keywords (HELP)", required: "if_applicable", note: "Same rule as opt-out." },
    ],
  },
];

/** Toll-free numbers are not 10DLC: carriers require toll-free verification instead. */
const TOLL_FREE_AREA_CODES = ["800", "833", "844", "855", "866", "877", "888"] as const;

export function numberKindOf(e164: string | null | undefined): A2pNumberKind | null {
  const d = (e164 ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null;
  if (!ten) return null;
  return (TOLL_FREE_AREA_CODES as readonly string[]).includes(ten.slice(0, 3)) ? "toll_free" : "10dlc";
}

/** Twilio BrandRegistration.status → our vocabulary. Unknown → pending (never approved). */
export function normaliseTwilioBrandStatus(raw: string | null | undefined): A2pStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "FAILED":
    case "SUSPENDED":
    case "DELETED":
    case "DELETION_PENDING":
    case "DELETION_FAILED":
      return "failed";
    case "":
      return "not_started";
    default:
      return "pending"; // PENDING, IN_REVIEW, anything new
  }
}

/** Twilio UsAppToPerson.campaign_status → our vocabulary. Unknown → pending. */
export function normaliseTwilioCampaignStatus(raw: string | null | undefined): A2pStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "VERIFIED":
      return "approved";
    case "FAILED":
      return "failed";
    case "":
      return "not_started";
    default:
      return "pending"; // PENDING, IN_PROGRESS, anything new
  }
}

export interface A2pRecordView {
  numberKind: string;
  brandStatus: string;
  campaignStatus: string;
  statusSource: string;
  phoneNumber?: string | null;
}

export interface A2pVerdict {
  allowed: boolean;
  /** Why not, in words the customer can act on. */
  reason?: string;
}

/**
 * THE rule the send chokepoint applies: outbound counterparty SMS is refused
 * until the org's registration is confirmed. Confirmed means:
 *   10DLC     — brand approved AND campaign approved;
 *   toll-free — verification approved (stored as campaignStatus).
 * A record for a different number than the one sending is not confirmation.
 */
export function a2pSendVerdict(record: A2pRecordView | null | undefined, sendingNumber?: string | null): A2pVerdict {
  const where = "Settings → Integrations → Text-message registration";
  if (!record) {
    return { allowed: false, reason: `your A2P 10DLC registration isn't on file — carriers block unregistered business texts. Finish it in ${where}` };
  }
  if (sendingNumber && record.phoneNumber && digits(record.phoneNumber) !== digits(sendingNumber)) {
    return { allowed: false, reason: `your registration covers ${record.phoneNumber}, not the number this text would go from (${sendingNumber}). Update it in ${where}` };
  }
  const kind = sendingNumber ? (numberKindOf(sendingNumber) ?? record.numberKind) : record.numberKind;
  if (kind === "toll_free") {
    if (record.campaignStatus === "approved") return { allowed: true };
    return { allowed: false, reason: `toll-free verification is ${describe(record.campaignStatus)} — texts wait until it is approved (${where})` };
  }
  if (record.brandStatus !== "approved") {
    return { allowed: false, reason: `your A2P 10DLC brand is ${describe(record.brandStatus)} — texts wait until it is approved (${where})` };
  }
  if (record.campaignStatus !== "approved") {
    return { allowed: false, reason: `your A2P 10DLC campaign is ${describe(record.campaignStatus)} — texts wait until it is approved (${where})` };
  }
  return { allowed: true };
}

function digits(s: string): string {
  return s.replace(/\D/g, "").slice(-10);
}

function describe(s: string): string {
  return s === "not_started" ? "not started" : s === "failed" ? "rejected" : s;
}

export const A2P_SOURCE_LABELS: Readonly<Record<A2pStatusSource, string>> = {
  provider_api: "Read from your provider",
  self_reported: "Self-reported — you told us; AcreOS has not verified it with your provider",
};
