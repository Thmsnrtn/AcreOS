/**
 * List builder v0 (W10.3) — build a mailing list from a county's own public
 * parcel records, behind the Map door. No Regrid licence: the source is the
 * free county GIS layer (county_gis_endpoints), queried through
 * server/services/providers/countyAreaQuery.ts.
 *
 * What the customer sees BEFORE saving is all true or absent:
 *   - the EXACT number of matching parcels (the county's own count);
 *   - a five-row sample of them;
 *   - how many are already their leads, how many would be new, and how many
 *     match a lead they deleted (suppressed — never re-created);
 *   - the cost: the pull is free (a county source), and the mail estimate is
 *     null — see MAIL_ESTIMATE below for why no single per-piece price exists.
 *
 * Saving is refused, with the reason in plain words, when the county's
 * licence is unreviewed (view-only), when the list is larger than one list may
 * be, when nothing matches, or when the new leads would exceed the org's plan.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { countyDiscoveryQueue, countyGisEndpoints, type CountyGisEndpoint, type MarketingList } from "@shared/schema";
import {
  COUNTY_LIST_STATUSES,
  countyLiveSourceCopy,
  countyQueueStatusCopy,
  countyStatusForLiveSource,
  isRedistributionDeclined,
  type CountyListStatus,
} from "@shared/geo/countyStatus";
import type { OwnerType } from "@shared/parcel/ownerName";
import { STATEWIDE_COUNTY } from "../statewideParcelEndpoints";
import { normalizeCounty, normalizeState } from "../coverageLedger";
import { checkUsageLimit, countPlanLeads, usageLimitFor } from "../usageLimits";
import { emitLeadCreated } from "../leadEvents";
import {
  AreaQueryAborted,
  AreaQueryRefusal,
  CountySourceError,
  areaFilterCapabilities,
  queryCountyArea,
  type AreaFilterName,
  type AreaRecord,
} from "../providers/countyAreaQuery";
import {
  ListPlanChangedError,
  planCountyListMembers,
  saveCountyList,
} from "../../storage/listBuilderRepo";
import { logger } from "../../utils/logger";

/** The most parcels one saved list may hold. A larger match is counted, never cut. */
const MAX_PER_LIST = 2_500;

/**
 * MAIL ESTIMATE — deliberately null (W10.3 investigation, 2026-10-05).
 *
 * There is no ONE price the send path charges per piece, so any number here
 * would be a guess presented as a quote:
 *   - POST /api/campaigns/:id/send-direct-mail debits DIRECT_MAIL_COSTS
 *     (directMail.ts: letter_1_page 125¢, postcards 75/95/115¢) through
 *     creditService — and 0¢ when the org mails on its own Lob key (BYOK);
 *   - the /outreach/mail queue (the composer) debits the org's credit POOL by
 *     the weight of whichever provider MailRouter picks at send time
 *     (shared/billing/credit-weights.ts: postcard_eddm 31 … letter_lob 120),
 *     with a free-tier lifetime allowance first;
 *   - the 150¢ at directMail.ts sendLetter is a usage-log estimate of OUR
 *     vendor cost, not what the org is charged.
 * Which applies depends on the path, the provider chosen at send time, the
 * org's tier and its own Lob credentials — none known when a list is built.
 */
const MAIL_ESTIMATE = null;

export interface ListBuilderFilters {
  acreageMin?: number;
  acreageMax?: number;
  ownerTypes?: OwnerType[];
  yearsOwnedMin?: number;
}

export interface ListBuilderQuery extends ListBuilderFilters {
  state: string;
  county: string;
}

export interface CountyOption {
  state: string;
  county: string;
  status: CountyListStatus;
  label: string;
  message: string;
  filters: Record<AreaFilterName, boolean>;
}

export type ListBuilderRefusal = {
  ok: false;
  kind: "bad_request" | "unprocessable" | "conflict" | "plan_limit" | "source_error";
  message: string;
  details?: Record<string, unknown>;
};

const NO_FILTERS: Record<AreaFilterName, boolean> = { acreage: false, ownerType: false, yearsOwned: false };

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Active per-county rows win; among them a saveable licence, then one still
 * under review, then one reviewed and declined ('no' — picked only when every
 * row is, so the county's copy matches the coverage route's), then the oldest.
 */
function pickEndpoint(rows: CountyGisEndpoint[]): CountyGisEndpoint | null {
  const rank = (e: CountyGisEndpoint) =>
    countyStatusForLiveSource(e.redistributable) === "covered" ? 0 : isRedistributionDeclined(e.redistributable) ? 2 : 1;
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0] ?? null;
}

