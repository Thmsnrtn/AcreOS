/**
 * Wholesale §6.2 — seller-side follow-up DRAFTS on the deal record.
 *
 * A draft is the operator's OWN follow-up template (offer_templates, type
 * `follow_up`, written on the Offers page) with a fixed set of record facts
 * merged in. It is stored as one `generated_documents` row of type
 * SELLER_FOLLOW_UP_DRAFT_TYPE, status "draft", sealed with the sha256 of what
 * the operator saw — and that is all it ever is.
 *
 * PREPARED, NOT SENT. Nothing here sends, queues, schedules or records a
 * communication. The draft has no recipient and no channel; the operator
 * copies it out to their own consented surface. It is not a signable document
 * either: the doc-system signing routes and the edit route refuse this type.
 *
 * CREATED, NEVER EDITED (§7.6). A correction is a NEW draft that cites the old
 * one (`variables.supersedes`). The stored content is never rewritten — when a
 * cited fact moves, the list flags the draft stale and names what moved.
 *
 * NOTHING IS INVENTED (§7.2/§7.3). The body is the template with tokens
 * substituted, character for character: no platform sentence, disclaimer,
 * call to action or date is added. Only these tokens merge, each from the
 * deal's own record:
 *   {{owner_name}}    leads.firstName + " " + leads.lastName (properties.sellerId)
 *   {{address}}       properties.address, city, state (county fallback)
 *   {{offer_amount}}  deals.offerAmount — ONLY that field; refused if empty
 *   {{company_name}}  organizations.name
 * {{expiration_date}} always refuses (the record carries no expiration), and
 * any other {{token}} refuses by name. A refusal writes nothing.
 */
import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { deals, generatedDocuments, leads, organizations, properties } from "@shared/schema";
import { storage } from "../../storage";
import { leadHasOptedOut } from "../leadContactability";
import { sealReviewedContent } from "../contracts/contractAssembly";
import { DispositionRefusal } from "./disposition";

/** The generated_documents.type of a seller follow-up draft. The doc-system guards import it. */
export const SELLER_FOLLOW_UP_DRAFT_TYPE = "seller_follow_up_draft";

/** A refusal the route renders by status (404 / 422). Writes nothing. */
class SellerFollowUpRefusal extends DispositionRefusal {
  constructor(message: string, status: 404 | 422) {
    super(message, status);
  }
}

type FactToken = "owner_name" | "address" | "offer_amount" | "company_name";

const FACT_TOKENS: readonly FactToken[] = ["owner_name", "address", "offer_amount", "company_name"];

/** Where each token is read from — returned with every preview and draft as its provenance. */
const FACT_SOURCE: Record<FactToken, string> = {
  owner_name: "Seller lead's first and last name (the property's linked seller)",
  address: "Property address on the record",
  offer_amount: "Offer amount on the deal",
  company_name: "Your organization's name",
};

const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The deal's own facts, read now, org-pinned. Values are null when absent from the record. */
interface RecordFacts {
  dealId: number;
  propertyId: number;
  seller: { id: number; doNotContact: boolean | null; optOutDate: Date | null } | null;
  values: Record<FactToken, string | null>;
}

/** Dollars-as-numeric (deals.offer_amount) rendered as the operator entered it, or null. */
function renderOfferAmount(v: string | null): string | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const whole = Number.isInteger(n);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

async function readRecordFacts(organizationId: number, dealId: number): Promise<RecordFacts> {
  const [deal] = await db
    .select({ id: deals.id, propertyId: deals.propertyId, offerAmount: deals.offerAmount })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, organizationId), eq(deals.type, "acquisition"), isNull(deals.deletedAt)))
    .limit(1);
  if (!deal) throw new SellerFollowUpRefusal("Deal", 404);

  const [property] = await db
    .select({ id: properties.id, address: properties.address, city: properties.city, county: properties.county, state: properties.state, sellerId: properties.sellerId })
    .from(properties)
    .where(and(eq(properties.id, deal.propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  if (!property) throw new SellerFollowUpRefusal("Property", 404);

  const [seller] = property.sellerId
    ? await db
        .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, doNotContact: leads.doNotContact, optOutDate: leads.optOutDate })
        .from(leads)
        .where(and(eq(leads.id, property.sellerId), eq(leads.organizationId, organizationId)))
        .limit(1)
    : [];

  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);

  // The disposition packet's address rule, without its invented fallback: a
  // property with neither street nor county yields no address fact.
  const address =
    [property.address, property.city, property.state].filter(Boolean).join(", ") ||
    [property.county && `${property.county} County`, property.state].filter(Boolean).join(", ") ||
    null;

  return {
    dealId: deal.id,
    propertyId: property.id,
    seller: seller ? { id: seller.id, doNotContact: seller.doNotContact, optOutDate: seller.optOutDate } : null,
    values: {
      owner_name: seller ? `${seller.firstName} ${seller.lastName}`.trim() || null : null,
      address,
      offer_amount: renderOfferAmount(deal.offerAmount),
      company_name: org?.name?.trim() ? org.name : null,
    },
  };
}

