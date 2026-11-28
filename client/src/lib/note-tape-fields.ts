/**
 * The note-tape field catalogue (shared/notes/noteTapeFields NOTE_TAPE_FIELDS),
 * served to the browser as data — /note-tape-fields.json — instead of being
 * bundled into the JS (bundle diet BD-10). The shared module stays the ONE
 * source of truth: the server validator and the import services keep importing
 * it synchronously; only the browser reads the copy, and a unit pin proves the
 * copy is the module's data verbatim (tests/unit/staticDataServedAsData.test.ts).
 *
 * Regenerate the copy after editing the module:
 *   npx tsx -e 'import {NOTE_TAPE_FIELDS} from "./shared/notes/noteTapeFields"; import fs from "node:fs"; fs.writeFileSync("client/public/note-tape-fields.json", JSON.stringify(NOTE_TAPE_FIELDS, null, 2)+"\n")'
 *
 * Shell-first like every static-data consumer: while the catalogue is in
 * flight the caller renders its shell plus a visible loading line; a failed
 * or wrong-shape load surfaces a visible error, never a silently empty
 * field list.
 */
import type { NoteTapeFieldDef, NoteTapeFieldKey } from "@shared/notes/noteTapeFields";
import { NOTE_TAPE_FIELDS_URL, useStaticData, type StaticDataState } from "./static-data";

const NOTE_TAPE_GROUPS: ReadonlySet<string> = new Set(["identity", "terms", "yield", "collateral", "documents"]);
const NOTE_TAPE_KINDS: ReadonlySet<string> = new Set(["text", "money", "rate", "int", "day", "date", "status", "state", "document"]);
const NOTE_TAPE_DECAYS: ReadonlySet<string> = new Set(["stable", "years", "about_a_year", "months", "continuous", "event"]);

/** Runtime shape check — a 200 that is not the catalogue must fail loudly. */
export function isNoteTapeFields(value: unknown): value is readonly NoteTapeFieldDef[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((f) => {
    if (typeof f !== "object" || f === null) return false;
    const field = f as Record<string, unknown>;
    return (
      typeof field.key === "string" &&
      typeof field.label === "string" &&
      typeof field.group === "string" && NOTE_TAPE_GROUPS.has(field.group) &&
      typeof field.kind === "string" && NOTE_TAPE_KINDS.has(field.kind) &&
      typeof field.required === "boolean" &&
      typeof field.decay === "string" && NOTE_TAPE_DECAYS.has(field.decay) &&
      Array.isArray(field.aliases) && field.aliases.every((a) => typeof a === "string") &&
      typeof field.fix === "string"
    );
  });
}

/** The by-key lookup the shared module derives as NOTE_TAPE_FIELD — same derivation, from the served copy. */
export function noteTapeFieldByKey(fields: readonly NoteTapeFieldDef[]): Record<NoteTapeFieldKey, NoteTapeFieldDef> {
  return Object.fromEntries(fields.map((f) => [f.key, f])) as Record<NoteTapeFieldKey, NoteTapeFieldDef>;
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Format a recorded value by its field's kind — the note record panels' formatter, verbatim. */
export function formatNoteTapeValue(fieldByKey: Record<NoteTapeFieldKey, NoteTapeFieldDef>, field: NoteTapeFieldKey, v: unknown): string {
  if (v === null || v === undefined) return "";
  switch (fieldByKey[field]?.kind) {
    case "money": return usd(Number(v));
    case "rate": return `${(Number(v) / 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
    case "status": return String(v).replace("_", " ");
    case "int": return `${v} months`;
    default: return String(v);
  }
}

export function useNoteTapeFields(): StaticDataState<readonly NoteTapeFieldDef[]> {
  const { data, error } = useStaticData<unknown>(NOTE_TAPE_FIELDS_URL);
  if (error) return { data: null, error: true };
  if (data === null) return { data: null, error: false };
  if (!isNoteTapeFields(data)) return { data: null, error: true };
  return { data, error: false };
}