/**
 * Statewide rows (county "*") answer point lookups only: their layers map no
 * county field, so they cannot be narrowed to one county and are never a
 * county list's source.
 */
async function activeCountyEndpoints(state: string): Promise<CountyGisEndpoint[]> {
  const rows = await db
    .select()
    .from(countyGisEndpoints)
    .where(and(eq(countyGisEndpoints.state, state), eq(countyGisEndpoints.isActive, true)));
  return rows.filter((r) => r.county !== STATEWIDE_COUNTY);
}

/** GET /api/list-builder/counties — every county AcreOS knows for a state, with what it can do. */
export async function countyOptionsForState(rawState: string): Promise<CountyOption[]> {
  const state = normalizeState(rawState);
  const endpoints = await activeCountyEndpoints(state);
  const queue = await db
    .select({ county: countyDiscoveryQueue.county, status: countyDiscoveryQueue.status, attempts: countyDiscoveryQueue.attempts })
    .from(countyDiscoveryQueue)
    .where(eq(countyDiscoveryQueue.state, state));

  const byCounty = new Map<string, CountyGisEndpoint[]>();
  for (const e of endpoints) {
    const key = normalizeCounty(e.county);
    byCounty.set(key, [...(byCounty.get(key) ?? []), e]);
  }
  const out: CountyOption[] = [];
  for (const rows of Array.from(byCounty.values())) {
    const endpoint = pickEndpoint(rows)!;
    out.push({ state, county: endpoint.county, ...countyLiveSourceCopy([endpoint.redistributable]), filters: areaFilterCapabilities(endpoint) });
  }
  for (const q of queue) {
    const key = normalizeCounty(q.county);
    if (!key || byCounty.has(key)) continue;
    // A `resolved` row with no active endpoint is a source that went dark:
    // the same words the coverage route uses (countyQueueStatusCopy).
    out.push({ state, county: titleCase(key), ...countyQueueStatusCopy(q), filters: NO_FILTERS });
  }
  // Most useful first — the vocabulary's own order (covered, view only, …,
  // none) — then by name, so the counties a list can be saved from lead.
  const rank = (st: CountyListStatus) => COUNTY_LIST_STATUSES.indexOf(st);
  return out.sort((a, b) => rank(a.status) - rank(b.status) || a.county.localeCompare(b.county));
}

async function resolveSource(
  rawState: string,
  rawCounty: string,
): Promise<{ endpoint: CountyGisEndpoint; status: "covered" | "view_only" } | ListBuilderRefusal> {
  const state = normalizeState(rawState);
  const county = normalizeCounty(rawCounty);
  const endpoint = pickEndpoint((await activeCountyEndpoints(state)).filter((e) => normalizeCounty(e.county) === county));
  if (endpoint) return { endpoint, status: countyStatusForLiveSource(endpoint.redistributable) };
  const [queued] = await db
    .select({ status: countyDiscoveryQueue.status, attempts: countyDiscoveryQueue.attempts })
    .from(countyDiscoveryQueue)
    .where(and(eq(countyDiscoveryQueue.state, state), eq(countyDiscoveryQueue.county, county)))
    .limit(1);
  const { status, message } = countyQueueStatusCopy(queued ?? null);
  return {
    ok: false,
    kind: "bad_request",
    message: `Lists can't be built for this county yet: ${message}`,
    details: { status },
  };
}

/**
 * Why a view-only county's list cannot be saved — true to its posture: terms
 * not reviewed yet ('review-required', or anything unknown), or reviewed and
 * declined ('no').
 */
function viewOnlyReason(endpoint: CountyGisEndpoint): string {
  return isRedistributionDeclined(endpoint.redistributable)
    ? "This county's terms of use were reviewed and don't permit saving its records, so they can be counted and previewed here but not saved into your leads."
    : "This county's terms of use haven't been reviewed yet, so its records can be counted and previewed here but not saved into your leads.";
}

function filtersOf(q: ListBuilderQuery) {
  return {
    acreageMin: q.acreageMin,
    acreageMax: q.acreageMax,
    ownerTypes: q.ownerTypes,
    yearsOwnedMin: q.yearsOwnedMin,
  };
}

/**
 * Run the county query, turning its typed failures into refusals (never a
 * number). A source that FAILED to answer is `source_error` (502 — transient,
 * try again); a source that cannot answer this as configured — it cannot
 * page, it is misconfigured, it refused the query with a 4xx-class error — is
 * `unprocessable` (422, structural: the reason is shown and retrying will not
 * help). AreaQueryAborted (the client went away) propagates to the route.
 */
