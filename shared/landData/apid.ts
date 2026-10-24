/**
 * APID — the AcreOS parcel id (D2c). Spec: docs/land-data/d2c-apid-lineage-spec.md.
 *
 * A county's APN is a label the county may move (renumbering), split, merge
 * or hand to different land later. An APID names a piece of LAND as AcreOS
 * tracks it across releases:
 *
 *   - minted from a county-scoped monotonic counter — never derived from the
 *     APN, so a retired APID can never be re-derived when the county reuses
 *     an APN (the parcel crosswalk's `newParcelKey(state, fips, sourceId)`
 *     re-derives exactly the key it just retired; see the spec §2);
 *   - carried only where lineage says the land is the same (same, renumber,
 *     the record of a condo stack that keeps the parent's id);
 *   - never reused: a retired or held APID never reappears on any record.
 *
 * Validity windows: each (APN, APID) pairing is valid over a half-open range
 * of release ordinals [validFrom, validTo). For one APN the windows never
 * overlap, and for one APID they never overlap; at most one window per APN
 * and per APID is open (validTo null).
 *
 * The ledger is a value: applyRelease returns a new one and never mutates its
 * input. The integrator persists it (DDL proposal in INTEGRATION-D2c.md).
 * Pure and browser-safe.
 */
import { classifyLineage, inheritanceFor, normalizeSourceId, type LineageEvent, type LineageInput, type LineageThresholds, LINEAGE_THRESHOLDS } from "./lineage";

export interface Release {
  /** The release's own id (e.g. the source's vintage or an etl run id). */
  releaseId: string;
  /** Strictly increasing across a county's releases. */
  ordinal: number;
}

export type ApidStatus = "active" | "retired" | "held";

export interface ApidRecord {
  apid: string;
  mintedIn: string;
  /** Release in which it stopped naming current land (retired or held). */
  endedIn: string | null;
  status: ApidStatus;
  /** Minted for an ambiguous event — awaiting review. */
  provisional: boolean;
  /** Lineage parents (APIDs) — split / merge / condo only. */
  parents: string[];
  /** ambiguous only: APIDs a reviewer may link; NOT lineage. */
  candidateParents: string[];
}

export interface ApnWindow {
  apn: string;
  apid: string;
  validFrom: number;
  validFromRelease: string;
  /** Exclusive; null = still valid. */
  validTo: number | null;
  validToRelease: string | null;
}

export interface ApidLedger {
  state: string;
  countyFips: string;
  /** Next sequence number to mint. Only ever increases. */
  nextSeq: number;
  lastRelease: Release | null;
  apids: Record<string, ApidRecord>;
  windows: ApnWindow[];
}

const APID_RE = /^APID-([A-Z]{2})-(\d{5})-(\d{7,})$/;

export function formatApid(state: string, countyFips: string, seq: number): string {
  if (!/^[A-Za-z]{2}$/.test(state) || !/^\d{5}$/.test(countyFips) || !Number.isSafeInteger(seq) || seq < 1) {
    throw new Error("formatApid: state must be 2 letters, countyFips 5 digits, seq a positive integer");
  }
  return `APID-${state.toUpperCase()}-${countyFips}-${String(seq).padStart(7, "0")}`;
}

export function parseApid(apid: string): { state: string; countyFips: string; seq: number } | null {
  const m = APID_RE.exec(apid);
  return m ? { state: m[1], countyFips: m[2], seq: Number(m[3]) } : null;
}

export function emptyLedger(state: string, countyFips: string): ApidLedger {
  formatApid(state, countyFips, 1); // validates the scope
  return { state: state.toUpperCase(), countyFips, nextSeq: 1, lastRelease: null, apids: {}, windows: [] };
}

/** The APID an APN named at a release ordinal, or null. */
export function apidForApnAt(ledger: ApidLedger, apn: string, ordinal: number): string | null {
  const id = normalizeSourceId(apn);
  const w = ledger.windows.find((x) => x.apn === id && x.validFrom <= ordinal && (x.validTo === null || ordinal < x.validTo));
  return w ? w.apid : null;
}

