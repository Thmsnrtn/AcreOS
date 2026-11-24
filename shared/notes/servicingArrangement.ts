/**
 * Who services an acquired note — the operator's own declaration.
 *
 * The four values and their meanings are the ones documented on
 * `acquired_notes.servicing_arrangement` in shared/schema/notes-vertical.ts;
 * the labels below only restate them in operator words. This is a record of
 * what the operator says, not a determination AcreOS makes: the periodic-
 * statement predicate (server/services/periodicStatements/predicate.ts) reads
 * it and skips every note that is not 'self_serviced'.
 *
 * Data only — browser-safe. Shared by the commit route, the per-note PATCH and
 * the two client controls so the four values cannot drift between them.
 */
export const SERVICING_ARRANGEMENTS = ["self_serviced", "sub_serviced", "seller_retained", "passive_holder"] as const;
export type ServicingArrangement = (typeof SERVICING_ARRANGEMENTS)[number];

export const SERVICING_ARRANGEMENT_OPTIONS: ReadonlyArray<{ value: ServicingArrangement; label: string; detail: string }> = [
  { value: "self_serviced", label: "I service these notes myself", detail: "My organization collects and services the notes it also holds." },
  { value: "sub_serviced", label: "A third-party servicer services them", detail: "A sub-servicer I hire is the servicer." },
  { value: "seller_retained", label: "The seller keeps servicing them", detail: "The seller continues as servicer under a sub-servicing arrangement." },
  { value: "passive_holder", label: "I only hold the paper", detail: "I hold the notes with no servicing role." },
];

/** The one sentence that says what the choice turns on — shown beside every control. */
export const SERVICING_ARRANGEMENT_EFFECT =
  "AcreOS prepares periodic statements only for notes you mark as serviced by you. This is your declaration about who services the note — AcreOS does not determine it for you.";

export function isServicingArrangement(v: unknown): v is ServicingArrangement {
  return typeof v === "string" && (SERVICING_ARRANGEMENTS as readonly string[]).includes(v);
}

export function servicingArrangementLabel(v: string): string {
  return SERVICING_ARRANGEMENT_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
