// ============================================================================
// server/utils/secretColumns.ts — the columns whose values stay on the server.
// ----------------------------------------------------------------------------
// One registry, read by two consumers:
//
//   1. `stripSecretColumns()` — called by the response guard
//      (server/middleware/secretColumnGuard.ts), which every JSON response
//      passes through. It removes these keys from serialized rows, so a
//      handler that sends a whole row, a spread of one, a join, or an audit
//      snapshot of one still serves none of them.
//   2. `omitSecretColumns()` — the handler-level projection for a known row
//      (e.g. the lead routes), so the primary routes are clean at the source
//      and the guard is the population-wide backstop rather than the only
//      line.
//
// Every entry is built from the Drizzle table object and a key that must be
// one of its columns, so a renamed or dropped column is a type error here and
// a thrown error at load. `tests/unit/secretColumnRegistry.test.ts` walks
// every pgTable in the schema and fails when a column whose name or schema
// comment marks it as ciphertext / credential material is neither registered
// here nor recorded as reviewed — a new ciphertext column cannot land
// unregistered.
//
// MATCH MODES
//   "anywhere" — the key name is specific to secret material (e.g.
//                `taxIdEncrypted`, `payerEncryptedTin`); it is removed from
//                every plain object in a response, whatever its shape. This
//                also covers partial selects and nested snapshots.
//   "row"      — the key name is generic (`accessToken`, `token`,
//                `taxIdType`) and is legitimately served elsewhere under the
//                same name; it is removed only from an object shaped like a
//                row of the entry's table (see `looksLikeRowOf`).
//
// Server-side readers (1099/1098 generation, bookkeeping, connectors) read
// these columns from the database directly and are unaffected.
// ============================================================================

import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  leads,
  organizations,
  contractors,
  acquiredNotes,
  integrationCredentials,
  platformConfig,
  browserSessionCredentials,
  byokCredentials,
  platformConnections,
  paxConnectorInstances,
  orgEmailIdentities,
  titlePartners,
  titleOrders,
  founderDocuments,
  founderIncomeSources,
  founderTaxReturns,
  founderEstimatedPayments,
  founderAdAccounts,
  webhookSubscriptions,
  systemApiKeys,
  orgApiKeys,
  apiKeys,
  users,
  borrowerSessions,
  notes,
  organizationInvitations,
  unsubscribeTokens,
  reactivationTokens,
  dsarRequests,
} from "@shared/schema";
import { isEncrypted } from "../services/fieldEncryption";

export type SecretKind =
  /** An encrypted envelope (or a column documented as holding one). */
  | "ciphertext"
  /** Tax-identity metadata of a recipient that no client surface reads. */
  | "tax-identity"
  /** Live credential material: tokens, keys, signing secrets. */
  | "credential"
  /** A hash or hint that verifies a credential. */
  | "verifier";

export type SecretMatch = "anywhere" | "row";

export interface SecretColumn {
  /** SQL table name. */
  readonly table: string;
  /** The JS property name a serialized row carries. */
  readonly key: string;
  /** SQL column name. */
  readonly column: string;
  readonly kind: SecretKind;
  readonly match: SecretMatch;
}

/** An entry plus the Drizzle table it was built from (module-private). */
interface Entry extends SecretColumn {
  readonly source: PgTable;
}

function secret<T extends PgTable>(
  table: T,
  key: keyof T["$inferSelect"] & string,
  kind: SecretKind,
  match: SecretMatch,
): Entry {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const col = cols[key];
  if (!col) throw new Error(`secretColumns: ${getTableName(table)} has no column ${key}`);
  return { table: getTableName(table), key, column: col.name, kind, match, source: table };
}

