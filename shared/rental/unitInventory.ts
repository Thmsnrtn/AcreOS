// ============================================================================
// SHARED/RENTAL/UNITINVENTORY.TS
// ----------------------------------------------------------------------------
// Two things the units surface needs on both sides of the wire, and neither of
// which may live in a route file:
//
//   1. VOCABULARY. `rental_units.kind` is unit | pad | suite, and the word is
//      not decoration. A mobile-home park operator manages PADS (or lots) —
//      the tenant owns the home and rents the ground. A strip centre manages
//      SUITES. Calling a park's ground leases "units" in the UI is the same
//      class of error as calling a seller a "lead": it tells the operator this
//      product was not built for them. One table with a discriminator only
//      works if the discriminator reaches the words on the screen.
//
//   2. RANGE EXPANSION. A park with 60 pads will not create them one at a
//      time, and neither will a 24-unit building. Expansion is PURE and lives
//      here so it can be tested without a database, and so the client can show
//      the operator exactly which labels it is about to create BEFORE anything
//      is written. The server re-runs the identical function on the payload —
//      the client preview is a courtesy, never the authority.
//
// Deliberately NOT here: anything that talks to the database, and anything
// that guesses a `kind`. Inferring 'pad' from a property's structure_type
// would put a fact in the record that nobody asserted.
// ============================================================================

// TYPE-only. This module must stay importable by a unit test with no
// DATABASE_URL and by the client bundle, so it pulls in no drizzle table
// definitions — but `VOCABULARY` below is a `Record<RentalUnitKind, …>`, so
// adding a fourth kind to `RENTAL_UNIT_KINDS` fails to compile here until the
// word for it exists. The tie to the schema is checked, not merely intended.
import type { RentalUnitKind } from "../schema/rental";

// ----------------------------------------------------------------------------
// Vocabulary
// ----------------------------------------------------------------------------

export interface UnitKindVocabulary {
  kind: RentalUnitKind;
  /** "unit" / "pad" / "suite" — lower case, for mid-sentence use. */
  singular: string;
  /** "units" / "pads" / "suites". */
  plural: string;
  /** Sentence-leading form: "Unit" / "Pad" / "Suite". */
  titleSingular: string;
  /** Sentence-leading plural: "Units" / "Pads" / "Suites". */
  titlePlural: string;
  /** What this kind is, in one clause the operator recognises as their world. */
  description: string;
  /** A label an operator of this kind would actually type. */
  labelExample: string;
  /** A plausible bulk range for this kind, used as the range-form placeholder. */
  rangePrefixExample: string;
}

const VOCABULARY: Record<RentalUnitKind, UnitKindVocabulary> = {
  unit: {
    kind: "unit",
    singular: "unit",
    plural: "units",
    titleSingular: "Unit",
    titlePlural: "Units",
    description: "Apartment, one side of a duplex, or a whole single-family house",
    labelExample: "3B",
    rangePrefixExample: "Apt ",
  },
  pad: {
    kind: "pad",
    singular: "pad",
    plural: "pads",
    titleSingular: "Pad",
    titlePlural: "Pads",
    // The distinction that makes a park a park: the improvement is the
    // tenant's, the ground is the landlord's.
    description: "Mobile-home park lot — the resident owns the home and rents the ground",
    labelExample: "Lot 14",
    rangePrefixExample: "Lot ",
  },
  suite: {
    kind: "suite",
    singular: "suite",
    plural: "suites",
    titleSingular: "Suite",
    titlePlural: "Suites",
    description: "Commercial or mixed-use tenancy inside a larger building",
    labelExample: "Suite 200",
    rangePrefixExample: "Suite ",
  },
};

export function unitVocabulary(kind: RentalUnitKind | string | null | undefined): UnitKindVocabulary {
  const k = typeof kind === "string" ? kind : "";
  return Object.prototype.hasOwnProperty.call(VOCABULARY, k)
    ? VOCABULARY[k as RentalUnitKind]
    : VOCABULARY.unit;
}

