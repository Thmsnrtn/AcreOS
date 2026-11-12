/**
 * County list builder v0 — the server authority behind the Map door's "Build
 * a list" (roadmap W10.3; founder ruling 2026-09-29 #2: all sources, layered —
 * Regrid primary once licensed, ATTOM and free county assessor data behind
 * it). Draft W4.10: REAL BUT GATED. It serves no geography today.
 *
 * One question, asked of every layer for a geography BEFORE any source is
 * contacted: may AcreOS build a list here? The answer is a county list status
 * (shared/landData/countyListStatus.ts) plus every reason it stops short. Only
 * a layer at rights_qualified is ever asked to count, so an uncleared geography
 * is refused without a single request — the posture of the statewide lookup
 * gate (founder decision 2026-11-03), whose function, isClearedForLookup(), this
 * module calls for every state it evaluates.
 *
 * The contract, enforced here and independent of any UI:
 *   quote → admission, filter support, price, the source's COUNT, a ceiling
 *           (refuse, never truncate), and a digest binding org + query + count
 *           + cost + layer;
 *   pull  → needs that digest; re-runs the quote (clearance, count and price
 *           re-checked) and refuses on any difference; only then hands the
 *           query to the import leg, with the quoted cost as the charge.
 *
 * What keeps it dark (each written up in the W4.10 PR):
 *   - no county list query is built for any source (`sources` is empty);
 *   - no import leg: owner records may enter leads only through a
 *     purpose-ledger surface for list pulls (D2e), which does not exist;
 *   - every statewide source is gated for lookup and none has a mail-use
 *     finding (counsel Q-12.3);
 *   - Regrid / ATTOM: their licence-register entries do not let AcreOS keep
 *     records, and a platform-paid list pull has no founder-set price.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { countyListStatus, type CountyListStatus } from "@shared/landData/countyListStatus";
import { CSV_IMPORT_MAX_ROWS_PER_FILE } from "@shared/product-limits";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../statewideParcelEndpoints";
import { isClearedForLookup, statewideSource } from "../openData/statewideSourceRegistry";
import { mayCacheAndRedistribute, redistributableFor } from "../providers/data-licenses";
import { regridProvider } from "../providers/regrid-provider";
import { attomProvider } from "../providers/attom-provider";
import { countyGisProvider } from "../providers/county-gis-provider";
import type { DataProvider } from "../providers/types";
import { normalizeCountyName } from "./ownedParcelStore";
import { clock } from "../../utils/clock";

/** Owner types of the existing list model (marketing_lists.filters.ownerType). */
const OWNER_TYPES = ["individual", "llc", "trust", "estate"] as const;

/**
 * A county list query. Strict: a filter the contract does not name is
 * refused, never ignored (DEFECT-0191), and no org can be named in the body.
 */
export const listQuerySchema = z
  .object({
    state: z.string().trim().length(2).transform((s) => s.toUpperCase()),
    county: z.string().trim().min(1).max(120),
    filters: z
      .object({
        acreageMin: z.number().nonnegative().optional(),
        acreageMax: z.number().nonnegative().optional(),
        ownerType: z.array(z.enum(OWNER_TYPES)).min(1).max(OWNER_TYPES.length).optional(),
        yearsOwned: z.number().int().nonnegative().max(200).optional(),
      })
      .strict()
      .refine((f) => f.acreageMin === undefined || f.acreageMax === undefined || f.acreageMin <= f.acreageMax, {
        message: "acreageMin must not exceed acreageMax",
      })
      .default({}),
  })
  .strict();
export type ListQuery = z.infer<typeof listQuerySchema>;

type ListFilterKey = "acreage" | "ownerType" | "yearsOwned";
type LayerId = "regrid" | "attom" | "open_data";

/** A county list query for one source — the seam a future slice implements (as a provider-registry capability). */
interface ListSource {
  /** The filters this source's data really carries. */
  filters: ReadonlySet<ListFilterKey>;
  count(query: ListQuery): Promise<number>;
}

/** The only cost v0 can quote: first-party data that costs AcreOS nothing. */
type ListCost = { kind: "free"; credits: 0 };
const FREE: ListCost = Object.freeze({ kind: "free", credits: 0 }) as ListCost;

interface Quote {
  status: CountyListStatus;
  layer: LayerId;
  count: number;
  cost: ListCost;
  ceiling: number;
  quoteDigest: string;
}

/** The path from a pulled list into leads, charged at exactly the quoted cost. */
type ImportLeg = (args: {
  organizationId: number;
  actorUserId: string;
  operationKey: string;
  query: ListQuery;
  quote: Quote;
}) => Promise<{ imported: number; duplicatesSkipped: number }>;

interface ListBuilderDeps {
  /** County list queries by layer, keyed by state ("*" = any state). */
  sources: Partial<Record<LayerId, Readonly<Record<string, ListSource>>>>;
  importLeg: ImportLeg | null;
}

