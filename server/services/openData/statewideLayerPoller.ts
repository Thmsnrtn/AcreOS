/**
 * Statewide layer change-detection poller — D1c, with the A4 history.
 *
 * For every seeded statewide parcel service, two cheap metadata calls — the
 * layer JSON (editingInfo.lastEditDate, the response ETag) and a count-only
 * query — never a feature page. Each run's snapshots are its OBSERVATION
 * (etl_runs.observation, written once at completion), so the job's runs are
 * an append-only metadata-snapshot series per source from the first run: the
 * seed of the change-history asset (amendment A4). Detection and reporting
 * only — re-ingest on change is D3.
 *
 * Drift is reported per source, and only what can be said honestly:
 *  - changedSinceLastPoll — lastEditDate (or, when a server publishes none,
 *    the row count) differs from the previous successful snapshot; null on
 *    the first run or when neither poll read it;
 *  - changedSinceIngest   — lastEditDate is after the source's last confirmed
 *    ingest; null while nothing was ever ingested (today, everywhere: no
 *    bucket is provisioned);
 *  - overdueVsCadence     — older than the documented cadence allows; null
 *    where the program documents no cadence (statewideSourceRegistry.ts).
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { etlJobs, etlRuns } from "@shared/schema";
import { STATEWIDE_PARCEL_ENDPOINTS, type StatewideParcelEndpointSeed } from "../statewideParcelEndpoints";
import { overdueVsCadence, statewideSource, type DocumentedCadence } from "./statewideSourceRegistry";

export const STATEWIDE_METADATA_JOB = "statewide_layer_metadata_v1";

export interface LayerSnapshot {
  state: string;
  layerUrl: string;
  /** ISO instant the metadata was fetched. */
  fetchedAt: string;
  ok: boolean;
  /** ISO instant of editingInfo.lastEditDate; null when the server publishes none. */
  lastEditDate: string | null;
  rowCount: number | null;
  etag: string | null;
  error: string | null;
}

export interface SourceDrift {
  state: string;
  cadence: DocumentedCadence | null;
  lastSeenEditDate: string | null;
  lastIngestedAt: string | null;
  changedSinceLastPoll: boolean | null;
  changedSinceIngest: boolean | null;
  overdueVsCadence: boolean | null;
}

export interface PollObservation {
  kind: "statewide_layer_metadata";
  snapshots: LayerSnapshot[];
  drift: SourceDrift[];
}

/** What a poll needs from the world — injected so the poller is testable offline. */
export interface PollDeps {
  getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown; etag: string | null }>;
  now(): Date;
}

function layerUrlOf(ep: Pick<StatewideParcelEndpointSeed, "baseUrl" | "layerId">): string {
  return `${ep.baseUrl.replace(/\/+$/, "")}/${ep.layerId}`;
}

function epochToIso(v: unknown): string | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : null;
}

/** One source's metadata snapshot. Never throws: a failed poll is a snapshot with ok=false. */
async function pollStatewideLayer(ep: StatewideParcelEndpointSeed, deps: PollDeps): Promise<LayerSnapshot> {
  const layerUrl = layerUrlOf(ep);
  const fetchedAt = deps.now().toISOString();
  const base = { state: ep.state, layerUrl, fetchedAt };
  try {
    const meta = await deps.getJson(`${layerUrl}?f=json`);
    const body = meta.body as { editingInfo?: { lastEditDate?: unknown }; error?: { message?: string } } | null;
    if (!meta.ok || !body || body.error) {
      return { ...base, ok: false, lastEditDate: null, rowCount: null, etag: meta.etag, error: body?.error?.message ?? `metadata HTTP ${meta.status}` };
    }
    const count = await deps.getJson(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
    const countBody = count.body as { count?: unknown } | null;
    const rowCount = count.ok && typeof countBody?.count === "number" ? countBody.count : null;
    return {
      ...base,
      ok: true,
      lastEditDate: epochToIso(body.editingInfo?.lastEditDate),
      rowCount,
      etag: meta.etag,
      error: rowCount === null ? `count query HTTP ${count.status}` : null,
    };
  } catch (err) {
    return { ...base, ok: false, lastEditDate: null, rowCount: null, etag: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Drift for one source against its previous successful snapshot and its last ingest. */
function driftFor(now: LayerSnapshot, previous: LayerSnapshot | null, lastIngestedAt: Date | null, at: Date): SourceDrift {
  const entry = statewideSource(now.state);
  const cadence = entry?.cadence ?? null;
  let changedSinceLastPoll: boolean | null = null;
  if (now.ok && previous?.ok) {
    if (now.lastEditDate && previous.lastEditDate) changedSinceLastPoll = now.lastEditDate !== previous.lastEditDate;
    else if (now.rowCount !== null && previous.rowCount !== null) changedSinceLastPoll = now.rowCount !== previous.rowCount;
  }
  const lastEdit = now.lastEditDate ? new Date(now.lastEditDate) : null;
  return {
    state: now.state,
    cadence,
    lastSeenEditDate: now.lastEditDate ?? previous?.lastEditDate ?? null,
    lastIngestedAt: lastIngestedAt ? lastIngestedAt.toISOString() : null,
    changedSinceLastPoll,
    changedSinceIngest: lastIngestedAt && lastEdit ? lastEdit.getTime() > lastIngestedAt.getTime() : null,
    overdueVsCadence: overdueVsCadence(cadence, lastEdit, at),
  };
}

/** The whole poll: one snapshot per seeded statewide source, then drift. */
export async function pollAllStatewideLayers(
  deps: PollDeps,
  previous: ReadonlyMap<string, LayerSnapshot>,
  lastIngested: ReadonlyMap<string, Date>,
  endpoints: readonly StatewideParcelEndpointSeed[] = STATEWIDE_PARCEL_ENDPOINTS,
): Promise<PollObservation> {
  const snapshots: LayerSnapshot[] = [];
  for (const ep of endpoints) snapshots.push(await pollStatewideLayer(ep, deps));
  const at = deps.now();
  return {
    kind: "statewide_layer_metadata",
    snapshots,
    drift: snapshots.map((s) => driftFor(s, previous.get(s.state) ?? null, lastIngested.get(s.state) ?? null, at)),
  };
}

// ── The series reader ───────────────────────────────────────────────────────

/**
 * The previous successful snapshot per source: the latest successful run of
 * this job that observed it. Read from the append-only series itself.
 */
export async function previousSnapshots(): Promise<Map<string, LayerSnapshot>> {
  const rows = await db
    .select({ observation: etlRuns.observation })
    .from(etlRuns)
    .innerJoin(etlJobs, eq(etlJobs.id, etlRuns.jobId))
    .where(and(eq(etlJobs.jobName, STATEWIDE_METADATA_JOB), eq(etlRuns.status, "success")))
    .orderBy(desc(etlRuns.startedAt))
    .limit(30);
  const out = new Map<string, LayerSnapshot>();
  for (const r of rows) {
    const snaps = ((r.observation as PollObservation | null)?.snapshots ?? []) as LayerSnapshot[];
    for (const s of snaps) if (s.ok && !out.has(s.state)) out.set(s.state, s);
  }
  return out;
}
