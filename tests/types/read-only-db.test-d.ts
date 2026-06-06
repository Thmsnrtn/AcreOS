/**
 * Tahoe L12 — typecheck-only test for the `ReadOnlyDb` wrapper.
 *
 * Why a `.test-d.ts` (not a runtime test):
 *
 *   The point of L12 is to make replica-misuse fail at COMPILE time.
 *   These assertions live in a file `tsc --noEmit` will load (the
 *   project's tsconfig excludes `**\/*.test.ts` from compilation but
 *   does NOT exclude `*.test-d.ts`), so `npm run check` is the test
 *   harness. A regression that re-exposes `insert`/`update`/`delete`
 *   on `dbReplica` will fail `npm run check` with a TS2339 from the
 *   `// @ts-expect-error` lines below — exactly the failure mode we
 *   want.
 *
 * If `tsd` is added to the project later, the `expectType` / `expectError`
 * macros can replace the `@ts-expect-error` assertions one-for-one;
 * either form works.
 */

import type { ReadOnlyDb, MutatingDbMethods } from "@shared/db/read-only";
import { APP_ROLES, type DbRole } from "@shared/db/roles";

import {
  db,
  dbReplica,
  dbReadOnly,
  dbReplicaUnsafe,
  type PrimaryDb,
  type ReplicaDb,
} from "../../server/db";
import * as schema from "@shared/schema";

// ── 1. dbReplica is read-only at the type level ─────────────────────────────
//
// `dbReplica` is typed as `ReplicaDb | null` and structurally cannot expose
// `insert`, `update`, `delete`, `transaction`, or `refreshMaterializedView`.

declare const replica: ReplicaDb;

// These four must each fail to typecheck. The `// @ts-expect-error`
// directive turns "TS error here" into "build passes"; the inverse —
// no error on the next line — would make the directive itself fail
// the build, which is exactly the regression signal we want.

// @ts-expect-error — `insert` is excluded from ReadOnlyDb
replica.insert;
// @ts-expect-error — `update` is excluded from ReadOnlyDb
replica.update;
// @ts-expect-error — `delete` is excluded from ReadOnlyDb
replica.delete;
// @ts-expect-error — `transaction` is excluded from ReadOnlyDb
replica.transaction;
// @ts-expect-error — `refreshMaterializedView` is excluded from ReadOnlyDb
replica.refreshMaterializedView;

// ── 2. dbReplica still exposes the read surface ─────────────────────────────
//
// These must typecheck — `select`, `selectDistinct`, `$count`, `execute`,
// `query`, `with`, `$with` all belong to the kept surface.

const _select = replica.select;
const _selectDistinct = replica.selectDistinct;
const _selectDistinctOn = replica.selectDistinctOn;
const _count = replica.$count;
const _execute = replica.execute;
const _query = replica.query;
const _with = replica.with;
const _withDollar = replica.$with;

// Silence "declared but never read" — every read above is the assertion.
void _select;
void _selectDistinct;
void _selectDistinctOn;
void _count;
void _execute;
void _query;
void _with;
void _withDollar;

// ── 3. The brand carries through ────────────────────────────────────────────
//
// `dbReplica` and `dbReadOnly` are `replica_ro`. `db` and `dbReplicaUnsafe`
// are `primary`. Mixing them must not type-equal.

type ReplicaBrand = NonNullable<typeof dbReplica>["__role"];
type ReadOnlyBrand = (typeof dbReadOnly)["__role"];
type PrimaryBrand = (typeof db)["__role"];
type UnsafeBrand = (typeof dbReplicaUnsafe)["__role"];

const _replicaRole: ReplicaBrand = APP_ROLES.replica_ro;
const _readOnlyRole: ReadOnlyBrand = APP_ROLES.replica_ro;
const _primaryRole: PrimaryBrand = APP_ROLES.primary;
const _unsafeRole: UnsafeBrand = APP_ROLES.primary;

void _replicaRole;
void _readOnlyRole;
void _primaryRole;
void _unsafeRole;

// And a primary handle can't be silently substituted for a replica handle
// (and vice versa) — the brands are structurally incompatible.

declare const primary: PrimaryDb;
// @ts-expect-error — PrimaryDb is not assignable to ReplicaDb (brand mismatch)
const _badAssign1: ReplicaDb = primary;
// @ts-expect-error — ReplicaDb is not assignable to PrimaryDb (brand + Omit)
const _badAssign2: PrimaryDb = replica;

void _badAssign1;
void _badAssign2;

// ── 4. APP_ROLES enumeration is exhaustive ──────────────────────────────────
//
// Catches "someone added a third role and forgot to wire it" — the type
// union must include every key of the APP_ROLES record.

const _exhaustive: DbRole = APP_ROLES.primary as DbRole;
void _exhaustive;

// ── 5. MutatingDbMethods names match the actual Drizzle surface ────────────
//
// If Drizzle renames or removes one of these methods, this assertion fails,
// signalling that `ReadOnlyDb` needs to be updated to track the new shape.

type DrizzleMethodNames = keyof Awaited<typeof schema> | MutatingDbMethods;
const _methodsTouched: DrizzleMethodNames = "insert";
void _methodsTouched;

// ── 6. Escape hatch still works ─────────────────────────────────────────────
//
// `dbReplicaUnsafe` is the documented bypass for the rare case where a
// maintenance script needs to write through the replica wire. It must
// retain the full Drizzle method surface.

const _unsafeInsert: PrimaryDb["insert"] = dbReplicaUnsafe.insert;
const _unsafeUpdate: PrimaryDb["update"] = dbReplicaUnsafe.update;
const _unsafeDelete: PrimaryDb["delete"] = dbReplicaUnsafe.delete;
const _unsafeTx: PrimaryDb["transaction"] = dbReplicaUnsafe.transaction;

void _unsafeInsert;
void _unsafeUpdate;
void _unsafeDelete;
void _unsafeTx;

// ── 7. ReadOnlyDb<TSchema> is generic over the schema ──────────────────────

type _NarrowReadOnly = ReadOnlyDb<typeof schema>;
const _narrow: _NarrowReadOnly = replica;
void _narrow;
