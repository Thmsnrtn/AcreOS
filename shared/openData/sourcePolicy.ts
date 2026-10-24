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
 * No runtime enforcement point reads these yet (D1 scope): the fields and their
 * defaults are the deliverable, so a later enforcement point has one place to
 * ask and cannot be handed a guessed "yes".
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
 *  - can_mail    ← internal use allowed (addressing mail to the record owner
 *                  from data used internally) — to be confirmed against §12;
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
    can_mail: internal,
    can_resell: allowed(d.useClasses.resale),
    can_cache: internal,
    attribution_required: d.attributionRequired ?? true,
  };
}

/** Use classes a dossier has not resolved — the honest "why not" list. */
export function unresolvedUseClasses(d: SourceDossier): UseClass[] {
  return USE_CLASSES.filter((u) => d.useClasses[u].status === "unresolved");
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
