/**
 * Vintages — a value AS KNOWN on a date.
 *
 * A public series is revised after it is first published (payroll benchmarks
 * move a state's employment by tens of thousands a year later). A forecast
 * that is backtested against today's revised numbers is graded on information
 * nobody had, and looks better than it will ever be live. So every value the
 * models read carries the date it was known, and every read asks "what did we
 * know on date D?" — never "what is the number now?".
 *
 * The store is append-only: a revised value is a NEW row under a later
 * vintage date; the earlier row stays. `revisionsToRecord` keeps it compact
 * by only appending what changed. Pure; browser-safe.
 */

export interface VintageRow {
  seriesId: string;
  /** First day of the period the value describes (YYYY-MM-DD). */
  observationDate: string;
  /** The date the value was known (YYYY-MM-DD). */
  vintageDate: string;
  value: number;
}

export interface Point {
  date: string;
  value: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(d: string, what: string): void {
  if (!ISO_DATE.test(d)) throw new Error(`${what} must be YYYY-MM-DD, got ${d}`);
}

/**
 * Every series as known on `asOf`: for each (series, observation) the value
 * from the latest vintage on or before `asOf`. Observations first published
 * after `asOf` do not exist yet and are absent. Points come back date-sorted.
 */
export function asKnownOn(rows: readonly VintageRow[], asOf: string): Map<string, Point[]> {
  assertIsoDate(asOf, "asOf");
  const best = new Map<string, { vintage: string; value: number }>();
  for (const r of rows) {
    if (r.vintageDate > asOf) continue;
    const k = `${r.seriesId}\u0000${r.observationDate}`;
    const cur = best.get(k);
    if (!cur || r.vintageDate > cur.vintage) best.set(k, { vintage: r.vintageDate, value: r.value });
  }
  const out = new Map<string, Point[]>();
  for (const [k, v] of best) {
    const [seriesId, date] = k.split("\u0000");
    let arr = out.get(seriesId);
    if (!arr) out.set(seriesId, (arr = []));
    arr.push({ date, value: v.value });
  }
  for (const arr of out.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * The rows to append when a fresh fetch arrives: observations never seen, and
 * observations whose value differs from what was last known. Unchanged values
 * are not re-recorded (the earlier vintage already says it). Never returns an
 * edit to an existing row — there is no such thing in this store.
 */
export function revisionsToRecord(
  known: readonly VintageRow[],
  fresh: ReadonlyArray<{ seriesId: string; observationDate: string; value: number }>,
  vintageDate: string,
  tolerance = 1e-9,
): VintageRow[] {
  assertIsoDate(vintageDate, "vintageDate");
  const latest = new Map<string, { vintage: string; value: number }>();
  for (const r of known) {
    const k = `${r.seriesId}\u0000${r.observationDate}`;
    const cur = latest.get(k);
    if (!cur || r.vintageDate > cur.vintage) latest.set(k, { vintage: r.vintageDate, value: r.value });
  }
  const out: VintageRow[] = [];
  for (const f of fresh) {
    if (!Number.isFinite(f.value)) continue;
    const prev = latest.get(`${f.seriesId}\u0000${f.observationDate}`);
    if (prev && prev.vintage >= vintageDate) continue;
    if (prev && Math.abs(prev.value - f.value) <= tolerance) continue;
    out.push({ seriesId: f.seriesId, observationDate: f.observationDate, vintageDate, value: f.value });
  }
  return out;
}

/** Add whole months to a YYYY-MM-DD date, keeping day 01 semantics for period dates. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = y * 12 + (m - 1) + months;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
