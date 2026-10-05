/**
 * List builder v0 (W10.3) — the client half of the county-records list
 * builder that lives INSIDE the Map door (no nav entry of its own).
 *
 * The shapes below mirror the W10.3 API contract exactly. They are declared
 * here rather than imported because the client never imports server code; the
 * server owns the truth of every number, and this file only carries it. In
 * particular NOTHING here computes a count, a cost, or a status label — the
 * sheet renders what the server answered, and an answer it did not get is an
 * error, never a zero.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError, generateIdempotencyKey, INLINE_ERROR_STATUSES_META } from "@/lib/queryClient";
import { COUNTY_SOURCE_WENT_DARK_MESSAGE } from "@shared/geo/countyStatus";

// ── Contract shapes ─────────────────────────────────────────────────

/** Mirrors `CountyListStatus` in shared/geo/countyStatus.ts (server-owned). */
export type CountyListStatus =
  | "covered"
  | "view_only"
  | "discovering"
  | "queued"
  | "unavailable"
  | "none";

export type ListOwnerType = "individual" | "entity" | "trust" | "estate";

export const LIST_OWNER_TYPES: ReadonlyArray<{ value: ListOwnerType; label: string }> = [
  { value: "individual", label: "Individual" },
  { value: "entity", label: "Entity (LLC, corp)" },
  { value: "trust", label: "Trust" },
  { value: "estate", label: "Estate" },
];

export interface ListBuilderCountyFilters {
  acreage: boolean;
  ownerType: boolean;
  yearsOwned: boolean;
}

export interface ListBuilderCounty {
  state: string;
  county: string;
  status: CountyListStatus;
  label: string;
  message: string;
  filters: ListBuilderCountyFilters;
}

export interface ListBuilderCountiesResponse {
  counties: ListBuilderCounty[];
}

/** The filter body shared by preview and commit. */
export interface ListBuilderRequest {
  state: string;
  county: string;
  acreageMin?: number;
  acreageMax?: number;
  ownerTypes?: ListOwnerType[];
  yearsOwnedMin?: number;
}

export interface ListBuilderSampleRow {
  apn: string | null;
  owner: string | null;
  acres: number | null;
  address: string | null;
}

export interface ListBuilderMailEstimate {
  pieceType: string;
  perPieceCents: number;
  totalCents: number;
}

/**
 * The five parts of a count. Each is null exactly when the records were not
 * read (tooLarge) — no figure is given, so none is shown. When read, the
 * server guarantees count === alreadyLeads + newLeads + suppressedDeleted +
 * skippedNoApn + skippedDuplicateApn; the client renders each part and adds
 * none of them up.
 */
export interface ListBuilderCountBreakdown {
  /** Parcels already in the org's leads — linked, not duplicated. */
  alreadyLeads: number | null;
  /** Parcels that would become new leads. */
  newLeads: number | null;
  /** Parcels whose only matching lead was DELETED — not re-added (it may carry an opt-out). */
  suppressedDeleted: number | null;
  /** Parcels with no APN — they cannot be deduped, so they are not saved. */
  skippedNoApn: number | null;
  /** Repeats of an APN already in this pull — saved once. */
  skippedDuplicateApn: number | null;
}

export interface ListBuilderPreview extends ListBuilderCountBreakdown {
  count: number;
  sample: ListBuilderSampleRow[];
  /** The source's required attribution line, rendered when present. */
  attribution: string | null;
  cost: {
    pullCredits: 0;
    source: string;
    mailEstimate: ListBuilderMailEstimate | null;
  };
  saveable: boolean;
  saveRefusal: string | null;
  maxPerList: number;
  tooLarge: boolean;
  status: CountyListStatus;
}

export interface ListBuilderCommitRequest extends ListBuilderRequest {
  name: string;
  expectedCount: number;
}

export interface ListBuilderCommitResult {
  listId: number;
  created: number;
  linkedExisting: number;
  total: number;
  suppressedDeleted: number | null;
  skippedNoApn: number | null;
  skippedDuplicateApn: number | null;
  attribution: string | null;
}

export interface ListBuilderListRow {
  id: number;
  name: string;
  state: string;
  county: string;
  total: number;
  createdAt: string;
}

export interface ListBuilderListsResponse {
  lists: ListBuilderListRow[];
  /** "bounded with a total" — present when the server reports it. */
  total?: number;
}

// ── Endpoints ───────────────────────────────────────────────────────

export const LIST_BUILDER_COUNTIES_URL = "/api/list-builder/counties";
export const LIST_BUILDER_PREVIEW_URL = "/api/list-builder/preview";
export const LIST_BUILDER_COMMIT_URL = "/api/list-builder/commit";
export const LIST_BUILDER_LISTS_URL = "/api/list-builder/lists";

