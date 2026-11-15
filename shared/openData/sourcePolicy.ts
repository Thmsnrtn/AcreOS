/**
 * Source dossiers and policy blocks — D1 amendment A2 (data-sourcing v2 §1.3)
 * and the use-class record of design §12.
 *
 * A DOSSIER is what a person established by reading a source's terms: for each
 * use class (internal / display / redistribution / resale) either "unresolved"
 * or a finding — allowed or forbidden — with the words that decided it and the
 * day they were read. A POLICY BLOCK is the machine-readable answer derived
 * from the dossier, and from nothing else:
 *
 *   can_display, can_export, can_mail, can_resell, can_cache, attribution_required
 *
 * Restrictive by default: an unresolved use class yields `false` for every
 * permission that depends on it, and an unresolved attribution question yields
 * `attribution_required: true` (requiring credit is the restrictive answer —
 * `false` there would mean "no attribution needed", which is a permission).
 *
 * Enforcement points: ingestAdmission() is consulted by the statewide bulk
 * build BEFORE any fetch (first-party ingest package §3.1, 2026-11-03), and
 * the build's upload gate reads the policy block. effectiveDossier() applies
 * the re-verification radar first, so a lapsed dossier is restrictive
 * everywhere it is read.
 */

const USE_CLASSES = ["internal", "display", "redistribution", "resale"] as const;
export type UseClass = (typeof USE_CLASSES)[number];

export type UseClassFinding =
  | { status: "unresolved"; why: string }
  | {
      status: "allowed" | "forbidden";
      /** The terms' own words that decided it — quoted, never paraphrased into a yes. */
      evidence: string;
      /** ISO date the terms were read. */
      readOn: string;
    };

export interface SourceDossier {
  /** Where the governing terms live (from the source seed). Null when none is published. */
  termsUrl: string | null;
  /** ISO date someone last read termsUrl for this dossier; null = never read. */
  termsReadOn: string | null;
  useClasses: Record<UseClass, UseClassFinding>;
  /** null = not established; then attribution is required (restrictive). */
  attributionRequired: boolean | null;
  /** Restrictions recorded against the source that are not a use class (e.g. a statute on owner names). */
  restrictions: string[];
  /**
   * Re-verification radar (data-sourcing v2 §1.3). ISO date by which the
   * terms must be read again. ON that date and after, effectiveDossier()
   * treats every finding as unresolved — the policy block tightens to
   * restrictive and ingest refuses — until a person re-reads the terms and
   * moves the date. Absent/null = no date recorded (a never-resolved dossier).
   */
  reverifyBy?: string | null;
  /** Events that require re-verification BEFORE the date — data, not comments (e.g. "the V13 release"). */
  reverifyTriggers?: string[];
  /**
   * Mail use (addressing mail to the record owner). Never derived from
   * internal use: counsel Q-12.3 is open for every source (first-party ingest
   * package §5, 2026-11-03), so can_mail is false unless this finding is
   * explicitly "allowed". Absent = unresolved.
   */
  mail?: UseClassFinding;
}

export interface SourcePolicy {
  can_display: boolean;
  can_export: boolean;
  can_mail: boolean;
  can_resell: boolean;
  can_cache: boolean;
  attribution_required: boolean;
}

const allowed = (f: UseClassFinding): boolean => f.status === "allowed";

/**
 * The policy block, derived ONLY from the dossier's findings:
 *  - can_cache   ← internal use allowed (keeping a copy for our own processing);
 *  - can_mail    ← an EXPLICIT mail finding (allowed) AND internal use allowed.
 *                  Never derived from internal use alone (first-party ingest
 *                  package §5: counsel Q-12.3 is open for every source; MT's
 *                  statutory list prohibition is the standing warning);
 *  - can_display ← display allowed;
 *  - can_export  ← redistribution allowed;
 *  - can_resell  ← resale allowed;
 *  - attribution_required ← the dossier's answer, or true when unestablished.
 */
export function policyFromDossier(d: SourceDossier): SourcePolicy {
  const internal = allowed(d.useClasses.internal);
  return {
    can_display: allowed(d.useClasses.display),
    can_export: allowed(d.useClasses.redistribution),
    can_mail: internal && d.mail !== undefined && allowed(d.mail),
    can_resell: allowed(d.useClasses.resale),
    can_cache: internal,
    attribution_required: d.attributionRequired ?? true,
  };
}

/** Use classes a dossier has not resolved — the honest "why not" list. */
export function unresolvedUseClasses(d: SourceDossier): UseClass[] {
  return USE_CLASSES.filter((u) => d.useClasses[u].status === "unresolved");
}

/** Has the dossier's re-verification date arrived? False when no date is recorded. */
function reverificationLapsed(d: SourceDossier, now: Date): boolean {
  if (!d.reverifyBy) return false;
  const due = Date.parse(`${d.reverifyBy}T00:00:00Z`);
  // An unparseable date cannot vouch for anything: treat it as lapsed.
  return !Number.isFinite(due) || now.getTime() >= due;
}

/**
 * The dossier as the radar lets it stand at `now`: unchanged while its
 * re-verification date is in the future, otherwise every finding (use classes,
 * mail, attribution) reverts to unresolved — restrictive — naming the lapse.
 * The recorded findings are kept by the caller; only a person re-reading the
 * terms and moving `reverifyBy` restores them.
 */
export function effectiveDossier(d: SourceDossier, now: Date): SourceDossier {
  if (!reverificationLapsed(d, now)) return d;
  const why = `re-verification lapsed on ${d.reverifyBy} — restrictive until a person re-reads the terms and records a new reverifyBy`;
  const u: UseClassFinding = { status: "unresolved", why };
  return {
    ...d,
    useClasses: { internal: u, display: u, redistribution: u, resale: u },
    mail: u,
    attributionRequired: null,
  };
}

export interface IngestAdmission {
  /** Ingest (fetch + warehouse) may run: the effective dossier allows internal use. */
  admitted: boolean;
  reasons: string[];
}

/**
 * Ingest is the INTERNAL use class (warehouse/load + serve answers). A source
 * is admitted only when its effective dossier — after the radar — finds
 * internal use allowed. Consulted BEFORE any fetch: a refused source is never
 * read, not even into a local dry run.
 */
export function ingestAdmission(source: string, d: SourceDossier | undefined, now: Date): IngestAdmission {
  if (!d) return { admitted: false, reasons: [`${source}: no dossier — "unclear" = unshipped`] };
  const eff = effectiveDossier(d, now);
  const f = eff.useClasses.internal;
  if (f.status === "allowed") {
    // Every ingested source carries a re-verification date (v2 §1.3): a
    // finding with no date would be admitted forever, so it is not admitted.
    if (!d.reverifyBy) return { admitted: false, reasons: [`${source}: internal use allowed but no reverifyBy recorded — a resolved dossier must carry its re-verification date`] };
    return { admitted: true, reasons: [] };
  }
  if (f.status === "unresolved") return { admitted: false, reasons: [`${source}: internal use UNRESOLVED — ${f.why}`] };
  return { admitted: false, reasons: [`${source}: internal use FORBIDDEN by its terms — ${f.evidence}`] };
}

/** A dossier with every use class unresolved, for one stated reason. */
export function unresolvedDossier(
  termsUrl: string | null,
  why: string,
  restrictions: string[] = [],
): SourceDossier {
  const u: UseClassFinding = { status: "unresolved", why };
  return {
    termsUrl,
    termsReadOn: null,
    useClasses: { internal: u, display: u, redistribution: u, resale: u },
    attributionRequired: null,
    restrictions,
  };
}
