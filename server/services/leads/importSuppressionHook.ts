/**
 * loadOutreachSuppression — the org-local half of import suppression (W5b).
 *
 * Every lead import asks this once per request / job and tests each row with
 * the function it returns: an existing lead in THIS org that has opted out
 * (STOP, do-not-contact, or a recorded opt-out date) at the same phone, email,
 * or mailing address. A re-imported list must not resurrect an owner who told
 * this org to stop, so a suppressed row is SKIPPED, not imported.
 *
 * The PLATFORM-WIDE half — an owner's opt-out request to AcreOS (W5a,
 * server/services/trust/ownerSuppression.ts) — is applied where every lead is
 * written, not here: leadRepo.createLead / createLeads and each direct insert
 * path call stampOwnerSuppression, which keeps the row (it is the org's own
 * data) but stamps it do-not-contact. ownerSuppressionEverySendPath.test.ts
 * enumerates those paths. The two halves were built in parallel (W5a / W5b)
 * and both now run on every import.
 *
 * Org-scoped: the one query carries the organization id. It loads the org's
 * opted-out leads once (normally a short list) instead of one query per row,
 * so a 50,000-row background import stays one query.
 */
import { and, eq, not } from "drizzle-orm";
import { leadNotOptedOutSql } from "../leadContactability";
import { db } from "../../db";
import { leads } from "@shared/schema";

export interface SuppressionCandidate {
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  zip?: string | null;
  /** Accepted for callers that have it; not used for org-local matching. */
  apn?: string | null;
  state?: string | null;
  county?: string | null;
}

export interface SuppressionVerdict {
  suppressed: boolean;
  reason?: string;
}

const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
const normEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
const normAddress = (a: string | null | undefined, z: string | null | undefined) => {
  const street = (a ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const zip5 = (z ?? "").trim().slice(0, 5);
  return street && zip5.length === 5 ? `${street}|${zip5}` : "";
};

const REASON = "an owner at this phone, email or mailing address asked not to be contacted";

export async function loadOutreachSuppression(organizationId: number): Promise<(c: SuppressionCandidate) => SuppressionVerdict> {
  const rows = await db
    .select({ phone: leads.phone, email: leads.email, address: leads.address, zip: leads.zip })
    .from(leads)
    // Opted out = NOT the one contactability rule (leadContactability.ts).
    .where(and(eq(leads.organizationId, organizationId), not(leadNotOptedOutSql())));
  const phones = new Set<string>();
  const emails = new Set<string>();
  const addresses = new Set<string>();
  for (const r of rows) {
    const p = last10(r.phone);
    if (p.length === 10) phones.add(p);
    const e = normEmail(r.email);
    if (e) emails.add(e);
    const a = normAddress(r.address, r.zip);
    if (a) addresses.add(a);
  }
  return (c) => {
    const p = last10(c.phone);
    const e = normEmail(c.email);
    const a = normAddress(c.address, c.zip);
    const hit = (p.length === 10 && phones.has(p)) || (e !== "" && emails.has(e)) || (a !== "" && addresses.has(a));
    return hit ? { suppressed: true, reason: REASON } : { suppressed: false };
  };
}