/** Production: no list query is built and no import leg exists. */
const PRODUCTION_DEPS: ListBuilderDeps = Object.freeze({ sources: Object.freeze({}), importLeg: null });

/** One pull is one import; the import path takes at most this many rows. Over it the quote refuses — never a silent cap. */
const LIST_PULL_MAX_RECORDS = CSV_IMPORT_MAX_ROWS_PER_FILE;

interface Layer {
  id: LayerId;
  provider: DataProvider;
  /** Licence-register key for a vendor layer; null for open data (per-source dossiers govern). */
  register: string | null;
}

/** Founder ruling 2026-09-29 #2, in order: the first admitted layer serves. */
const LAYERS: readonly Layer[] = [
  { id: "regrid", provider: regridProvider, register: "Regrid" },
  { id: "attom", provider: attomProvider, register: "ATTOM Data" },
  { id: "open_data", provider: countyGisProvider, register: null },
];

interface LayerVerdict {
  layer: LayerId;
  status: CountyListStatus;
  reasons: string[];
}

const IMPORT_LEG_BLOCKER =
  "Pulled lists can't be added to your leads yet: the record of why owner details are used (the purpose ledger) does not cover list pulls.";

/**
 * What a layer costs per pulled list, from the provider registry's own price.
 * A provider that costs AcreOS nothing per record makes the pull free. A
 * provider with a per-record cost needs a founder-set list-pull price; none
 * exists, so the pull is unpriced and is not quoted.
 */
function priceOf(layer: Layer): ListCost | null {
  return layer.provider.costPerLookupCents("owner_info") === 0 ? FREE : null;
}

function sourceFor(deps: ListBuilderDeps, layer: LayerId, state: string): ListSource | undefined {
  const byState = deps.sources[layer];
  return byState?.[state] ?? byState?.["*"];
}

function evaluateLayer(deps: ListBuilderDeps, layer: Layer, state: string, now: Date): LayerVerdict {
  const source = sourceFor(deps, layer.id, state);
  const price = priceOf(layer);
  const reasons: string[] = [];

  if (layer.register === null) {
    // Free statewide sources: the lookup gate first, then the dossier's policy.
    const entry = statewideSource(state, now);
    if (!entry) {
      return {
        layer: layer.id,
        status: "none",
        reasons: [`No free statewide parcel source is set up for ${state}. County-run parcel services are not part of the list builder yet.`],
      };
    }
    const lookup = isClearedForLookup(entry);
    if (!lookup) reasons.push(`${state}'s free statewide parcel source is not cleared for AcreOS to serve yet: its licence review is open.`);
    const missing = [
      entry.policy.can_display ? null : "showing its records to you",
      entry.policy.can_cache ? null : "keeping them as leads",
      entry.policy.can_mail ? null : "addressing mail to the owners",
    ].filter((m): m is string => m !== null);
    if (missing.length > 0) reasons.push(`${state}'s source terms do not yet establish ${missing.join(", ")}.`);
    if (!source) reasons.push(`No county list query is built for ${state}'s source.`);
    if (!price) reasons.push(`A list pull from ${state}'s source has no price set.`);
    const status = countyListStatus({
      endpoint: true,
      lookup,
      listReady: !!source && !!deps.importLeg && !!price,
      rightsQualified: missing.length === 0,
    });
    return { layer: layer.id, status, reasons };
  }

  // Vendor layers: the licence register is their gate (the statewide lookup
  // gate governs only the free statewide sources).
  const name = layer.provider.displayName;
  const keep = mayCacheAndRedistribute(layer.register);
  if (!keep) reasons.push(`${name}'s licence-register entry (redistribution: ${redistributableFor(layer.register)}) does not let AcreOS keep its records, so they cannot become leads.`);
  reasons.push(`No mail-use finding is recorded for ${name}.`);
  if (!source) reasons.push(`No county list query is built for ${name}.`);
  if (!price) reasons.push(`A list pull from ${name} on AcreOS's account has no price set.`);
  const status = countyListStatus({
    endpoint: !!source,
    lookup: !!source,
    listReady: !!source && !!deps.importLeg && !!price,
    // No vendor carries a mail-use finding in the register today.
    rightsQualified: false,
  });
  return { layer: layer.id, status, reasons };
}

const RANK: Record<CountyListStatus, number> = { none: 0, endpoint: 1, lookup: 2, list_ready: 3, rights_qualified: 4 };

function evaluate(deps: ListBuilderDeps, state: string) {
  const now = clock.now();
  const layers = LAYERS.map((l) => evaluateLayer(deps, l, state, now));
  const status = layers.reduce<CountyListStatus>((best, v) => (RANK[v.status] > RANK[best] ? v.status : best), "none");
  const serving = layers.find((v) => v.status === "rights_qualified");
  return { status, layers, serving, blockers: deps.importLeg ? [] : [IMPORT_LEG_BLOCKER] };
}