/** Only these statuses may be picked: a live county source exists. */
export const CHOOSABLE_COUNTY_STATUSES: ReadonlySet<CountyListStatus> = new Set(["covered", "view_only"]);

export function isChoosableCounty(c: Pick<ListBuilderCounty, "status">): boolean {
  return CHOOSABLE_COUNTY_STATUSES.has(c.status);
}

/** A county nobody has asked for yet — the RequestCountyCTA flow applies. */
export function isRequestableCounty(c: Pick<ListBuilderCounty, "status">): boolean {
  return c.status === "none";
}

// ── Error reading ───────────────────────────────────────────────────

/**
 * The server's human message for a failed request — the `message` of the
 * standard `{ error, message, details?, statusCode }` body, falling back to the
 * ApiError text with its "400: " status prefix stripped.
 */
export function serverMessageOf(err: unknown): string | null {
  if (err instanceof ApiError) {
    const m = err.body?.message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  if (err instanceof Error && err.message) {
    const stripped = err.message.replace(/^\d{3}:\s*/, "").trim();
    return stripped || null;
  }
  return null;
}

export function statusOf(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

/** The standard error envelope's `error` code (e.g. "COUNTY_SOURCE_FAILED"), or null. */
export function errorCodeOf(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.error;
  return typeof code === "string" && code ? code : null;
}

/**
 * The server ANSWERED that the save did not happen: a 4xx refusal (bad input,
 * count drift, a structural refusal, a plan or rate limit — all refused before
 * anything is written), or the contract's 502 COUNTY_SOURCE_FAILED (the
 * county source failed to answer the re-count, so nothing was written).
 *
 * Anything else — no HTTP status at all (timeout, dropped connection), or a
 * 5xx that is not that typed refusal (a proxy's 502/504, a crash after the
 * transaction committed) — is UNCONFIRMED: the save may have landed behind it.
 */
export function commitDefinitelyNotSaved(err: unknown): boolean {
  const status = statusOf(err);
  if (status === null) return false;
  if (status >= 400 && status < 500) return true;
  return status === 502 && errorCodeOf(err) === "COUNTY_SOURCE_FAILED";
}

/** A transient failure where "try again" is honest advice: the county source failed, or no answer came back. */
export function isTransientListBuilderFailure(err: unknown): boolean {
  const status = statusOf(err);
  return status === null || status === 502;
}

/**
 * The fresh count a 409 carries. The contract says `409 { count }`; when the
 * server sends it through the standard error envelope it lands in `details`.
 * Both are read; anything else is `null` (unknown), never a guess.
 */
export function conflictCountOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as unknown as { count?: unknown; details?: unknown } | null;
  const direct = body?.count;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const details = body?.details as { count?: unknown } | undefined;
  if (details && typeof details.count === "number" && Number.isFinite(details.count)) return details.count;
  return null;
}

// ── Hooks ───────────────────────────────────────────────────────────

export function listBuilderCountiesKey(state: string) {
  return [LIST_BUILDER_COUNTIES_URL, state] as const;
}

export function useListBuilderCounties(state: string | null) {
  return useQuery<ListBuilderCountiesResponse>({
    queryKey: listBuilderCountiesKey(state ?? ""),
    enabled: !!state,
    queryFn: async () => {
      const res = await apiRequest("GET", `${LIST_BUILDER_COUNTIES_URL}?state=${encodeURIComponent(state ?? "")}`);
      return (await res.json()) as ListBuilderCountiesResponse;
    },
    retry: false,
  });
}

export function useListBuilderLists() {
  return useQuery<ListBuilderListsResponse>({
    queryKey: [LIST_BUILDER_LISTS_URL],
    queryFn: async () => {
      const res = await apiRequest("GET", LIST_BUILDER_LISTS_URL);
      return (await res.json()) as ListBuilderListsResponse;
    },
    retry: false,
  });
}

/**
 * Preview and commit read a county's own GIS service — a count, a sample, and
 * (up to maxPerList) every matching record, page by page, each page with its
 * own server-side timeout. That legitimately outlasts the app-wide 30s
 * ceiling, and a client that gives up first reports a failure the server did
 * not have (and, on commit, a save it cannot see). Two minutes.
 */
export const LIST_BUILDER_TIMEOUT_MS = 120_000;

/**
 * The statuses the sheet renders INLINE, in the server's own words — the
 * global mutation-error toast stays quiet for them (one message, in one
 * place). 403 is a member without the import permission or scope: the sheet
 * already shows that refusal inline like any other 4xx. A 502, a 5xx, or no
 * answer still toasts.
 */
export const LIST_BUILDER_INLINE_STATUSES: readonly number[] = [400, 403, 409, 422, 429];
const INLINE_META = { [INLINE_ERROR_STATUSES_META]: LIST_BUILDER_INLINE_STATUSES };

/** JSON with object keys sorted, so the same request always serialises the same way. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 53-bit string hash (cyrb53), seeded. Not cryptographic — the key is an opaque dedupe token, org-scoped server-side. */
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * One nonce per preview RESULT, minted when it arrives (keyed by the result
 * object itself). Every new preview — even of identical filters returning an
 * identical count — is a new object and so a new nonce; retrying or
 * double-clicking the save of the preview on screen reuses it.
 */
const previewNonces = new WeakMap<ListBuilderPreview, string>();

/** The nonce of the preview a save is made from (minted on first ask if it did not come through the hook). */
export function previewNonceOf(preview: ListBuilderPreview): string {
  let nonce = previewNonces.get(preview);
  if (!nonce) {
    nonce = generateIdempotencyKey();
    previewNonces.set(preview, nonce);
  }
  return nonce;
}

/**
 * The commit's Idempotency-Key: a hash of { the previewed request, the name,
 * expectedCount, the PREVIEW's nonce } — so the same save of the same preview
 * retried (a timeout, a double click) is the same key and the server replays
 * its first answer instead of building a second list, while any different
 * save (another name, other filters, a re-previewed count) is a different key.
 *
 * The nonce is load-bearing (W10.3 second audit): the server caches a
 * finished save for 24h, so a key made of the request alone would replay a
 * save whose list was since DELETED — "Saved N leads" with a dead link and
 * nothing written. A fresh preview is a fresh intent, so a fresh key.
 */
export function listBuilderCommitIdempotencyKey(body: ListBuilderCommitRequest, previewNonce: string): string {
  const { name, expectedCount, ...request } = body;
  const material = canonicalJson({ request, name, expectedCount, previewNonce });
  return `list-builder-commit:${cyrb53(material, 1)}${cyrb53(material, 2)}`;
}

export function useListBuilderPreview() {
  // allow-no-invalidation: a preview reads the county source and writes nothing
  return useMutation<ListBuilderPreview, unknown, ListBuilderRequest>({
    meta: INLINE_META,
    mutationFn: async (body) => {
      const res = await apiRequest("POST", LIST_BUILDER_PREVIEW_URL, body, { timeoutMs: LIST_BUILDER_TIMEOUT_MS });
      const preview = (await res.json()) as ListBuilderPreview;
      previewNonces.set(preview, generateIdempotencyKey());
      return preview;
    },
  });
}

/** A save: the body sent, and the nonce of the preview it was made from (sent only inside the key). */
export interface ListBuilderCommitVariables {
  body: ListBuilderCommitRequest;
  previewNonce: string;
}

export function useListBuilderCommit() {
  const qc = useQueryClient();
  return useMutation<ListBuilderCommitResult, unknown, ListBuilderCommitVariables>({
    meta: INLINE_META,
    mutationFn: async ({ body, previewNonce }) => {
      const res = await apiRequest("POST", LIST_BUILDER_COMMIT_URL, body, {
        idempotencyKey: listBuilderCommitIdempotencyKey(body, previewNonce),
        timeoutMs: LIST_BUILDER_TIMEOUT_MS,
      });
      return (await res.json()) as ListBuilderCommitResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [LIST_BUILDER_LISTS_URL] });
      // New and linked leads — every leads view prefix-matches "/api/leads".
      void qc.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err) => {
      // An unconfirmed save may have landed: re-read what IS saved so "Your
      // lists" answers the question the error can't, and the leads views too.
      if (!commitDefinitelyNotSaved(err)) {
        void qc.invalidateQueries({ queryKey: [LIST_BUILDER_LISTS_URL] });
        void qc.invalidateQueries({ queryKey: ["/api/leads"] });
      }
    },
  });
}

/**
 * A county whose source WENT DARK can be requested again — the coverage
 * route's rule. The sheet does not infer it: the server says so in its
 * message, which for that case is exactly COUNTY_SOURCE_WENT_DARK_MESSAGE
 * (shared/geo/countyStatus.ts). An `unavailable` county that was searched and
 * yielded nothing says something else, and offers no re-request.
 */
export function isReRequestableCounty(c: Pick<ListBuilderCounty, "status" | "message">): boolean {
  return c.status === "unavailable" && c.message === COUNTY_SOURCE_WENT_DARK_MESSAGE;
}

/** `/leads?listId=<id>` — the leads view of one saved list. */
export function leadsHrefForList(listId: number): string {
  return `/leads?listId=${encodeURIComponent(String(listId))}`;
}

/** Parse `?listId=` from a search string; anything but a positive integer is null. */
export function listIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("listId");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── States ──────────────────────────────────────────────────────────

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];
