/**
 * Andrei (2026-06-06) — source-fact extraction for the Pax hallucination guard.
 *
 * The hallucination guard (server/services/paxHallucinationGuard.ts → guardPaxOutput)
 * can verify that the numbers and entity IDs Pax states actually came from the
 * data it was given THIS turn — but only if the caller hands it that source
 * context. Before this module, executive.ts called the guard with only
 * { organizationId, output }, so the numeric check had no source set to compare
 * against (it fell back to a weak freeform heuristic) and the entity-existence
 * check never fired at all (no IDs passed).
 *
 * This module walks the `toolCallsExecuted` array a Pax turn produced and pulls:
 *  - sourceNumbers: every numeric fact that appeared in a tool RESULT — parcel
 *    acreage, prices, scores, enrichment values, APN-derived numbers — so the
 *    guard can flag any number in Pax's reply that isn't grounded in a source.
 *  - claimedPropertyIds / claimedLeadIds / claimedDealIds: the entity IDs the
 *    tools touched, so the guard's cross-org existence check can fire.
 *
 * Design notes:
 *  - We extract from tool RESULTS (what the data layer returned), not tool
 *    ARGS, because args are what Pax/the model *asked for* and could themselves
 *    be hallucinated. The result is the ground truth the guard compares against.
 *  - We are deliberately GENEROUS in what counts as a source number (recurse the
 *    whole result object). A false negative here (missing a real source number)
 *    is worse than a false positive: a missed source number can make the guard
 *    flag a legitimate value, but the guard is advisory for `warning` severity,
 *    so over-collection only loosens the net — it never blocks a good answer.
 *  - Property IDs are collected only from well-known id-bearing fields
 *    (propertyId / property.id / id within a property-shaped object), not from
 *    every numeric field, to avoid turning an acreage value into a fake ID.
 */

export interface ExtractedSourceContext {
  sourceNumbers: number[];
  claimedPropertyIds: number[];
  claimedLeadIds: number[];
  claimedDealIds: number[];
}

/** A single executed tool call as pushed onto `toolCallsExecuted` in executive.ts. */
export interface ExecutedToolCall {
  name: string;
  arguments?: unknown;
  result?: unknown;
}

const MAX_DEPTH = 6;

/** Coerce a value to a finite, positive-ish number, or null. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    // Strip currency/percent/commas; only accept a clean numeric token.
    const cleaned = value.replace(/[$,%\s]/g, "");
    if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Keys whose numeric values are NOT facts to compare Pax's prose against —
 * timestamps, internal IDs, coordinates, counts/flags. Including these as
 * "source numbers" would let the guard treat e.g. a unix timestamp or a row id
 * as a legitimate dollar figure Pax could echo. Matched case-insensitively as
 * substrings.
 */
const NON_FACT_KEY_SUBSTRINGS = [
  "id",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "lon",
  "timestamp",
  "createdat",
  "updatedat",
  "fetchedat",
  "enrichedat",
  "asof",
  "_at",
];

function isNonFactKey(key: string): boolean {
  const k = key.toLowerCase();
  return NON_FACT_KEY_SUBSTRINGS.some((s) => k.includes(s));
}

/**
 * A LEAD row carries person/consent fields. Leads also have an `apn` column
 * (the parcel the seller owns), so `"apn" in obj` alone used to classify every
 * lead row as a property — and the guard then checked lead ids against the
 * properties table, found none, and threw away a correct DNC answer twice
 * (oracle pass D6, 2026-10-06).
 */
function looksLikeLead(obj: Record<string, unknown>): boolean {
  return (
    "doNotContact" in obj ||
    "tcpaConsent" in obj ||
    ("firstName" in obj && "lastName" in obj)
  );
}

/** Property-ish container detection: an object that looks like a property row. */
function looksLikeProperty(obj: Record<string, unknown>): boolean {
  if (looksLikeLead(obj)) return false;
  return (
    obj.apn != null ||
    "sizeAcres" in obj ||
    "parcelData" in obj ||
    "parcelBoundary" in obj
  );
}

export type GuardEntity = "lead" | "property" | "deal";