async function runQuery(endpoint: CountyGisEndpoint, q: ListBuilderQuery, signal: AbortSignal | undefined) {
  try {
    return { ok: true as const, result: await queryCountyArea(endpoint, filtersOf(q), { memberLimit: MAX_PER_LIST, signal }) };
  } catch (e) {
    if (e instanceof AreaQueryRefusal) {
      return { ok: false as const, kind: "bad_request" as const, message: e.message, details: { filter: e.filter, ...e.details } };
    }
    if (e instanceof CountySourceError) {
      return {
        ok: false as const,
        kind: e.transient ? ("source_error" as const) : ("unprocessable" as const),
        message: e.message,
        details: { reason: e.reason },
      };
    }
    throw e;
  }
}

function sourceLabel(endpoint: CountyGisEndpoint): string {
  return `${endpoint.county} County, ${endpoint.state} public parcel records (county GIS)`;
}

/**
 * IDENTITY (when not tooLarge): count === alreadyLeads + newLeads +
 * suppressedDeleted + skippedNoApn + skippedDuplicateApn — every parcel the
 * county matched lands in exactly one. All five are null exactly when the
 * list is too large to read (the records were not read; nothing is invented).
 */
export interface ListPreview {
  count: number;
  sample: AreaRecord[];
  alreadyLeads: number | null;
  newLeads: number | null;
  suppressedDeleted: number | null;
  skippedNoApn: number | null;
  skippedDuplicateApn: number | null;
  cost: { pullCredits: 0; source: string; mailEstimate: { pieceType: string; perPieceCents: number; totalCents: number } | null };
  saveable: boolean;
  saveRefusal: string | null;
  maxPerList: number;
  tooLarge: boolean;
  status: CountyListStatus;
  attribution: string | null;
}

/** POST /api/list-builder/preview. */
export async function previewCountyList(
  organizationId: number,
  q: ListBuilderQuery,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true; preview: ListPreview } | ListBuilderRefusal> {
  const source = await resolveSource(q.state, q.county);
  if ("ok" in source) return source;
  const { endpoint, status } = source;

  const run = await runQuery(endpoint, q, opts.signal);
  if (!run.ok) return run;
  const { count, records, sample } = run.result;
  const tooLarge = count > MAX_PER_LIST;

  // The member plan is read only when the list could be saved at its size —
  // when it is too large the records were not read, and no "already your
  // leads" figure is invented for them.
  const plan = records ? await planCountyListMembers(organizationId, endpoint.state, endpoint.county, records) : null;

  let saveRefusal: string | null = null;
  if (status === "view_only") saveRefusal = viewOnlyReason(endpoint);
  else if (tooLarge) {
    saveRefusal = `${count.toLocaleString("en-US")} parcels match; one list can hold at most ${MAX_PER_LIST.toLocaleString("en-US")}. Narrow the filters to save it.`;
  } else if (count === 0) saveRefusal = "No parcels match these filters, so there is nothing to save.";
  else if (plan && plan.toCreate.length > 0) {
    // A list that creates no lead cannot exceed a lead limit.
    const usage = await checkUsageLimit(organizationId, "leads");
    if (usage.limit !== null && usage.current + plan.toCreate.length > usage.limit) {
      saveRefusal = `Saving would add ${plan.toCreate.length.toLocaleString("en-US")} new leads; your plan allows ${usage.limit.toLocaleString("en-US")} and you have ${usage.current.toLocaleString("en-US")}.`;
    }
  }

  return {
    ok: true,
    preview: {
      count,
      sample,
      // Per PARCEL, so the identity holds by construction.
      alreadyLeads: plan ? plan.linkedParcels : null,
      newLeads: plan ? plan.toCreate.length : null,
      suppressedDeleted: plan ? plan.suppressedDeleted : null,
      skippedNoApn: plan ? plan.skippedNoApn : null,
      skippedDuplicateApn: plan ? plan.skippedDuplicateApn : null,
      cost: { pullCredits: 0, source: sourceLabel(endpoint), mailEstimate: MAIL_ESTIMATE },
      saveable: saveRefusal === null,
      saveRefusal,
      maxPerList: MAX_PER_LIST,
      tooLarge,
      status,
      attribution: endpoint.attribution ?? null,
    },
  };
}

export interface CommittedList {
  listId: number;
  created: number;
  linkedExisting: number;
  total: number;
  suppressedDeleted: number;
  skippedNoApn: number;
  skippedDuplicateApn: number;
  attribution: string | null;
}

/**
 * POST /api/list-builder/commit. Writes nothing unless every check passes.
 * `opts.signal` (the client went away) stops the county read and is checked
 * once more before the write; once the transaction starts it completes.
 */
