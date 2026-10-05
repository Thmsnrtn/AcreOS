/**
 * The one ceiling on a whole-book read, and the one error it raises.
 *
 * A whole-book read pages to the end and REFUSES past this ceiling rather
 * than cutting the set short (DEFECT-0170/0171). The refusal began life as an
 * export error ("contact support for a bulk export"), but the same pager now
 * serves the focus list, due diligence, comps (whose message reaches the
 * model's context), the parcel backfill and list scrubbing — so the wording
 * is neutral unless the caller says it is an export.
 *
 * No imports, deliberately: wholeOrgReadsG keeps its own pager to avoid the
 * sampleSeeder → wholeBookReads → sampleFilters → sampleSeeder cycle, and
 * both pagers must throw this one class.
 */

/** Far above any real book; a larger set is refused, never truncated. */
export const READ_ROW_CEILING = 250_000;

export type ReadPurpose = "read" | "export";

export class ReadCeilingError extends Error {
  /** 413: surfaced as-is by Errors.internal instead of a generic 500. */
  readonly statusCode = 413;
  readonly code: "EXPORT_TOO_LARGE" | "READ_TOO_LARGE";
  constructor(kind: string, purpose: ReadPurpose = "read") {
    const limit = READ_ROW_CEILING.toLocaleString("en-US");
    super(
      purpose === "export"
        ? `This ${kind} export exceeds ${limit} rows — contact support for a bulk export; nothing was truncated.`
        : `This read exceeds ${limit} ${kind} rows — too many to process in one request; nothing was truncated.`,
    );
    this.name = "ReadCeilingError";
    this.code = purpose === "export" ? "EXPORT_TOO_LARGE" : "READ_TOO_LARGE";
  }
}