/** Refuses a draft that would be addressed to no seller, or to a seller who opted out. */
function requireDraftableSeller(facts: RecordFacts): { id: number } {
  if (!facts.seller) {
    throw new SellerFollowUpRefusal("This property has no linked seller. Link the seller to this property first — a follow-up draft is addressed to the property's seller lead.", 422);
  }
  if (leadHasOptedOut(facts.seller)) {
    throw new SellerFollowUpRefusal("The seller on this property has opted out of contact (do-not-contact or an opt-out date is on their lead). No follow-up is drafted for a seller who refused contact.", 422);
  }
  return { id: facts.seller.id };
}

/** Every {{token}} in subject + body, refused unless each is a known, present record fact. */
function citedTokens(texts: string[], facts: RecordFacts): FactToken[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(TOKEN_RE)) seen.add(m[1]);
  if (seen.has("expiration_date")) {
    throw new SellerFollowUpRefusal("The template uses {{expiration_date}}, and this deal's record carries no expiration date. Remove that token from the template — a date is never filled in for you.", 422);
  }
  const unknown = Array.from(seen).filter((t) => !(FACT_TOKENS as readonly string[]).includes(t));
  if (unknown.length > 0) {
    throw new SellerFollowUpRefusal(`The template uses ${unknown.map((t) => `{{${t}}}`).join(", ")}, which no record fact fills. Only {{owner_name}}, {{address}}, {{offer_amount}} and {{company_name}} merge.`, 422);
  }
  const cited = FACT_TOKENS.filter((t) => seen.has(t));
  for (const t of cited) {
    if (facts.values[t] !== null) continue;
    if (t === "offer_amount") throw new SellerFollowUpRefusal("The template uses {{offer_amount}}, and this deal has no offer amount recorded. Enter the offer amount on the deal first — no other figure is substituted.", 422);
    if (t === "address") throw new SellerFollowUpRefusal("The template uses {{address}}, and this property has no address or county on its record.", 422);
    if (t === "company_name") throw new SellerFollowUpRefusal("The template uses {{company_name}}, and your organization has no name set.", 422);
    throw new SellerFollowUpRefusal(`The template uses {{${t}}}, and the record has no value for it.`, 422);
  }
  return cited;
}

/** Pure substitution: the text with each cited token replaced, nothing else changed. */
function substitute(text: string, values: Record<FactToken, string | null>): string {
  return text.replace(TOKEN_RE, (_whole, token: string) => values[token as FactToken] ?? "");
}

async function composeDraft(organizationId: number, dealId: number, offerTemplateId: number) {
  const facts = await readRecordFacts(organizationId, dealId);
  const seller = requireDraftableSeller(facts);

  const template = await storage.getOfferTemplate(organizationId, offerTemplateId);
  if (!template || template.type !== "follow_up") throw new SellerFollowUpRefusal("Follow-up template", 404);

  const templateSubject = template.subject ?? "";
  const cited = citedTokens([templateSubject, template.content], facts);
  const subject = substitute(templateSubject, facts.values);
  const body = substitute(template.content, facts.values);

  return {
    dealId: facts.dealId,
    propertyId: facts.propertyId,
    leadId: seller.id,
    offerTemplateId: template.id,
    offerTemplateName: template.name,
    subject,
    body,
    facts: cited.map((token) => ({ token, value: facts.values[token] as string, source: FACT_SOURCE[token] })),
    values: facts.values,
  };
}

/** The merged draft for review. Writes nothing, sends nothing. */
export async function previewSellerFollowUp(organizationId: number, dealId: number, offerTemplateId: number, now: Date) {
  const d = await composeDraft(organizationId, dealId, offerTemplateId);
  return {
    dealId: d.dealId,
    propertyId: d.propertyId,
    leadId: d.leadId,
    offerTemplateId: d.offerTemplateId,
    offerTemplateName: d.offerTemplateName,
    subject: d.subject,
    body: d.body,
    facts: d.facts,
    factsAsOf: now.toISOString(),
  };
}

