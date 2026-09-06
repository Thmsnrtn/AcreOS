/**
 * Lead Dedupe Scanner — find clusters of likely-duplicate leads.
 *
 * storage.findDuplicateLeads is a point-lookup ("does this new lead
 * collide with an existing one?"). This service does the inverse: scan
 * the whole org's lead corpus and return clusters where two or more
 * rows are likely the same person.
 *
 * Clustering rules (any one triggers a cluster):
 *  1. Same normalized phone (digits only, last 10)
 *  2. Same normalized email (lowercase, trimmed)
 *  3. Same (firstName + lastName + address) tuple, case-insensitive
 *
 * Returns clusters sorted by size (biggest first) so the operator
 * knocks out the highest-leverage merges first.
 *
 * Cheap — pulls all leads once, does in-memory grouping. Safe to run
 * on-demand; cache at the caller if needed.
 */

import { db } from "../db";
import { leads, type Lead } from "@shared/schema";
import { and, eq, notInArray, sql } from "drizzle-orm";

import { ADMINISTRATIVE_LEAD_STATUSES, TERMINAL_LEAD_STATUSES } from "@shared/lifecycle/pipeline-status";
export interface LeadCluster {
  /** What matched (phone / email / name_address). */
  matchType: "phone" | "email" | "name_address";
  /** Canonical form of the matched value (for display). */
  matchValue: string;
  /** The member leads — always 2+. */
  leads: Lead[];
}

function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function normEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.includes("@") ? trimmed : null;
}

function nameAddressKey(lead: Lead): string | null {
  const first = (lead.firstName || "").trim().toLowerCase();
  const last = (lead.lastName || "").trim().toLowerCase();
  const addr = (lead.address || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!first || !last || !addr) return null;
  return `${first}|${last}|${addr}`;
}

export async function findDuplicateClusters(
  organizationId: number,
  opts: { limit?: number } = {},
): Promise<LeadCluster[]> {
  const limit = opts.limit ?? 100;
  // Skip leads that are already terminal states — dead / converted —
  // dedupe is about live prospects.
  const rows = await db
    .select()
    .from(leads)
    .where(
      // WAS `NOT IN ('dead','converted','deleted')`. `converted` is not a
      // lead status — the comment above says the intent is "already terminal
      // states", and those are `closed` and `dead`. `deleted` stays: it is a
      // real administrative value the soft-delete writes.
      and(
        eq(leads.organizationId, organizationId),
        notInArray(leads.status, [...TERMINAL_LEAD_STATUSES, ...ADMINISTRATIVE_LEAD_STATUSES]),
      ),
    )
    .limit(50000);

  const byPhone = new Map<string, Lead[]>();
  const byEmail = new Map<string, Lead[]>();
  const byNameAddr = new Map<string, Lead[]>();

  for (const lead of rows) {
    const p = normPhone(lead.phone);
    if (p) {
      const bucket = byPhone.get(p) ?? [];
      bucket.push(lead);
      byPhone.set(p, bucket);
    }
    const e = normEmail(lead.email);
    if (e) {
      const bucket = byEmail.get(e) ?? [];
      bucket.push(lead);
      byEmail.set(e, bucket);
    }
    const na = nameAddressKey(lead);
    if (na) {
      const bucket = byNameAddr.get(na) ?? [];
      bucket.push(lead);
      byNameAddr.set(na, bucket);
    }
  }

  const clusters: LeadCluster[] = [];
  const seenIds = new Set<string>();

  function pushIfNew(matchType: LeadCluster["matchType"], matchValue: string, leadList: Lead[]) {
    if (leadList.length < 2) return;
    // Dedupe clusters that reference the same set of leads via different
    // keys (e.g., same pair with matching phone AND email). Stable key
    // = sorted lead ids.
    const signature = leadList.map((l) => l.id).sort((a, b) => a - b).join(",");
    if (seenIds.has(signature)) return;
    seenIds.add(signature);
    clusters.push({ matchType, matchValue, leads: leadList });
  }

  for (const [phone, list] of byPhone) pushIfNew("phone", phone, list);
  for (const [email, list] of byEmail) pushIfNew("email", email, list);
  for (const [key, list] of byNameAddr) {
    // Humanize the name_address key back into something readable.
    const [first, last, addr] = key.split("|");
    pushIfNew("name_address", `${first} ${last} · ${addr}`, list);
  }

  clusters.sort((a, b) => b.leads.length - a.leads.length);
  return clusters.slice(0, limit);
}
