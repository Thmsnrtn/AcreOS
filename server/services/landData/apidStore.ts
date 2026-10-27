/**
 * The APID store — D2c wiring (tables approved 2026-10-25, migration 0291).
 *
 * The ONE reader and writer of parcel_apids, parcel_apn_windows and
 * parcel_lineage_events. The rules live in the pure ledger
 * (shared/landData/apid.ts); this module loads a county's ledger, lets
 * applyRelease advance it, checks ledgerViolations() BEFORE anything commits
 * (the database's partial unique indexes enforce one open window per APN and
 * per APID; historical non-overlap is enforced here), and persists only the
 * difference — in one transaction, under a per-county advisory lock so two
 * appliers of the same county serialize.
 *
 * lastRelease is derived from the rows: the highest ordinal any window or
 * event of the county records. A release that changed nothing writes nothing,
 * and applying it again is a no-op.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { parcelApids, parcelApnWindows, parcelLineageEvents } from "@shared/schema";
import { applyRelease, emptyLedger, ledgerViolations, type ApidLedger, type ApidRecord, type ApnWindow, type Release } from "@shared/landData/apid";
import type { LineageInput } from "@shared/landData/lineage";
import type { PrimaryDb } from "../../db";

/** The rows that differ between two ledgers of one county (pure). */
export interface LedgerChanges {
  newApids: ApidRecord[];
  /** APIDs whose status / endedIn / provisional moved. */
  changedApids: ApidRecord[];
  newWindows: ApnWindow[];
  /** Windows open before and closed now. */
  closedWindows: ApnWindow[];
}

const windowKey = (w: ApnWindow) => `${w.apn}|${w.apid}|${w.validFrom}`;

export function ledgerChanges(before: ApidLedger, after: ApidLedger): LedgerChanges {
  const newApids: ApidRecord[] = [];
  const changedApids: ApidRecord[] = [];
  for (const [id, rec] of Object.entries(after.apids)) {
    const prev = before.apids[id];
    if (!prev) newApids.push(rec);
    else if (prev.status !== rec.status || prev.endedIn !== rec.endedIn || prev.provisional !== rec.provisional) changedApids.push(rec);
  }
  const beforeWindows = new Map(before.windows.map((w) => [windowKey(w), w]));
  const newWindows: ApnWindow[] = [];
  const closedWindows: ApnWindow[] = [];
  for (const w of after.windows) {
    const prev = beforeWindows.get(windowKey(w));
    if (!prev) newWindows.push(w);
    else if (prev.validTo === null && w.validTo !== null) closedWindows.push(w);
  }
  return { newApids, changedApids, newWindows, closedWindows };
}

/** Load one county's ledger inside `tx`. */
export async function loadCountyLedger(tx: PrimaryDb, state: string, countyFips: string): Promise<ApidLedger> {
  const st = state.toUpperCase();
  const ledger = emptyLedger(st, countyFips);
  const apidRows = await tx.select().from(parcelApids).where(and(eq(parcelApids.state, st), eq(parcelApids.countyFips, countyFips)));
  const idToApid = new Map<string, string>();
  let maxSeq = 0;
  for (const r of apidRows) {
    idToApid.set(r.id, r.apid);
    maxSeq = Math.max(maxSeq, r.seq);
    ledger.apids[r.apid] = {
      apid: r.apid,
      mintedIn: r.mintedInRelease,
      endedIn: r.endedInRelease,
      status: r.status,
      provisional: r.provisional,
      parents: r.parents,
      candidateParents: r.candidateParents,
    };
  }
  ledger.nextSeq = maxSeq + 1;
  const windowRows = await tx.select().from(parcelApnWindows).where(and(eq(parcelApnWindows.state, st), eq(parcelApnWindows.countyFips, countyFips)));
  let last: Release | null = null;
  const consider = (ordinal: number | null, releaseId: string | null) => {
    if (ordinal !== null && releaseId !== null && (!last || ordinal > last.ordinal)) last = { ordinal, releaseId };
  };
  for (const w of windowRows) {
    const apid = idToApid.get(w.apidId);
    if (!apid) throw new Error(`apid store: window ${w.id} names an APID outside ${st}-${countyFips}`);
    ledger.windows.push({ apn: w.apn, apid, validFrom: w.validFrom, validFromRelease: w.validFromRelease, validTo: w.validTo, validToRelease: w.validToRelease });
    consider(w.validFrom, w.validFromRelease);
    consider(w.validTo, w.validToRelease);
  }
  const [ev] = await tx
    .select({ ordinal: parcelLineageEvents.releaseOrdinal, releaseId: parcelLineageEvents.releaseId })
    .from(parcelLineageEvents)
    .where(and(eq(parcelLineageEvents.state, st), eq(parcelLineageEvents.countyFips, countyFips)))
    .orderBy(sql`${parcelLineageEvents.releaseOrdinal} DESC`)
    .limit(1);
  if (ev) consider(ev.ordinal, ev.releaseId);
  ledger.lastRelease = last;
  return ledger;
}