/** Writes exactly one generated_documents row (status "draft"). Sends nothing. */
export async function createSellerFollowUp(
  organizationId: number,
  userId: string,
  dealId: number,
  input: { offerTemplateId: number; supersedes?: number },
  now: Date,
) {
  const d = await composeDraft(organizationId, dealId, input.offerTemplateId);

  if (input.supersedes !== undefined) {
    const prior = await storage.getGeneratedDocument(organizationId, input.supersedes);
    if (!prior || prior.dealId !== d.dealId || prior.type !== SELLER_FOLLOW_UP_DRAFT_TYPE) {
      throw new SellerFollowUpRefusal("The draft this supersedes must be an existing seller follow-up draft on this deal.", 422);
    }
  }

  const factsAsOf = now.toISOString();
  const variables: Record<string, string> = {
    kind: "seller_follow_up",
    subject: d.subject,
    offerTemplateId: String(d.offerTemplateId),
    offerTemplateName: d.offerTemplateName,
    factsAsOf,
    citedFacts: d.facts.map((f) => f.token).join(","),
    fact_owner_name: d.values.owner_name ?? "",
    fact_address: d.values.address ?? "",
    fact_company_name: d.values.company_name ?? "",
    ...(d.values.offer_amount !== null && d.facts.some((f) => f.token === "offer_amount") ? { fact_offer_amount: d.values.offer_amount } : {}),
    ...(input.supersedes !== undefined ? { supersedes: String(input.supersedes) } : {}),
  };
  const hash = crypto.createHash("sha256").update(`${d.subject}\n${d.body}`, "utf8").digest("hex");

  const row = await storage.createGeneratedDocument({
    organizationId,
    templateId: null,
    dealId: d.dealId,
    propertyId: d.propertyId,
    leadId: d.leadId,
    // A template with no subject line is named by the operator's own template name.
    name: d.subject.trim() !== "" ? d.subject : d.offerTemplateName,
    type: SELLER_FOLLOW_UP_DRAFT_TYPE,
    content: d.body,
    variables: sealReviewedContent(variables, { hash, userId, at: now }),
    status: "draft",
    generatedBy: userId,
  });

  return {
    id: row.id,
    dealId: d.dealId,
    propertyId: d.propertyId,
    leadId: d.leadId,
    offerTemplateId: d.offerTemplateId,
    offerTemplateName: d.offerTemplateName,
    subject: d.subject,
    body: d.body,
    facts: d.facts,
    factsAsOf,
    supersedes: input.supersedes ?? null,
    status: row.status,
    createdAt: row.createdAt,
  };
}

/** This deal's drafts, newest first, each re-checked against the record now. Reads only. */
export async function listSellerFollowUps(organizationId: number, dealId: number) {
  const facts = await readRecordFacts(organizationId, dealId);
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.organizationId, organizationId),
        eq(generatedDocuments.dealId, facts.dealId),
        eq(generatedDocuments.type, SELLER_FOLLOW_UP_DRAFT_TYPE),
      ),
    )
    .orderBy(desc(generatedDocuments.createdAt), desc(generatedDocuments.id));

  const supersededBy = new Map<number, number>();
  for (const r of rows) {
    const s = Number((r.variables ?? {}).supersedes);
    if (Number.isInteger(s) && s > 0 && !supersededBy.has(s)) supersededBy.set(s, r.id);
  }

  return rows.map((r) => {
    const v = r.variables ?? {};
    const cited = String(v.citedFacts ?? "")
      .split(",")
      .filter((t): t is FactToken => (FACT_TOKENS as readonly string[]).includes(t));
    const moved = cited
      .map((token) => ({ token, source: FACT_SOURCE[token], snapshot: String(v[`fact_${token}`] ?? ""), current: facts.values[token] }))
      .filter((m) => m.current !== m.snapshot);
    const supersedes = Number(v.supersedes);
    return {
      id: r.id,
      name: r.name,
      subject: String(v.subject ?? ""),
      body: r.content ?? "",
      status: r.status,
      leadId: r.leadId,
      offerTemplateId: Number(v.offerTemplateId) || null,
      offerTemplateName: String(v.offerTemplateName ?? ""),
      factsAsOf: String(v.factsAsOf ?? ""),
      facts: cited.map((token) => ({ token, value: String(v[`fact_${token}`] ?? ""), source: FACT_SOURCE[token] })),
      supersedes: Number.isInteger(supersedes) && supersedes > 0 ? supersedes : null,
      supersededBy: supersededBy.get(r.id) ?? null,
      stale: moved.length > 0,
      moved,
      createdAt: r.createdAt,
      generatedBy: r.generatedBy,
    };
  });
}
