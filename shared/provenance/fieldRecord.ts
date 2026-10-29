/**
 * One field's record across every source that stated it — the disagreement
 * and negative-knowledge rule, shared by the note record (V-Notes-1 N4) and
 * the tax lot record (V-Tax-1 T4). Pure.
 *
 *   - Every observation of the field is kept, oldest first.
 *   - When sources state different values, `disagreement` lists every distinct
 *     value with every observation that stated it. Nothing is resolved,
 *     averaged or overwritten: the book value stays what it is, and
 *     `bookValueIs` says which of the listed values it is (null when no source
 *     states it). A single source stating a value the book does not hold is a
 *     disagreement too.
 *   - A missing value says WHY: blank on a source that had a place for it
 *     (asked, nothing stated) is not the same as never stated by any source.
 */

export interface ObservationView {
  value: unknown;
  kind: "value" | "searched_none";
  source: string;
  sourceRef: Record<string, unknown>;
  asOf: string | null;
  confidence: string;
  /** Why this observation can be relied on, in words. */
  basis: string;
  decayClass: string;
  observedAt: string;
}

export interface RecordedValue {
  field: string;
  label: string;
  /** The value on the book row (what the rest of AcreOS computes from). */
  value: unknown;
  /** The observation that states this value, or null when no source was recorded. */
  provenance: ObservationView | null;
  /** Every observation of this field, oldest first. */
  observations: ObservationView[];
  /**
   * Why there is no value, when there is none: 'blank_on_source' = a source
   * had a place for it and left it blank (asked, nothing stated);
   * 'never_stated' = no source has had a place for it.
   */
  absence: null | { status: "blank_on_source"; column: string | null; fileName: string | null } | { status: "never_stated" };
  /** Sources that disagree: every distinct stated value, each with every observation that stated it. */
  disagreement: null | { values: Array<{ value: unknown; observations: ObservationView[] }>; bookValueIs: number | null };
}

/** The record of one field, from its book value and every observation of it (oldest first). */
export function recordedField(field: string, label: string, bookValue: unknown, all: ObservationView[]): RecordedValue {
  const value = bookValue ?? null;
  const key = (v: unknown) => JSON.stringify(v);
  // The observation that states the book value: the earliest one equal to it.
  const match = all.find((o) => o.kind === "value" && key(o.value) === key(value));
  // Distinct stated values, in the order first stated.
  const groups = new Map<string, ObservationView[]>();
  for (const o of all) if (o.kind === "value") groups.set(key(o.value), [...(groups.get(key(o.value)) ?? []), o]);
  const distinct = [...groups.values()];
  const bookStated = groups.has(key(value));
  const disagreement: RecordedValue["disagreement"] =
    distinct.length > 1 || (distinct.length === 1 && !bookStated)
      ? {
          values: distinct.map((g) => ({ value: g[0].value, observations: g })),
          bookValueIs: (() => {
            const i = [...groups.keys()].indexOf(key(value));
            return i < 0 ? null : i;
          })(),
        }
      : null;
  const blank = all.filter((o) => o.kind === "searched_none").at(-1);
  const absence: RecordedValue["absence"] =
    value !== null
      ? null
      : blank
        ? { status: "blank_on_source", column: (blank.sourceRef.column as string | undefined) ?? null, fileName: (blank.sourceRef.fileName as string | undefined) ?? null }
        : { status: "never_stated" };
  return { field, label, value, provenance: match ?? null, observations: all, absence, disagreement };
}