export type CountyApplyResult =
  | { status: "applied"; events: number; minted: number; retiredOrHeld: number }
  | { status: "already_applied"; detail: string }
  | { status: "refused"; reason: string; detail: string };

/**
 * Advance one county's persisted ledger by one release. `input.previous` must
 * be the county as the ledger last saw it (the previous release's records);
 * the first release has previous = [].
 */
export async function applyCountyRelease(args: { state: string; countyFips: string; release: Release; input: LineageInput }): Promise<CountyApplyResult> {
  const { withTransaction } = await import("../../db");
  return withTransaction(async (tx) => {
    const st = args.state.toUpperCase();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`apid:${st}:${args.countyFips}`}))`);
    const before = await loadCountyLedger(tx, st, args.countyFips);
    if (before.lastRelease && args.release.ordinal === before.lastRelease.ordinal && args.release.releaseId === before.lastRelease.releaseId) {
      return { status: "already_applied" as const, detail: `${args.release.releaseId} is the county's last applied release` };
    }
    const result = applyRelease(before, args.release, args.input);
    if (!result.ok) return { status: "refused" as const, reason: result.reason, detail: result.detail };
    const violations = ledgerViolations(result.ledger);
    if (violations.length > 0) throw new Error(`apid store: refusing to persist an unsound ledger for ${st}-${args.countyFips}: ${violations.slice(0, 5).join("; ")}`);
    const changes = ledgerChanges(before, result.ledger);

    const ids = new Map<string, string>();
    for (const r of await tx.select({ id: parcelApids.id, apid: parcelApids.apid }).from(parcelApids).where(and(eq(parcelApids.state, st), eq(parcelApids.countyFips, args.countyFips)))) ids.set(r.apid, r.id);
    for (const a of changes.newApids) {
      const seq = Number(a.apid.slice(a.apid.lastIndexOf("-") + 1));
      const [row] = await tx
        .insert(parcelApids)
        .values({ apid: a.apid, state: st, countyFips: args.countyFips, seq, status: a.status, provisional: a.provisional, parents: a.parents, candidateParents: a.candidateParents, mintedInRelease: a.mintedIn, endedInRelease: a.endedIn })
        .returning({ id: parcelApids.id });
      ids.set(a.apid, row.id);
    }
    for (const a of changes.changedApids) {
      await tx.update(parcelApids).set({ status: a.status, endedInRelease: a.endedIn, provisional: a.provisional }).where(eq(parcelApids.apid, a.apid));
    }
    // Close before opening: the partial unique indexes allow one open window per APN / APID.
    for (const w of changes.closedWindows) {
      const apidId = ids.get(w.apid);
      if (!apidId) throw new Error(`apid store: closed window names unknown APID ${w.apid}`);
      await tx
        .update(parcelApnWindows)
        .set({ validTo: w.validTo, validToRelease: w.validToRelease })
        .where(and(eq(parcelApnWindows.apidId, apidId), eq(parcelApnWindows.apn, w.apn), eq(parcelApnWindows.validFrom, w.validFrom), isNull(parcelApnWindows.validTo)));
    }
    for (const w of changes.newWindows) {
      const apidId = ids.get(w.apid);
      if (!apidId) throw new Error(`apid store: new window names unknown APID ${w.apid}`);
      await tx.insert(parcelApnWindows).values({ apidId, state: st, countyFips: args.countyFips, apn: w.apn, validFrom: w.validFrom, validTo: w.validTo, validFromRelease: w.validFromRelease, validToRelease: w.validToRelease });
    }
    // Non-`same` events only (`same` is most rows and the default).
    const openBefore = new Map(before.windows.filter((w) => w.validTo === null).map((w) => [w.apn, w.apid]));
    const events = result.events.filter((e) => e.kind !== "same");
    for (const e of events) {
      await tx.insert(parcelLineageEvents).values({
        state: st,
        countyFips: args.countyFips,
        releaseId: args.release.releaseId,
        releaseOrdinal: args.release.ordinal,
        kind: e.kind,
        basis: e.basis,
        reason: e.reason,
        previousApids: e.previousIds.map((id) => openBefore.get(id)).filter((x): x is string => typeof x === "string"),
        nextApids: e.nextIds.map((id) => result.assignment[id]).filter((x): x is string => typeof x === "string"),
        previousApns: e.previousIds,
        nextApns: e.nextIds,
        evidence: { overlaps: e.overlaps, coverage: e.coverage, flags: e.flags, continuingId: e.continuingId } as unknown as Record<string, unknown>,
      });
    }
    return { status: "applied" as const, events: events.length, minted: changes.newApids.length, retiredOrHeld: changes.changedApids.length };
  });
}