/** The kinds, in the order they are offered to an operator. */
export const UNIT_KIND_OPTIONS: ReadonlyArray<UnitKindVocabulary> = [
  VOCABULARY.unit,
  VOCABULARY.pad,
  VOCABULARY.suite,
];

/**
 * The vocabulary for a MIXED list. A property whose rows are all one kind is
 * spoken about in that kind's words; a property with pads AND suites falls back
 * to the neutral "unit", because there is no honest single word for both and
 * picking the majority would mislabel the minority.
 */
export function dominantUnitVocabulary(
  kinds: ReadonlyArray<RentalUnitKind | string>,
): UnitKindVocabulary {
  const distinct = new Set(kinds.map((k) => String(k)));
  if (distinct.size === 1) return unitVocabulary([...distinct][0]);
  return VOCABULARY.unit;
}

/** `1 pad` / `3 pads` — count and noun agreeing, in the operator's word. */
export function countUnits(n: number, vocab: UnitKindVocabulary): string {
  return `${n} ${n === 1 ? vocab.singular : vocab.plural}`;
}

// ----------------------------------------------------------------------------
// Bulk label expansion
// ----------------------------------------------------------------------------

/**
 * Ceiling on ONE bulk create. Chosen against the shape of the problem, not
 * arbitrarily: the rent-roll importer already caps a roll at 200 rows, the
 * largest parks in the US sit in the low hundreds of pads, and a single
 * multi-row INSERT of this size is one round trip. A range wider than this is
 * far more likely to be a typo ("Lot 1"–"Lot 6000") than an inventory.
 */
export const UNIT_BULK_MAX_LABELS = 500;

/** Matches `unitCreateSchema.label` on the server — one source of truth. */
export const UNIT_LABEL_MAX_LENGTH = 64;

export type UnitLabelSpec =
  | {
      mode: "range";
      /** Text before the number — "Lot ", "Apt ", "". */
      prefix?: string;
      /** Text after the number — usually empty. */
      suffix?: string;
      start: number;
      end: number;
      /**
       * Zero-pad the number to this width, so "Lot 007" sorts next to
       * "Lot 008" instead of after "Lot 70". 0/undefined = no padding.
       */
      padTo?: number;
    }
  | {
      /** Free paste — one label per line, or comma/semicolon separated. */
      mode: "list";
      text: string;
    };

export interface UnitLabelExpansion {
  /** De-duplicated, in input order. This is exactly what will be attempted. */
  labels: string[];
  /**
   * Labels the INPUT itself repeated. Reported, never silently collapsed: a
   * pasted roll with "Lot 12" twice is a fact about the paste the operator
   * should see, not something for us to quietly tidy away.
   */
  duplicateLabels: string[];
  /** Labels before de-duplication — `labels.length + duplicates dropped`. */
  submittedCount: number;
}

export type UnitLabelExpansionResult =
  | { ok: true; expansion: UnitLabelExpansion }
  | { ok: false; error: string };

/**
 * Trim, exactly as `normalizeUnitLabel` does for a non-empty string. Blank is
 * NOT collapsed to "Whole property" here: in a bulk create a blank line is
 * noise from a paste, and turning it into the whole-property unit would create
 * a slot the operator never asked for.
 */
function tidy(raw: string): string {
  return raw.trim();
}

function dedupe(raw: string[]): UnitLabelExpansion {
  const seen = new Set<string>();
  const labels: string[] = [];
  const duplicates = new Set<string>();
  for (const label of raw) {
    if (seen.has(label)) {
      duplicates.add(label);
      continue;
    }
    seen.add(label);
    labels.push(label);
  }
  return { labels, duplicateLabels: [...duplicates], submittedCount: raw.length };
}

function tooLong(labels: string[]): string[] {
  return labels.filter((l) => l.length > UNIT_LABEL_MAX_LENGTH);
}

/**
 * A bulk spec → the exact list of labels it means. Pure: no database, no
 * clock, no randomness. The server runs this on the payload and the client runs
 * it for the preview, so the operator can never be shown one list and have a
 * different one written.
 *
 * Returns a result rather than throwing so both callers can render the refusal
 * as a sentence instead of a stack trace.
 */