/**
 * Which entity a tool's top-level rows ARE, from its name. `get_leads` returns
 * leads, `get_lead_details` a lead, `get_deals` deals, `get_properties`
 * properties — so a bare `id` on one of those rows is typed by the tool that
 * returned it, not guessed from the row's columns.
 */
export function entityForTool(toolName: string | undefined | null): GuardEntity | null {
  const n = String(toolName ?? "").toLowerCase();
  if (/(^|_)leads?(_|$)/.test(n)) return "lead";
  if (/(^|_)deals?(_|$)/.test(n)) return "deal";
  if (/(^|_)propert(y|ies)(_|$)/.test(n)) return "property";
  return null;
}

function pushId(set: Set<number>, value: unknown): void {
  const n = toFiniteNumber(value);
  if (n != null && Number.isInteger(n) && n > 0) set.add(n);
}

/**
 * Recursively walk a tool result, collecting source numbers and entity IDs.
 */
function walk(
  node: unknown,
  ctx: {
    numbers: Set<number>;
    propertyIds: Set<number>;
    leadIds: Set<number>;
    dealIds: Set<number>;
  },
  depth: number,
  parentKey: string | null,
): void {
  if (node == null || depth > MAX_DEPTH) return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, ctx, depth + 1, parentKey);
    return;
  }

  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const propertyShaped = looksLikeProperty(obj);

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // Entity-ID collection from well-known id-bearing keys.
      if (lowerKey === "propertyid") {
        pushId(ctx.propertyIds, value);
      } else if (lowerKey === "leadid") {
        pushId(ctx.leadIds, value);
      } else if (lowerKey === "dealid") {
        pushId(ctx.dealIds, value);
      } else if (lowerKey === "id" && propertyShaped) {
        // `id` on a property-shaped object is a property id.
        pushId(ctx.propertyIds, value);
      }

      if (value != null && typeof value === "object") {
        walk(value, ctx, depth + 1, key);
        continue;
      }

      // Scalar: candidate source number, unless it's a non-fact key.
      if (!isNonFactKey(key)) {
        const n = toFiniteNumber(value);
        if (n != null && n > 0) ctx.numbers.add(n);
      }
    }
    return;
  }
}

/**
 * Extract the source context the hallucination guard needs from a Pax turn's
 * executed tool calls. Returns empty arrays when there were no tool calls
 * (a pure-conversational turn) — in which case the guard falls back to its
 * freeform numeric heuristic + entity checks with no claimed IDs.
 */