const ENTRIES: readonly Entry[] = Object.freeze([
  // ── Tax identity ──────────────────────────────────────────────────────────
  secret(leads, "taxId", "ciphertext", "anywhere"),
  secret(leads, "taxIdType", "tax-identity", "row"),
  secret(organizations, "ein", "ciphertext", "anywhere"),
  secret(contractors, "taxIdEncrypted", "ciphertext", "anywhere"),
  secret(acquiredNotes, "payerEncryptedTin", "ciphertext", "anywhere"),

  // ── Encrypted credential stores ───────────────────────────────────────────
  secret(integrationCredentials, "encryptedValue", "ciphertext", "anywhere"),
  secret(platformConfig, "encryptedValue", "ciphertext", "anywhere"),
  secret(browserSessionCredentials, "encryptedData", "ciphertext", "anywhere"),
  secret(byokCredentials, "credentialKeyEncrypted", "ciphertext", "anywhere"),
  secret(platformConnections, "secretEncrypted", "ciphertext", "anywhere"),
  secret(paxConnectorInstances, "credentialsEncrypted", "ciphertext", "anywhere"),
  secret(orgEmailIdentities, "dkimPrivateKeyEncrypted", "ciphertext", "anywhere"),
  secret(titlePartners, "hmacSecretEncrypted", "ciphertext", "anywhere"),

  // ── Founder personal-finance vault ────────────────────────────────────────
  secret(founderDocuments, "encryptedBlob", "ciphertext", "anywhere"),
  secret(founderIncomeSources, "encryptedAmount", "ciphertext", "anywhere"),
  secret(founderIncomeSources, "encryptedFederalWithheld", "ciphertext", "anywhere"),
  secret(founderIncomeSources, "encryptedStateWithheld", "ciphertext", "anywhere"),
  secret(founderTaxReturns, "encryptedPayload", "ciphertext", "anywhere"),
  secret(founderTaxReturns, "encryptedFederalTotalTax", "ciphertext", "anywhere"),
  secret(founderTaxReturns, "encryptedFederalRefundOrOwed", "ciphertext", "anywhere"),
  secret(founderTaxReturns, "encryptedStateTotalTax", "ciphertext", "anywhere"),
  secret(founderTaxReturns, "encryptedStateRefundOrOwed", "ciphertext", "anywhere"),
  secret(founderEstimatedPayments, "encryptedAmountPaid", "ciphertext", "anywhere"),

  // Sealed since DEFECT-0054 (rows written before it hold the value as-is
  // until their next save).
  secret(founderAdAccounts, "accessToken", "ciphertext", "row"),
  secret(founderAdAccounts, "appSecret", "ciphertext", "anywhere"),

  // ── Credential material stored as-is ──────────────────────────────────────
  // The v1 API reveals a new subscription's secret once, under its own
  // snake_case field (server/api-v1/serializers.ts); the row key never ships.
  secret(webhookSubscriptions, "signingSecret", "credential", "anywhere"),
  secret(systemApiKeys, "apiKey", "credential", "row"),
  secret(users, "passwordResetToken", "credential", "anywhere"),
  secret(borrowerSessions, "sessionToken", "credential", "row"),
  secret(notes, "accessToken", "credential", "row"),
  secret(organizationInvitations, "token", "credential", "row"),
  secret(unsubscribeTokens, "token", "credential", "row"),
  secret(dsarRequests, "verificationToken", "credential", "row"),

  // ── Credential verifiers ──────────────────────────────────────────────────
  secret(systemApiKeys, "keyHash", "verifier", "anywhere"),
  secret(orgApiKeys, "keyHash", "verifier", "anywhere"),
  secret(apiKeys, "hashedKey", "verifier", "anywhere"),
  secret(titlePartners, "apiKeyHash", "verifier", "anywhere"),
  secret(organizationInvitations, "inviteTokenHash", "verifier", "anywhere"),
  secret(reactivationTokens, "tokenHash", "verifier", "anywhere"),
  secret(titleOrders, "wireInstructionsPasswordHint", "verifier", "anywhere"),
]);

export const SECRET_COLUMNS: readonly SecretColumn[] = Object.freeze(
  ENTRIES.map(({ source: _source, ...entry }) => Object.freeze(entry)),
);

// ── Matching ──────────────────────────────────────────────────────────────

/**
 * Keys nearly every table carries. They say nothing about WHICH table an
 * object is a row of, so they are left out of every row signature.
 */
const UNIVERSAL_KEYS = new Set([
  "id",
  "organizationId",
  "orgId",
  "userId",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "status",
  "name",
  "type",
  "metadata",
]);

/** Fraction of a table's signature keys an object must carry to be its row. */
const ROW_MATCH_RATIO = 0.5;

/**
 * Group the registry by a key. The lookups below are built once from
 * SECRET_COLUMNS — the same list the completeness test checks — and never
 * written again.
 */
function groupBy(
  entries: readonly SecretColumn[],
  by: (e: SecretColumn) => string,
): ReadonlyMap<string, readonly SecretColumn[]> {
  const out = new Map<string, SecretColumn[]>();
  for (const e of entries) out.set(by(e), [...(out.get(by(e)) ?? []), e]);
  return out;
}

const ANYWHERE = groupBy(SECRET_COLUMNS.filter((e) => e.match === "anywhere"), (e) => e.key);
const ROW = groupBy(SECRET_COLUMNS.filter((e) => e.match === "row"), (e) => e.key);
const BY_TABLE = groupBy(SECRET_COLUMNS, (e) => e.table);