export function expandUnitLabels(spec: UnitLabelSpec): UnitLabelExpansionResult {
  if (spec.mode === "range") {
    const { start, end } = spec;
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return { ok: false, error: "Start and end must be whole numbers." };
    }
    if (start < 0 || end < 0) {
      return { ok: false, error: "Start and end must be zero or greater." };
    }
    if (end < start) {
      return {
        ok: false,
        error: `The range ends before it starts (${start} → ${end}). Swap them, or set the end above the start.`,
      };
    }
    const count = end - start + 1;
    if (count > UNIT_BULK_MAX_LABELS) {
      return {
        ok: false,
        error:
          `That range is ${count.toLocaleString("en-US")} labels — more than the ` +
          `${UNIT_BULK_MAX_LABELS} a single bulk create will attempt. Split it into ` +
          `smaller ranges, or check the end number for a typo.`,
      };
    }
    const prefix = spec.prefix ?? "";
    const suffix = spec.suffix ?? "";
    const padTo = Math.max(0, Math.trunc(spec.padTo ?? 0));
    const raw: string[] = [];
    for (let i = start; i <= end; i++) {
      const num = padTo > 0 ? String(i).padStart(padTo, "0") : String(i);
      const label = tidy(`${prefix}${num}${suffix}`);
      if (label === "") {
        return { ok: false, error: "That range produces blank labels. Add a prefix, or a suffix." };
      }
      raw.push(label);
    }
    const long = tooLong(raw);
    if (long.length > 0) {
      return {
        ok: false,
        error: `"${long[0]}" is longer than ${UNIT_LABEL_MAX_LENGTH} characters. Shorten the prefix or suffix.`,
      };
    }
    return { ok: true, expansion: dedupe(raw) };
  }

  // mode === "list"
  const raw = spec.text
    .split(/[\n\r,;\t]/)
    .map(tidy)
    .filter((l) => l.length > 0);

  if (raw.length === 0) {
    return {
      ok: false,
      error: "No labels in that paste. One label per line (commas and semicolons also split).",
    };
  }
  if (raw.length > UNIT_BULK_MAX_LABELS) {
    return {
      ok: false,
      error:
        `That paste has ${raw.length.toLocaleString("en-US")} labels — more than the ` +
        `${UNIT_BULK_MAX_LABELS} a single bulk create will attempt. Paste it in batches.`,
    };
  }
  const long = tooLong(raw);
  if (long.length > 0) {
    return {
      ok: false,
      error: `"${long[0]}" is longer than ${UNIT_LABEL_MAX_LENGTH} characters. Labels are door numbers, not descriptions.`,
    };
  }
  return { ok: true, expansion: dedupe(raw) };
}

// ----------------------------------------------------------------------------
// The idempotency report
// ----------------------------------------------------------------------------

/**
 * What a bulk create actually did. `created` and `existed` are DISJOINT and
 * together cover every attempted label — that is the whole contract, and it is
 * asserted in tests/unit/padInventory.test.ts.
 *
 * Why the split is stated rather than summed: `(org, property, label)` is
 * unique, so re-running a bulk create is safe — but "safe" must not read as
 * "did nothing wrong AND did something". An operator who re-pastes a roll after
 * adding six pads needs to see 6 created / 54 already there. Reporting only a
 * total would let them believe they had 120 pads.
 */
export interface UnitBulkCreateReport {
  /** Labels that did not exist and now do. */
  created: string[];
  /** Labels the unique index already held — untouched, NOT overwritten. */
  existed: string[];
  /** Labels the input repeated; attempted once each. */
  duplicateLabels: string[];
  attemptedCount: number;
  createdCount: number;
  existedCount: number;
}

/**
 * Build the report from the attempted labels and the ones the INSERT actually
 * returned. Pure, so the disjointness contract is testable without a database.
 */
export function buildBulkCreateReport(
  attempted: string[],
  createdLabels: ReadonlyArray<string>,
  duplicateLabels: ReadonlyArray<string> = [],
): UnitBulkCreateReport {
  const createdSet = new Set(createdLabels);
  const created = attempted.filter((l) => createdSet.has(l));
  const existed = attempted.filter((l) => !createdSet.has(l));
  return {
    created,
    existed,
    duplicateLabels: [...duplicateLabels],
    attemptedCount: attempted.length,
    createdCount: created.length,
    existedCount: existed.length,
  };
}