export function extractSourceContext(
  toolCallsExecuted: ReadonlyArray<ExecutedToolCall> | undefined | null,
): ExtractedSourceContext {
  const numbers = new Set<number>();
  const propertyIds = new Set<number>();
  const leadIds = new Set<number>();
  const dealIds = new Set<number>();

  if (toolCallsExecuted) {
    for (const call of toolCallsExecuted) {
      if (!call || call.result == null) continue;
      // Tool results are sometimes stringified JSON; parse opportunistically.
      let result: unknown = call.result;
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {
          // Not JSON — skip; we only mine structured results.
          continue;
        }
      }
      walk(result, { numbers, propertyIds, leadIds, dealIds }, 0, null);

      // Type the top-level rows by the tool that returned them.
      const entity = entityForTool(call.name);
      if (entity && result && typeof result === "object") {
        const data = (result as Record<string, unknown>).data ?? result;
        const rows = Array.isArray(data) ? data : [data];
        const target = entity === "lead" ? leadIds : entity === "deal" ? dealIds : propertyIds;
        for (const row of rows) {
          if (row && typeof row === "object" && !Array.isArray(row)) pushId(target, (row as Record<string, unknown>).id);
        }
      }
    }
  }

  return {
    sourceNumbers: Array.from(numbers),
    claimedPropertyIds: Array.from(propertyIds),
    claimedLeadIds: Array.from(leadIds),
    claimedDealIds: Array.from(dealIds),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// What the REPLY claims (Stage 2, 2026-10-07)
// ─────────────────────────────────────────────────────────────────────────────
//
// The guard used to verify the ids the TOOLS returned — which an org-scoped
// tool returns from the org by construction — and typed them by guessing from
// row columns. So it checked the wrong thing twice over: it never looked at
// the ids the REPLY names, and it checked lead ids against the properties
// table. Now:
//   - the ids a reply CLAIMS are read from the reply text, typed by the noun
//     next to them ("lead 39225", "property #12", "deal 4");
//   - a claimed id that a tool in this turn returned AS THAT TYPE is grounded;
//   - any other claimed id goes to the database check for its own type.
// And a COUNT about the customer's records must have a source this turn
// (H2: "6 leads have phone numbers but no email" with nothing read).

const ENTITY_REF_RE =
  /\b(lead|leads|property|properties|parcel|parcels|deal|deals)\s*(?:#|no\.?\s*|id\s*:?\s*)?\s*(\d{1,10})\b(?![.,]\d)(?!\s*(?:acres?|ac\b|%|years?|months?|days?|miles?|mi\b|ft\b|feet|sq))/gi;

export interface ClaimedEntityRefs {
  leadIds: number[];
  propertyIds: number[];
  dealIds: number[];
}

/** Entity ids a reply names, typed by the noun in front of them. */
export function extractClaimedEntityRefs(output: string): ClaimedEntityRefs {
  const lead = new Set<number>();
  const property = new Set<number>();
  const deal = new Set<number>();
  for (const m of String(output ?? "").matchAll(ENTITY_REF_RE)) {
    const noun = m[1].toLowerCase();
    const id = Number(m[2]);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (noun.startsWith("lead")) lead.add(id);
    else if (noun.startsWith("deal")) deal.add(id);
    else property.add(id);
  }
  return { leadIds: [...lead], propertyIds: [...property], dealIds: [...deal] };
}

/** Nouns that make "N <noun>" a claim about the customer's own records. */
const COUNT_NOUNS =
  "leads?|sellers?|buyers?|deals?|properties|parcels?|notes?|campaigns?|postcards?|letters?|texts?|emails?|messages?|replies|reply|payments?|tasks?|contacts?|credits?|members?|teammates?|users?|seats?";
/** Words allowed between the number and the noun ("6 new leads", "3 unread replies"). */
const COUNT_QUALIFIERS =
  "new|hot|warm|cold|active|open|unread|pending|overdue|late|other|more|total|seller|buyer|email|text|sms|mail|direct|unique|qualified|delinquent|tax-delinquent|dnc|opted-out|scheduled|completed|draft|sent|recent|remaining|available|current|existing|of|your|the|those|these";
const COUNT_RE = new RegExp(
  `(^|[^$#\\w.,])(\\d{1,3}(?:,\\d{3})+|\\d+)\\s+((?:(?:${COUNT_QUALIFIERS})\\s+){0,3})(${COUNT_NOUNS})\\b`,
  "gi",
);

export interface CountClaim {
  value: number;
  text: string;
}

/** "N <records>" claims in a reply. Dollar amounts, ids (#3) and decimals are not counts. */
export function extractCountClaims(output: string): CountClaim[] {
  const out: CountClaim[] = [];
  for (const m of String(output ?? "").matchAll(COUNT_RE)) {
    const value = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ value, text: `${m[2]} ${m[3] ?? ""}${m[4]}`.replace(/\s+/g, " ").trim() });
  }
  return out;
}

export interface CountGroundingContext {
  /** Integers that appeared anywhere in this turn's tool results (fields, strings, list sizes). */
  sourceCounts: number[];
  /** The largest list / total a tool returned this turn — a subset count can be at most this. */
  maxCollectionSize: number;
  /** Tool results this turn. Zero means nothing was read. */
  toolResultCount: number;
  /** Numbers the customer typed (a count they named is theirs to name back). */
  userNumbers: number[];
}

const COUNTISH_KEY_RE = /(count|total|length|size|recipients|number)/i;