function requestedFilters(f: ListQuery["filters"]): ListFilterKey[] {
  const keys: ListFilterKey[] = [];
  if (f.acreageMin !== undefined || f.acreageMax !== undefined) keys.push("acreage");
  if (f.ownerType !== undefined) keys.push("ownerType");
  if (f.yearsOwned !== undefined) keys.push("yearsOwned");
  return keys;
}

function digestOf(organizationId: number, query: ListQuery, layer: LayerId, count: number, cost: ListCost): string {
  const f = query.filters;
  const canonical = JSON.stringify([
    1,
    organizationId,
    query.state,
    normalizeCountyName(query.county),
    f.acreageMin ?? null,
    f.acreageMax ?? null,
    f.ownerType ? [...f.ownerType].sort() : null,
    f.yearsOwned ?? null,
    layer,
    count,
    cost.kind,
    cost.credits,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type QuoteOutcome =
  | ({ ok: true } & Quote)
  | { ok: false; code: "not_cleared"; status: CountyListStatus; layers: LayerVerdict[]; blockers: string[] }
  | { ok: false; code: "filter_unsupported"; unsupported: ListFilterKey[] }
  | { ok: false; code: "list_too_large"; count: number; ceiling: number }
  | { ok: false; code: "count_unavailable" };

export type PullOutcome =
  | { ok: true; quote: Quote; charged: ListCost; result: { imported: number; duplicatesSkipped: number } }
  | Exclude<QuoteOutcome, { ok: true }>
  | { ok: false; code: "quote_required" }
  | { ok: false; code: "quote_changed"; quote: Quote }
  | { ok: false; code: "nothing_to_pull" };

export function createListBuilder(deps: ListBuilderDeps = PRODUCTION_DEPS) {
  async function quote(organizationId: number, query: ListQuery): Promise<QuoteOutcome> {
    const geo = evaluate(deps, query.state);
    const layer = geo.serving ? LAYERS.find((l) => l.id === geo.serving!.layer) : undefined;
    const source = layer ? sourceFor(deps, layer.id, query.state) : undefined;
    const cost = layer ? priceOf(layer) : null;
    // rights_qualified implies a source, a price and an import leg; checked again, never assumed.
    if (!layer || !source || !cost || !deps.importLeg) {
      return { ok: false, code: "not_cleared", status: geo.status, layers: geo.layers, blockers: geo.blockers };
    }
    const unsupported = requestedFilters(query.filters).filter((k) => !source.filters.has(k));
    if (unsupported.length > 0) return { ok: false, code: "filter_unsupported", unsupported };

    let count: number;
    try {
      count = await source.count(query);
    } catch {
      return { ok: false, code: "count_unavailable" };
    }
    if (!Number.isSafeInteger(count) || count < 0) return { ok: false, code: "count_unavailable" };
    if (count > LIST_PULL_MAX_RECORDS) return { ok: false, code: "list_too_large", count, ceiling: LIST_PULL_MAX_RECORDS };
    return {
      ok: true,
      status: "rights_qualified",
      layer: layer.id,
      count,
      cost,
      ceiling: LIST_PULL_MAX_RECORDS,
      quoteDigest: digestOf(organizationId, query, layer.id, count, cost),
    };
  }

  return {
    /** Every seeded statewide state's status; `selectable` holds only the admitted ones. */
    geographies() {
      const states = STATEWIDE_PARCEL_ENDPOINTS.map((e) => {
        const g = evaluate(deps, e.state);
        return { state: e.state, status: g.status, layers: g.layers };
      });
      const selectable = states
        .filter((s) => s.status === "rights_qualified")
        .map((s) => ({ state: s.state, layer: s.layers.find((v) => v.status === "rights_qualified")!.layer }));
      return { selectable, states, blockers: deps.importLeg ? [] : [IMPORT_LEG_BLOCKER] };
    },

    quote,

    /** Never without the quote's digest; the quote is re-run, so clearance, count and price are re-checked. */
    async pull(args: {
      organizationId: number;
      actorUserId: string;
      operationKey: string;
      query: ListQuery;
      expectedQuoteDigest: string | undefined;
    }): Promise<PullOutcome> {
      if (!args.expectedQuoteDigest) return { ok: false, code: "quote_required" };
      const fresh = await quote(args.organizationId, args.query);
      if (!fresh.ok) return fresh;
      const { ok: _ok, ...q } = fresh;
      if (q.quoteDigest !== args.expectedQuoteDigest) return { ok: false, code: "quote_changed", quote: q };
      if (q.count === 0) return { ok: false, code: "nothing_to_pull" };
      const leg = deps.importLeg;
      if (!leg) return { ok: false, code: "not_cleared", status: q.status, layers: [], blockers: [IMPORT_LEG_BLOCKER] };
      const result = await leg({
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        operationKey: args.operationKey,
        query: args.query,
        quote: q,
      });
      return { ok: true, quote: q, charged: q.cost, result };
    },
  };
}

export type ListBuilder = ReturnType<typeof createListBuilder>;