/** Per registered table: its columns minus the universal keys and minus its registered secrets. */
const SIGNATURE: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  ENTRIES.map((e) => {
    const registered = new Set((BY_TABLE.get(e.table) ?? []).map((r) => r.key));
    const keys = Object.keys(getTableColumns(e.source));
    return [e.table, new Set(keys.filter((k) => !UNIVERSAL_KEYS.has(k) && !registered.has(k)))] as const;
  }),
);

/**
 * True when `obj` carries at least ROW_MATCH_RATIO of the table's signature
 * keys (its columns minus the universal ones and minus its registered
 * secrets), and never fewer than two of them. A full row, a spread of one
 * (`{ ...lead, score }`) and a wide select all qualify; a narrow projection
 * that merely shares a generic key name does not.
 */
function looksLikeRowOf(obj: Record<string, unknown>, table: string): boolean {
  const sig = SIGNATURE.get(table);
  if (!sig || sig.size === 0) return false;
  const need = Math.min(sig.size, Math.max(2, Math.ceil(sig.size * ROW_MATCH_RATIO)));
  let have = 0;
  for (const k of sig) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      have += 1;
      if (have >= need) return true;
    }
  }
  return false;
}

export interface StrippedKey {
  /** Registered table, or "envelope" for a value carrying the encryption prefix. */
  readonly table: string;
  readonly key: string;
  /** Where in the payload, e.g. `data[3].taxId` or `lead.ein`. */
  readonly path: string;
}

export interface StripResult<T> {
  readonly value: T;
  readonly stripped: readonly StrippedKey[];
  /** Subtrees not walked (cycle or depth cap). Counted, never silently skipped. */
  readonly unwalked: number;
}

/** Deeper than this, a subtree is counted as unwalked. */
const MAX_WALK_DEPTH = 48;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Remove registered secret keys from a response payload.
 *
 * Copy-on-write: the input is never mutated (handlers and caches may still
 * hold the same row server-side), and an unchanged subtree is returned by
 * reference. Arrays and plain objects are walked; class instances (Date,
 * Buffer, …) are leaves. Any string property whose value carries the
 * canonical encryption-envelope prefix is removed too, whatever its key —
 * ciphertext inside a jsonb column is not a column the registry can name.
 */
export function stripSecretColumns<T>(payload: T): StripResult<T> {
  const stripped: StrippedKey[] = [];
  let unwalked = 0;
  const onPath = new Set<unknown>();

  const walk = (v: unknown, path: string, depth: number): unknown => {
    if (v === null || typeof v !== "object") return v;
    const isArr = Array.isArray(v);
    if (!isArr && !isPlainObject(v)) return v;
    if (depth > MAX_WALK_DEPTH || onPath.has(v)) {
      unwalked += 1;
      return v;
    }
    onPath.add(v);
    try {
      if (isArr) {
        const arr = v as unknown[];
        let out: unknown[] | null = null;
        for (let i = 0; i < arr.length; i++) {
          const next = walk(arr[i], `${path}[${i}]`, depth + 1);
          if (next !== arr[i]) {
            out ??= arr.slice();
            out[i] = next;
          }
        }
        return out ?? arr;
      }
      const obj = v as Record<string, unknown>;
      let out: Record<string, unknown> | null = null;
      const keys = Object.keys(obj);
      for (const key of keys) {
        const val = obj[key];
        const at = path ? `${path}.${key}` : key;
        const hit = matchKey(obj, key, val);
        if (hit) {
          out ??= { ...obj };
          delete out[key];
          stripped.push({ table: hit, key, path: at });
          continue;
        }
        const next = walk(val, at, depth + 1);
        if (next !== val) {
          out ??= { ...obj };
          out[key] = next;
        }
      }
      return out ?? obj;
    } finally {
      onPath.delete(v);
    }
  };

  const value = walk(payload, "", 0) as T;
  return { value, stripped, unwalked };
}

/** The table a key is stripped for, or null to keep it. */
function matchKey(obj: Record<string, unknown>, key: string, val: unknown): string | null {
  if (val === undefined) return null; // JSON.stringify drops it anyway
  const anywhere = ANYWHERE.get(key);
  if (anywhere) return anywhere[0]!.table;
  const row = ROW.get(key);
  if (row) {
    for (const entry of row) if (looksLikeRowOf(obj, entry.table)) return entry.table;
  }
  if (isEncrypted(val)) return "envelope";
  return null;
}

/**
 * A copy of `row` without the table's registered secret keys — the
 * handler-level projection for a row whose table is known.
 */
export function omitSecretColumns<T extends object>(table: PgTable, row: T): T {
  const entries = BY_TABLE.get(getTableName(table)) ?? [];
  if (entries.length === 0) return row;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const e of entries) delete out[e.key];
  return out as T;
}