function collectCounts(node: unknown, depth: number, key: string | null, counts: Set<number>, maxRef: { v: number }): void {
  if (node == null || depth > MAX_DEPTH + 2) return;
  if (Array.isArray(node)) {
    maxRef.v = Math.max(maxRef.v, node.length);
    counts.add(node.length);
    for (const item of node) collectCounts(item, depth + 1, key, counts, maxRef);
    return;
  }
  if (typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>);
    for (const [k, v] of entries) collectCounts(v, depth + 1, k, counts, maxRef);
    return;
  }
  if (typeof node === "number" && Number.isInteger(node) && node >= 0) {
    counts.add(node);
    if (key && COUNTISH_KEY_RE.test(key) && node < 1_000_000) maxRef.v = Math.max(maxRef.v, node);
    return;
  }
  if (typeof node === "string") {
    // "Total: 6 leads" in a summary string. Long digit runs (phones, ids in
    // text) are not counts, and are skipped.
    for (const m of node.matchAll(/(?<![\d+])(\d{1,3}(?:,\d{3})+|\d{1,6})(?!\d)/g)) {
      counts.add(Number(m[1].replace(/,/g, "")));
    }
  }
}

export function buildCountGroundingContext(
  toolCallsExecuted: ReadonlyArray<ExecutedToolCall> | undefined | null,
  userText: string | undefined | null,
): CountGroundingContext {
  const counts = new Set<number>();
  const maxRef = { v: 0 };
  let toolResultCount = 0;
  for (const call of toolCallsExecuted ?? []) {
    if (!call || call.result == null) continue;
    let result: unknown = call.result;
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        // a plain-text result still grounds the numbers it states
      }
    }
    toolResultCount += 1;
    collectCounts(result, 0, null, counts, maxRef);
  }
  const userNumbers = [...String(userText ?? "").matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)].map((m) =>
    Number(m[1].replace(/,/g, "")),
  );
  return { sourceCounts: [...counts], maxCollectionSize: maxRef.v, toolResultCount, userNumbers };
}

/**
 * Count claims with no support this turn. A count is supported when the
 * number was read (a field, a list size, a number in a returned string), when
 * the customer said it, or — when something WAS read — when it is a subset of
 * the largest list read (so "1 of your 6 leads is on DNC" stands after the 6
 * were read). With nothing read at all, every count about the customer's
 * records is unsupported: that is the H2 shape.
 */
export function findUngroundedCounts(output: string, ctx: CountGroundingContext): CountClaim[] {
  const source = new Set(ctx.sourceCounts);
  const user = new Set(ctx.userNumbers);
  return extractCountClaims(output).filter((c) => {
    if (user.has(c.value)) return false;
    if (ctx.toolResultCount === 0) return true;
    if (source.has(c.value)) return false;
    return c.value > ctx.maxCollectionSize;
  });
}

/**
 * Everything the guard needs from one Pax turn, in one call, so the streaming
 * and non-streaming paths cannot feed it differently.
 */
export function buildPaxGuardContext(params: {
  output: string;
  toolCallsExecuted: ReadonlyArray<ExecutedToolCall> | undefined | null;
  userText?: string | null;
}): {
  sourceNumbers?: number[];
  claimedLeadIds?: number[];
  claimedPropertyIds?: number[];
  claimedDealIds?: number[];
  countGrounding: CountGroundingContext;
} {
  const src = extractSourceContext(params.toolCallsExecuted);
  const claimed = extractClaimedEntityRefs(params.output);
  const groundedLead = new Set(src.claimedLeadIds);
  const groundedProperty = new Set(src.claimedPropertyIds);
  const groundedDeal = new Set(src.claimedDealIds);
  const ungrounded = (ids: number[], grounded: Set<number>) => ids.filter((id) => !grounded.has(id));
  const nonEmpty = (a: number[]) => (a.length > 0 ? a : undefined);
  return {
    sourceNumbers: nonEmpty(src.sourceNumbers),
    claimedLeadIds: nonEmpty(ungrounded(claimed.leadIds, groundedLead)),
    claimedPropertyIds: nonEmpty(ungrounded(claimed.propertyIds, groundedProperty)),
    claimedDealIds: nonEmpty(ungrounded(claimed.dealIds, groundedDeal)),
    countGrounding: buildCountGroundingContext(params.toolCallsExecuted, params.userText),
  };
}
