/**
 * isSuppressedForOutreach — THE HOOK every lead import passes before it
 * creates a lead (W5b).
 *
 * HANDOFF TO W5a. The owner opt-out / deletion / suppression list is being
 * built in parallel (wave W5a) and was not on this branch's base. Until it
 * lands, this hook answers from what the org's own records already say: an
 * existing lead in THIS org that has opted out (STOP, do-not-contact, or a
 * recorded opt-out date) at the same phone, email, or mailing address. A
 * re-imported list must not resurrect an owner who said stop.
 *
 * When W5a's suppression list exists, replace the body of
 * `loadOutreachSuppression` with a read of it (keep both names and
 * signatures: the importers call `loadOutreachSuppression` once per request /
 * job and test every row with the function it returns; `isSuppressedForOutreach`
 * is the single-candidate form). A suppressed row is SKIPPED — not imported as
 * a do-not-contact copy — because a deletion request means the record should
 * not exist again.
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
  /** Passed for W5a's list, which may key an owner's request on the parcel. Unused by this interim body. */
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

export async function isSuppressedForOutreach(organizationId: number, candidate: SuppressionCandidate): Promise<SuppressionVerdict> {
  return (await loadOutreachSuppression(organizationId))(candidate);
}
