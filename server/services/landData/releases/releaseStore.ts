/**
 * The release store — D2b §3 (tables approved 2026-10-25, migration 0290).
 *
 * The ONE reader and writer of dataset_releases and dataset_release_pointer.
 * Everything here delegates the rules to the pure core (releaseManifest,
 * releasePointer): this module only moves rows.
 *
 *   storeRelease       validate → content id → INSERT … ON CONFLICT DO NOTHING
 *                      (the same content is the same release: idempotent)
 *   loadRelease        SELECT, then re-derive the id from the stored manifest —
 *                      a row whose manifest no longer hashes to its id THROWS
 *   loadPointerHistory the append-only history, in seq order
 *   movePointer        load history + catalog → pure promote/rollback → INSERT
 *                      the one new entry; a concurrent mover wins the PK race
 *                      and this one retries once from a fresh read
 *   readReleaseInventory the rows D2g's /api/ops/data inventory reads
 *
 * Both tables are global platform data (no organization_id).
 */

import { asc, eq, sql } from "drizzle-orm";
import { datasetReleasePointer, datasetReleases } from "@shared/schema";
import { DATASET, releaseIdOf, summarizeRelease, validateManifest, verifyReleaseId, type ReleaseManifest } from "./releaseManifest";
import { currentRelease, promote, rollback, type PointerEntry, type PointerHistory, type PointerMove } from "./releasePointer";

async function conn() {
  return (await import("../../../db")).db;
}

export interface StoredRelease {
  releaseId: string;
  /** False when a release with this exact content already existed. */
  created: boolean;
}

/** Store a release (idempotent on content). Refuses an invalid manifest. */
export async function storeRelease(manifest: ReleaseManifest, createdBy: string): Promise<StoredRelease> {
  const check = validateManifest(manifest);
  if (!check.ok) throw new Error(`refused: invalid release manifest — ${check.errors.join("; ")}`);
  if (!createdBy.trim()) throw new Error("refused: a release needs the actor that assembled it");
  const releaseId = releaseIdOf(check.manifest);
  const summary = summarizeRelease(check.manifest);
  const db = await conn();
  const inserted = await db
    .insert(datasetReleases)
    .values({
      releaseId,
      dataset: check.manifest.dataset,
      manifestFormat: check.manifest.format,
      manifest: check.manifest as unknown as Record<string, unknown>,
      countyCount: summary.countyCount,
      parcelCount: summary.parcelCount,
      artifactBytes: summary.artifactBytes,
      createdBy,
    })
    .onConflictDoNothing({ target: datasetReleases.releaseId })
    .returning({ releaseId: datasetReleases.releaseId });
  return { releaseId, created: inserted.length === 1 };
}

/** Load and VERIFY a release: a stored manifest that no longer hashes to its id is refused. */
export async function loadRelease(releaseId: string): Promise<ReleaseManifest | null> {
  const db = await conn();
  const [row] = await db.select().from(datasetReleases).where(eq(datasetReleases.releaseId, releaseId)).limit(1);
  if (!row) return null;
  const verified = verifyReleaseId(row.releaseId, row.manifest);
  if (!verified.ok) throw new Error(`release ${releaseId} failed verification: ${verified.reason}`);
  const check = validateManifest(row.manifest);
  if (!check.ok) throw new Error(`release ${releaseId} holds an invalid manifest: ${check.errors.join("; ")}`);
  return check.manifest;
}

/** The pointer history for a dataset, oldest first. */
export async function loadPointerHistory(dataset: string = DATASET): Promise<PointerHistory> {
  const db = await conn();
  const rows = await db
    .select({
      seq: datasetReleasePointer.seq,
      action: datasetReleasePointer.action,
      releaseId: datasetReleasePointer.releaseId,
      releaseName: datasetReleasePointer.releaseName,
      previousReleaseId: datasetReleasePointer.previousReleaseId,
      at: datasetReleasePointer.at,
      actor: datasetReleasePointer.actor,
      reason: datasetReleasePointer.reason,
    })
    .from(datasetReleasePointer)
    .where(eq(datasetReleasePointer.dataset, dataset))
    .orderBy(asc(datasetReleasePointer.seq));
  return rows.map(
    (r): PointerEntry => ({
      seq: r.seq,
      action: r.action,
      releaseId: r.releaseId,
      releaseName: r.releaseName,
      previousReleaseId: r.previousReleaseId,
      at: r.at.toISOString(),
      actor: r.actor,
      reason: r.reason,
    }),
  );
}

export type PointerRequest = { kind: "promote"; releaseId: string } | { kind: "rollback"; toReleaseId?: string };

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string } | null)?.code === "23505";

/**
 * Move the pointer: promote a stored release (minting its name) or roll back
 * to one that was current before. The pure core decides; this inserts the one
 * entry it produced. Returns the new entry.
 */
export async function movePointer(req: PointerRequest, move: PointerMove, dataset: string = DATASET): Promise<PointerEntry> {
  for (let attempt = 0; ; attempt++) {
    const db = await conn();
    const history = await loadPointerHistory(dataset);
    const catalog = new Set((await db.select({ id: datasetReleases.releaseId }).from(datasetReleases).where(eq(datasetReleases.dataset, dataset))).map((r) => r.id));
    const { entry } = req.kind === "promote" ? promote(history, req.releaseId, move, catalog) : rollback(history, move, req.toReleaseId);
    try {
      await db.insert(datasetReleasePointer).values({
        dataset,
        seq: entry.seq,
        action: entry.action,
        releaseId: entry.releaseId,
        releaseName: entry.releaseName,
        previousReleaseId: entry.previousReleaseId,
        at: new Date(entry.at),
        actor: entry.actor,
        reason: entry.reason,
      });
      return entry;
    } catch (err) {
      // Another mover took this seq: decide again from what it wrote.
      if (isUniqueViolation(err) && attempt === 0) continue;
      throw err;
    }
  }
}

export interface ReleaseInventoryRecord {
  releaseId: string;
  /** The promoted name (`acreos-parcels vYYYY.MM.N`); null for a release never promoted. */
  name: string | null;
  createdAt: string;
  current: boolean;
  countyCount: number;
  parcelCount: number;
}

/** Every stored release with its name (from the pointer history) and whether it is current. */
export async function readReleaseInventory(dataset: string = DATASET): Promise<ReleaseInventoryRecord[]> {
  const db = await conn();
  const [rows, history] = await Promise.all([
    db
      .select({ releaseId: datasetReleases.releaseId, createdAt: datasetReleases.createdAt, countyCount: datasetReleases.countyCount, parcelCount: datasetReleases.parcelCount })
      .from(datasetReleases)
      .where(eq(datasetReleases.dataset, dataset))
      .orderBy(sql`${datasetReleases.createdAt} DESC`),
    loadPointerHistory(dataset),
  ]);
  const names = new Map(history.filter((e) => e.action === "promote").map((e) => [e.releaseId, e.releaseName]));
  const cur = currentRelease(history);
  return rows.map((r) => ({
    releaseId: r.releaseId,
    name: names.get(r.releaseId) ?? null,
    createdAt: r.createdAt.toISOString(),
    current: cur?.releaseId === r.releaseId,
    countyCount: r.countyCount,
    parcelCount: r.parcelCount,
  }));
}