/**
 * The sentence the operator reads after a bulk create. It always names BOTH
 * numbers — "nothing new" is a result, not a failure, and hiding it is how a
 * re-run comes to look like a fresh import.
 */
export function describeBulkCreateReport(
  report: UnitBulkCreateReport,
  vocab: UnitKindVocabulary,
): string {
  if (report.attemptedCount === 0) return "Nothing to create.";
  if (report.createdCount === 0) {
    return `No new ${vocab.plural}. All ${report.attemptedCount} labels already exist on this property.`;
  }
  if (report.existedCount === 0) {
    return `Created ${countUnits(report.createdCount, vocab)}.`;
  }
  return (
    `Created ${countUnits(report.createdCount, vocab)}. ` +
    `${report.existedCount} already existed and ${report.existedCount === 1 ? "was" : "were"} left untouched.`
  );
}

// ----------------------------------------------------------------------------
// Rent-roll paste
// ----------------------------------------------------------------------------
//
// `POST /api/parcels/:id/rent-roll/import` has existed since BH-3 and had ZERO
// callers anywhere in the repo — the classic built-but-unwired defect. Its
// payload already carries `unitKind`, which is the only path by which a whole
// park's worth of PADS arrives in one action, so leaving it undriven was the
// difference between a field the server accepts and a thing an operator can do.
//
// The parser is deliberately dumb: comma-separated columns in a FIXED order.
// It does not sniff headers or guess which column means what — a mis-guessed
// column here would silently write the wrong rent onto somebody's tenancy.
// Pure, so the column contract is a test rather than a click-through.

export interface RentRollPasteRow {
  unit: string;
  tenantFirst?: string;
  tenantLast?: string;
  rentCents: number;
  isVacant: boolean;
}

export interface RentRollPasteResult {
  rows: RentRollPasteRow[];
  /** Per-line refusals, named. A row that cannot be read is never guessed at. */
  errors: string[];
}

/** `label, tenant first, tenant last, monthly rent` — one row per line. */
export function parseRentRollPaste(text: string): RentRollPasteResult {
  const rows: RentRollPasteRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");

  lines.forEach((line, i) => {
    const cols = line.split(",").map((c) => c.trim());
    const label = cols[0] ?? "";
    if (label === "") {
      errors.push(`Line ${i + 1}: no label in the first column.`);
      return;
    }
    // A fifth column almost always means a thousands separator inside the rent
    // ("$1,400"), which would otherwise be read as a rent of $1 — silently, and
    // onto a real tenancy. REFUSE and name the cause rather than repair it: a
    // repaired guess here writes a number nobody typed.
    if (cols.length > 4) {
      errors.push(
        `Line ${i + 1}: ${cols.length} columns, expected 4. ` +
        `If the rent has a thousands separator ("$1,400"), remove the comma — it is splitting the row.`,
      );
      return;
    }
    const rentRaw = (cols[3] ?? "").replace(/[$]/g, "").trim();
    const rent = rentRaw === "" ? 0 : Number.parseFloat(rentRaw);
    if (!Number.isFinite(rent) || rent < 0) {
      errors.push(`Line ${i + 1}: "${cols[3]}" is not a rent amount.`);
      return;
    }
    const first = cols[1] ?? "";
    const last = cols[2] ?? "";
    rows.push({
      unit: label,
      tenantFirst: first || undefined,
      tenantLast: last || undefined,
      rentCents: Math.round(rent * 100),
      // Vacancy is asserted by the ABSENCE OF A TENANT NAME, which is the shape
      // every seller's roll actually arrives in. It is NOT inferred from a zero
      // rent — a $0 line on an occupied unit is an employee or manager unit,
      // not a vacancy, and calling it vacant would move a real tenancy out of
      // the occupancy numerator.
      isVacant: first === "" && last === "",
    });
  });

  return { rows, errors };
}