export type ApplyReleaseResult =
  | {
      ok: true;
      ledger: ApidLedger;
      /** next-release APN → APID. */
      assignment: Record<string, string>;
      events: LineageEvent[];
    }
  | { ok: false; reason: "release_not_after_last" | "previous_snapshot_mismatch" | "duplicate_source_id"; detail: string };

/**
 * Advance a county's ledger by one release. `input.previous` must be exactly
 * the APNs the ledger holds open (the release the ledger last applied); the
 * first release has previous = [].
 */
export function applyRelease(
  ledger: ApidLedger,
  release: Release,
  input: LineageInput,
  thresholds: LineageThresholds = LINEAGE_THRESHOLDS,
): ApplyReleaseResult {
  if (ledger.lastRelease && !(release.ordinal > ledger.lastRelease.ordinal)) {
    return { ok: false, reason: "release_not_after_last", detail: `ordinal ${release.ordinal} is not after ${ledger.lastRelease.ordinal}` };
  }
  const open = new Map<string, ApnWindow>();
  for (const w of ledger.windows) if (w.validTo === null) open.set(w.apn, w);
  const prevIds = new Set(input.previous.map((r) => normalizeSourceId(r.sourceId)));
  const missing = [...open.keys()].filter((k) => !prevIds.has(k));
  const extra = [...prevIds].filter((k) => !open.has(k));
  if (missing.length || extra.length) {
    return { ok: false, reason: "previous_snapshot_mismatch", detail: `ledger open APNs not in previous: ${missing.length}; previous APNs not open in ledger: ${extra.length}` };
  }
  const lineage = classifyLineage(input, thresholds);
  if (!lineage.ok) return { ok: false, reason: "duplicate_source_id", detail: `${lineage.side}: ${lineage.ids.join(", ")}` };

  const out: ApidLedger = {
    ...ledger,
    lastRelease: release,
    apids: Object.fromEntries(Object.entries(ledger.apids).map(([k, v]) => [k, { ...v, parents: [...v.parents], candidateParents: [...v.candidateParents] }])),
    windows: ledger.windows.map((w) => ({ ...w })),
  };
  const openNow = new Map<string, ApnWindow>();
  for (const w of out.windows) if (w.validTo === null) openNow.set(w.apn, w);
  const apidOfPrev = (apn: string): string => {
    const w = openNow.get(apn);
    if (!w) throw new Error("applyRelease: previous APN without an open window");
    return w.apid;
  };
  const mint = (provisional: boolean, parents: string[], candidateParents: string[]): string => {
    const apid = formatApid(out.state, out.countyFips, out.nextSeq);
    out.nextSeq += 1;
    if (out.apids[apid]) throw new Error("applyRelease: APID already minted"); // unreachable: the counter only rises
    out.apids[apid] = { apid, mintedIn: release.releaseId, endedIn: null, status: "active", provisional, parents, candidateParents };
    return apid;
  };
  const closeApn = (apn: string) => {
    const w = openNow.get(apn);
    if (!w) return;
    w.validTo = release.ordinal;
    w.validToRelease = release.releaseId;
    openNow.delete(apn);
  };
  const endApid = (apid: string, status: "retired" | "held") => {
    const r = out.apids[apid];
    r.status = status;
    r.endedIn = release.releaseId;
  };
  const opens: Array<{ apn: string; apid: string }> = [];
  const assignment: Record<string, string> = {};

  for (const event of lineage.events) {
    const prevApids = event.previousIds.map(apidOfPrev);
    const plans = inheritanceFor(event);
    const carriedPrev = new Set(plans.filter((p) => p.identity === "carried").map((p) => p.carriedFrom));
    // Previous side: every APN's window closes unless the SAME APN continues
    // on the SAME APID (same); an APID carried to a new APN stays active.
    event.previousIds.forEach((apn, i) => {
      const continuesSameApn = plans.some((p) => p.identity === "carried" && p.carriedFrom === apn && p.nextId === apn);
      if (continuesSameApn) return;
      closeApn(apn);
      if (!carriedPrev.has(apn)) endApid(prevApids[i], event.kind === "ambiguous" ? "held" : "retired");
    });
    for (const plan of plans) {
      let apid: string;
      if (plan.identity === "carried" && plan.carriedFrom !== null) {
        apid = prevApids[event.previousIds.indexOf(plan.carriedFrom)];
        if (plan.carriedFrom !== plan.nextId) opens.push({ apn: plan.nextId, apid });
      } else {
        const parents = plan.ancestors.map((a) => prevApids[event.previousIds.indexOf(a)]);
        const candidates = plan.candidateAncestors.map((a) => prevApids[event.previousIds.indexOf(a)]);
        apid = mint(plan.identity === "provisional", parents, candidates);
        opens.push({ apn: plan.nextId, apid });
      }
      assignment[plan.nextId] = apid;
    }
  }
  // Opens after every close, so an APN that moves between events in one
  // release (closed on one APID, opened on another) never overlaps itself.
  for (const o of opens) {
    out.windows.push({ apn: o.apn, apid: o.apid, validFrom: release.ordinal, validFromRelease: release.releaseId, validTo: null, validToRelease: null });
  }
  return { ok: true, ledger: out, assignment, events: lineage.events };
}