export async function commitCountyList(
  organizationId: number,
  q: ListBuilderQuery & { name: string; expectedCount: number },
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true; list: CommittedList } | ListBuilderRefusal> {
  const source = await resolveSource(q.state, q.county);
  if ("ok" in source) return source;
  const { endpoint, status } = source;
  if (status === "view_only") return { ok: false, kind: "unprocessable", message: viewOnlyReason(endpoint), details: { status } };

  const run = await runQuery(endpoint, q, opts.signal);
  if (!run.ok) return run;
  const { count, records } = run.result;
  if (count !== q.expectedCount) {
    return {
      ok: false,
      kind: "conflict",
      message: "The county's records changed since your preview; review the new count.",
      details: { count },
    };
  }
  if (count > MAX_PER_LIST || !records) {
    return {
      ok: false,
      kind: "unprocessable",
      message: `${count.toLocaleString("en-US")} parcels match; one list can hold at most ${MAX_PER_LIST.toLocaleString("en-US")}.`,
      details: { count, maxPerList: MAX_PER_LIST },
    };
  }
  if (count === 0) {
    return { ok: false, kind: "unprocessable", message: "No parcels match these filters, so there is nothing to save.", details: { count } };
  }

  const plan = await planCountyListMembers(organizationId, endpoint.state, endpoint.county, records);
  const planRefusal = (newLeads: number, limit: number, current: number): ListBuilderRefusal => ({
    ok: false,
    kind: "plan_limit",
    message: `Saving this list would add ${newLeads.toLocaleString("en-US")} new leads, but your plan allows ${limit.toLocaleString("en-US")} and you have ${current.toLocaleString("en-US")}. Nothing was saved.`,
    details: { resourceType: "leads", limit, current, newLeads },
  });
  // Checked here for a fast refusal, and again under the save's lock (the
  // count can move in between). A list that creates no lead is never refused.
  // The LIMIT is read here, before the transaction; under the lock only the
  // count is re-read, through the transaction's own connection.
  let leadLimit: number | null;
  if (plan.toCreate.length > 0) {
    const usage = await checkUsageLimit(organizationId, "leads");
    if (usage.limit !== null && usage.current + plan.toCreate.length > usage.limit) {
      return planRefusal(plan.toCreate.length, usage.limit, usage.current);
    }
    leadLimit = usage.limit;
  } else {
    // Under the lock the plan can still turn lead-creating (a matched lead
    // deleted in between), so the limit must be in hand anyway.
    leadLimit = await usageLimitFor(organizationId, "leads");
  }

  const filters: NonNullable<MarketingList["filters"]> = {
    states: [endpoint.state],
    counties: [endpoint.county],
    ...(q.acreageMin !== undefined ? { acreageMin: q.acreageMin } : {}),
    ...(q.acreageMax !== undefined ? { acreageMax: q.acreageMax } : {}),
    ...(q.ownerTypes !== undefined ? { ownerType: q.ownerTypes } : {}),
    ...(q.yearsOwnedMin !== undefined ? { yearsOwned: q.yearsOwnedMin } : {}),
  };

  if (opts.signal?.aborted) throw new AreaQueryAborted();
  let saved;
  try {
    saved = await saveCountyList(organizationId, {
      name: q.name,
      state: endpoint.state,
      county: endpoint.county,
      filters,
      sourceCount: count,
      parcels: records,
      leadLimit,
      countPlanLeads: (tx) => countPlanLeads(tx, organizationId),
    });
  } catch (e) {
    if (e instanceof ListPlanChangedError) return planRefusal(e.newLeads, e.limit, e.current);
    throw e;
  }

  for (const lead of saved.created) emitLeadCreated(organizationId, lead);
  logger.info("[list-builder] county list saved", {
    source: "list-builder",
    metadata: {
      organizationId,
      listId: saved.listId,
      endpointId: endpoint.id,
      count,
      created: saved.created.length,
      linkedExisting: saved.linkedExisting,
      suppressedDeleted: saved.suppressedDeleted,
      skippedNoApn: saved.skippedNoApn,
      skippedDuplicateApn: saved.skippedDuplicateApn,
    },
  });
  return {
    ok: true,
    list: {
      listId: saved.listId,
      created: saved.created.length,
      linkedExisting: saved.linkedExisting,
      total: saved.total,
      suppressedDeleted: saved.suppressedDeleted,
      skippedNoApn: saved.skippedNoApn,
      skippedDuplicateApn: saved.skippedDuplicateApn,
      attribution: endpoint.attribution ?? null,
    },
  };
}