/**
 * Every invariant the ledger must hold; empty = sound. Checked by the tests
 * after every release and meant to run before the integrator persists one.
 */
export function ledgerViolations(ledger: ApidLedger): string[] {
  const v: string[] = [];
  const byKey = (key: "apn" | "apid") => {
    const m = new Map<string, ApnWindow[]>();
    for (const w of ledger.windows) {
      const list = m.get(w[key]);
      if (list) list.push(w);
      else m.set(w[key], [w]);
    }
    return m;
  };
  for (const key of ["apn", "apid"] as const) {
    for (const [k, ws] of byKey(key)) {
      const sorted = [...ws].sort((a, b) => a.validFrom - b.validFrom);
      for (let i = 0; i < sorted.length; i++) {
        const w = sorted[i];
        if (w.validTo !== null && !(w.validTo > w.validFrom)) v.push(`${key} ${k}: empty or inverted window [${w.validFrom}, ${w.validTo})`);
        const nxt = sorted[i + 1];
        if (nxt && (w.validTo === null || w.validTo > nxt.validFrom)) v.push(`${key} ${k}: windows overlap at ${nxt.validFrom}`);
      }
    }
  }
  const seqs = new Set<number>();
  for (const [apid, r] of Object.entries(ledger.apids)) {
    const parsed = parseApid(apid);
    if (!parsed || parsed.state !== ledger.state || parsed.countyFips !== ledger.countyFips) { v.push(`apid ${apid}: not this county's APID`); continue; }
    if (parsed.seq >= ledger.nextSeq) v.push(`apid ${apid}: sequence not below nextSeq ${ledger.nextSeq}`);
    if (seqs.has(parsed.seq)) v.push(`apid ${apid}: sequence minted twice`);
    seqs.add(parsed.seq);
    const openCount = ledger.windows.filter((w) => w.apid === apid && w.validTo === null).length;
    if (r.status === "active" && openCount !== 1) v.push(`apid ${apid}: active with ${openCount} open windows`);
    if (r.status !== "active" && openCount !== 0) v.push(`apid ${apid}: ${r.status} but still names an APN`);
    for (const p of [...r.parents, ...r.candidateParents]) if (!ledger.apids[p]) v.push(`apid ${apid}: unknown parent ${p}`);
  }
  for (const w of ledger.windows) if (!ledger.apids[w.apid]) v.push(`window ${w.apn}: unknown apid ${w.apid}`);
  return v;
}
