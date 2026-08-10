/**
 * Continuity kit — the deputy break-glass kit, read as evidence (O7 / P5 §6).
 *
 * WHY
 * ───
 * "What happens if you get hit by a bus" is a real sales objection for a
 * one-person platform, and the honest answer today is uncomfortable. The
 * temptation is to write a reassuring page. This module exists so that the
 * page can only ever say what is actually true: it PARSES the kit document
 * (docs/runbooks/deputy-break-glass-kit.md) and DERIVES which pieces of the
 * kit exist, from evidence that prose cannot fake:
 *
 *   • `file`        — a runbook that must resolve on disk. A deleted runbook
 *                     turns its piece absent, whatever the kit says.
 *   • `declaration` — a named field in the kit's machine-read block. A
 *                     PLACEHOLDER value (`(none named)`) derives ABSENT; only
 *                     a real value counts. This is the refuse-not-fabricate
 *                     hinge: "no deputy is named" must be representable, and
 *                     must be the DEFAULT, not something someone remembers to
 *                     write down.
 *   • `doc-section` — a section of the kit that must carry real content, not
 *                     a stub heading.
 *
 * FRESHNESS
 * ─────────
 * A kit is only as good as its last read-through: people move, numbers
 * change, password-manager access lapses. The kit therefore carries an
 * append-only review ledger and expires after REVIEW_INTERVAL_DAYS. This
 * deliberately MIRRORS the DR-drill freshness mechanism
 * (docs/runbooks/dr-drill-history.md + tests/unit/drDrillFreshness.test.ts)
 * rather than inventing a second one — same block grammar, same
 * honest-dormant zero state (a never-reviewed kit must keep SAYING it has
 * never been reviewed; it must not hard-fail CI forever, and it must never
 * render green).
 *
 * WHAT THIS MODULE GRANTS: nothing. `deputyPermitted` is a DECLARED list of
 * what a trusted human may do — it mints no session, no token, no role. And
 * the constitutional hard stops (pricing, legal signing, spends over $500,
 * customer-data deletion, money custody, self-patch merges) are derived from
 * shared/governance/constitution.ts and are structurally un-grantable: any
 * proposed deputy permission naming a hard-stop id is REFUSED here, on the
 * production path, not merely discouraged in prose.
 *
 * Drill EXECUTION (the 7-day hands-off vacation test) is a founder act, not
 * code. This module reads the kit and reports its state; it schedules
 * nothing and pages nobody.
 */
import fs from "node:fs";
import path from "node:path";
import { CONSTITUTION } from "@shared/governance/constitution";

/** Repo-relative path to the kit document. */
const KIT_DOC = "docs/runbooks/deputy-break-glass-kit.md";

/**
 * How long a kit review stays good. Quarterly cadence + slack, matching the
 * DR drill's 100-day bound so "stale" means one thing across the ops layer.
 * The kit document states this number in prose and the exit test pins the
 * two together, so they cannot drift.
 */
const REVIEW_INTERVAL_DAYS = 100;

/** A doc section needs real content, not a stub heading, to count as present. */
const MIN_SECTION_CHARS = 200;

// ── Shapes ──────────────────────────────────────────────────────────────────

export type ContinuityEvidence =
  | { kind: "file"; path: string }
  | { kind: "declaration"; field: string }
  | { kind: "doc-section"; heading: string };

export interface ContinuityPieceDef {
  /** Stable key — never reused. */
  key: string;
  /** What the deputy needs, in the deputy's own words. */
  what: string;
  /** Why it matters when the founder is unreachable. */
  why: string;
  evidence: ContinuityEvidence;
  /** What a founder must actually DO to put an absent piece in place. */
  fix: string;
}

export interface ContinuityPieceState extends ContinuityPieceDef {
  present: boolean;
  /** One honest line of state. An absent piece says so; it never renders a check. */
  detail: string;
}

export interface DeputyActionDef {
  key: string;
  what: string;
  /**
   * Constitution invariant ids this action would touch. Naming a hard stop
   * gets the action REFUSED — a hard stop is not delegable at any price.
   */
  hardStopsTouched?: string[];
}

export interface RefusedDeputyAction extends DeputyActionDef {
  refusedBecause: string;
}

export interface NonDelegableHardStop {
  id: string;
  title: string;
  statement: string;
  enforcementKind: string;
  refs: string[];
}

export type ContinuityFreshness = "no-kit" | "never-reviewed" | "fresh" | "stale";

export type ContinuityVerdict =
  | "no-kit" // the kit document is not in this deployment
  | "incomplete" // at least one required piece is absent
  | "unreviewed" // complete, but never read through
  | "stale" // complete, but the last review aged out
  | "ready"; // complete AND reviewed within the interval

export interface ContinuityKitRead {
  docPath: string;
  docPresent: boolean;
  kitVersion: string | null;
  reviewIntervalDays: number;
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  reviewAgeDays: number | null;
  /**
   * The kit's own record of the last 7-day hands-off vacation drill, or null
   * when it records none. DERIVED from the doc so the founder surface stops
   * hardcoding "has not been run" — a sentence that would have gone stale the
   * moment a drill happened (fleet-9 verifier catch).
   */
  lastVacationDrill: string | null;
  freshness: ContinuityFreshness;
  pieces: ContinuityPieceState[];
  piecesRequired: number;
  piecesPresent: number;
  missingPieces: string[];
  verdict: ContinuityVerdict;
  /** The whole state in one honest sentence — safe to render verbatim. */
  headline: string;
  nonDelegable: NonDelegableHardStop[];
  deputyPermitted: DeputyActionDef[];
  deputyRefused: RefusedDeputyAction[];
}

export interface ContinuityKitReadOptions {
  /** Injected clock — keeps the derivation deterministic under test. */
  now?: Date;
  /**
   * Inject the kit markdown instead of reading it from disk. `null` models a
   * deployment that does not carry the document at all.
   */
  docText?: string | null;
  /** Inject repo-relative file existence (defaults to the real filesystem). */
  fileExists?: (repoRelPath: string) => boolean;
  /**
   * Proposed deputy permissions to run through the same refusal filter the
   * built-in list goes through. A proposal naming a hard stop lands in
   * `deputyRefused` — the filter is on the production path, not a test seam.
   */
  proposedDeputyActions?: DeputyActionDef[];
}

// ── The kit's required pieces ───────────────────────────────────────────────
//
// Ordered as a deputy would need them: who they are and what lets them act,
// then the documents they read, then the written judgement calls.

const CONTINUITY_PIECES: readonly ContinuityPieceDef[] = [
  {
    key: "deputy-named",
    what: "A named, trusted deputy",
    why: "Every other piece of this kit is addressed to a person. Without one, the kit is a document nobody has been asked to read.",
    evidence: { kind: "declaration", field: "deputy-name" },
    fix: "Choose the person, tell them, and write their name into the kit's declarations block.",
  },
  {
    key: "deputy-contact",
    what: "A way to reach the deputy that does not depend on AcreOS",
    why: "The likeliest moment to need them is the moment the app, the founder's phone, or both are unavailable.",
    evidence: { kind: "declaration", field: "deputy-contact" },
    fix: "Record a phone number and an email address outside this system, then write them into the declarations block.",
  },
  {
    key: "deputy-authority",
    what: "The deputy's written authority to act",
    why: "Vendors, a bank, and the deputy themselves all need to know what they are actually permitted to do on the company's behalf.",
    evidence: { kind: "declaration", field: "deputy-authority-doc" },
    fix: "Have counsel draft a limited authority (scoped to operations, explicitly excluding the hard stops), execute it, and cite it in the declarations block. Signing is founder-only.",
  },
  {
    key: "credential-custody",
    what: "A custody path for credentials the deputy would need",
    why: "Without it a deputy cannot log in anywhere — including the in-app panic stop, which is founder-gated.",
    evidence: { kind: "declaration", field: "credential-custody" },
    fix: "Provision emergency access in the password manager (with a delay window) and describe the path in the declarations block. Never paste secrets into this document.",
  },
  {
    key: "founder-emergency-contact",
    what: "Someone who can say whether the founder is reachable",
    why: "A deputy needs to distinguish 'on a flight' from 'in a hospital' before deciding how long to hold a decision.",
    evidence: { kind: "declaration", field: "founder-emergency-contact" },
    fix: "Name a personal emergency contact, ask them first, then record them in the declarations block.",
  },
  {
    key: "outage-card",
    what: "The outage card (is AcreOS dark?)",
    why: "First triage: prove it is down, find who hosts what, know which vendor to call.",
    evidence: { kind: "file", path: "docs/runbooks/break-glass-card.md" },
    fix: "Restore docs/runbooks/break-glass-card.md — the deputy's first read.",
  },
  {
    key: "absence-runbook",
    what: "Severity routing while the founder is away",
    why: "Tells the deputy which classes of problem they take, which they hold, and how long to wait.",
    evidence: { kind: "file", path: "docs/runbooks/08-founder-out-of-office.md" },
    fix: "Restore docs/runbooks/08-founder-out-of-office.md.",
  },
  {
    key: "account-recovery-runbook",
    what: "Founder-account recovery",
    why: "The kit's most likely failure is not a dead server — it is nobody being able to sign in.",
    evidence: { kind: "file", path: "docs/runbooks/founder-account-recovery.md" },
    fix: "Restore docs/runbooks/founder-account-recovery.md.",
  },
  {
    key: "action-log",
    what: "An append-only log for whatever the deputy does",
    why: "The founder's first act on return is to read what happened and confirm or roll it back. That requires a record.",
    evidence: { kind: "file", path: "docs/runbooks/break-glass-log.md" },
    fix: "Restore docs/runbooks/break-glass-log.md.",
  },
  {
    key: "non-delegable-written",
    what: "The written list of what a deputy may never do",
    why: "An emergency is exactly when someone talks themselves into a pricing exception or a signature.",
    evidence: { kind: "doc-section", heading: "What a deputy may NEVER do" },
    fix: "Restore the kit's non-delegable hard-stops section (it derives from the constitution).",
  },
  {
    key: "panic-stop-path",
    what: "Written instructions for reaching the panic stop",
    why: "Stopping the machine is the one destructive-looking control that is always safe; a deputy must not have to guess how.",
    evidence: { kind: "doc-section", heading: "The panic stop" },
    fix: "Restore the kit's panic-stop section, including its honest note about founder-gating.",
  },
  {
    key: "customer-message",
    what: "What to tell customers",
    why: "Silence and improvisation are both worse than one accurate paragraph.",
    evidence: { kind: "doc-section", heading: "What to tell customers" },
    fix: "Restore the kit's customer-message section.",
  },
];

// ── What a deputy may do (declared, never granted) ──────────────────────────

const DEPUTY_ACTIONS: readonly DeputyActionDef[] = [
  {
    key: "prove-outage",
    what: "Prove whether the site is really down, then work the outage card's triage",
  },
  {
    key: "restart-machine",
    what: "Restart a stopped application machine at the hosting provider",
  },
  {
    key: "panic-stop",
    what: "Trip the panic stop — halting the autopilot is always allowed; resuming is not",
  },
  {
    key: "answer-customers",
    what: "Reply to a customer with the kit's acknowledgement script, committing to nothing",
  },
  {
    key: "escalate-vendor",
    what: "Escalate to the hosting, payments, or paging vendor using the outage card's contacts",
  },
  {
    key: "follow-runbook",
    what: "Follow any numbered runbook in the runbooks index",
  },
  {
    key: "write-log",
    what: "Record every action in the append-only break-glass log, before and after",
  },
];

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * The machine-read declarations block: the fenced block that follows the
 * `<!-- continuity-kit:declarations -->` marker. Nothing outside that block
 * is read, so ordinary prose in the kit can never be mistaken for a
 * declaration.
 */
function parseDeclarations(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const marker = md.indexOf("<!-- continuity-kit:declarations -->");
  if (marker === -1) return out;
  const open = md.indexOf("```", marker);
  if (open === -1) return out;
  const bodyStart = md.indexOf("\n", open);
  const close = md.indexOf("```", bodyStart);
  if (bodyStart === -1 || close === -1) return out;
  for (const line of md.slice(bodyStart + 1, close).split("\n")) {
    const m = line.match(/^\s*([a-z0-9][a-z0-9-]*)\s*:\s*(.*?)\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/**
 * A declared value is ABSENT when it is empty or a parenthesised placeholder
 * — `(none named)`, `(none executed)`, `(not provisioned)`. This is the one
 * rule that keeps "we have a deputy" from being the default state of a
 * document nobody has filled in.
 */
function declarationIsAbsent(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (v.length === 0) return true;
  if (/^\((?:none|not|no|tbd|todo)\b[^)]*\)$/i.test(v)) return true;
  return /^(?:tbd|todo|n\/a|none|unknown)$/i.test(v);
}

/** The body of the first section whose heading contains `heading`. */
function sectionBody(md: string, heading: string): string | null {
  const lines = md.split("\n");
  const needle = heading.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (!/^#{1,4}\s/.test(lines[i])) continue;
    if (!lines[i].toLowerCase().includes(needle)) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,4}\s/.test(lines[j])) break;
      body.push(lines[j]);
    }
    return body.join("\n").trim();
  }
  return null;
}

/**
 * Review-block dates. A block's first line is `YYYY-MM-DD reviewed-by=<login>`
 * (the kit's own Format header). The template line inside the format fence
 * uses the literal "YYYY-MM-DD", which \d+ can never match — so documenting
 * the format never counts as a review.
 */
function parseReviews(md: string): Array<{ date: string; by: string }> {
  return [...md.matchAll(/^(\d{4}-\d{2}-\d{2})\s+reviewed-by=(\S+)/gm)].map((m) => ({
    date: m[1],
    by: m[2],
  }));
}

// ── Derivation ──────────────────────────────────────────────────────────────

function realFileExists(repoRelPath: string): boolean {
  try {
    return fs.existsSync(path.resolve(process.cwd(), repoRelPath));
  } catch {
    return false;
  }
}

function readKitDoc(): string | null {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), KIT_DOC), "utf-8");
  } catch {
    return null;
  }
}

function nonDelegableHardStops(): NonDelegableHardStop[] {
  return CONSTITUTION.filter((i) => i.category === "hard-stop").map((i) => ({
    id: i.id,
    title: i.title,
    statement: i.statement,
    enforcementKind: i.enforcement.kind,
    refs: [...i.enforcement.refs],
  }));
}

/**
 * Split proposed + built-in deputy permissions into what a human may do and
 * what is structurally refused. A permission naming a constitutional hard
 * stop is never grantable — not by the founder in a hurry, not by a future
 * surface, not by an agent editing a list.
 */
function partitionDeputyActions(
  actions: readonly DeputyActionDef[],
  hardStopIds: Set<string>,
): { permitted: DeputyActionDef[]; refused: RefusedDeputyAction[] } {
  const permitted: DeputyActionDef[] = [];
  const refused: RefusedDeputyAction[] = [];
  for (const action of actions) {
    const hits = (action.hardStopsTouched ?? []).filter((id) => hardStopIds.has(id));
    if (hits.length > 0) {
      refused.push({
        ...action,
        refusedBecause: `Touches a founder-only hard stop (${hits.join(", ")}) — not delegable to anyone, in any situation.`,
      });
    } else {
      permitted.push(action);
    }
  }
  return { permitted, refused };
}

function pieceState(
  def: ContinuityPieceDef,
  md: string,
  fileExists: (rel: string) => boolean,
  declarations: Record<string, string>,
): ContinuityPieceState {
  switch (def.evidence.kind) {
    case "file": {
      const present = fileExists(def.evidence.path);
      return {
        ...def,
        present,
        detail: present
          ? `Present: ${def.evidence.path}`
          : `Not in place — ${def.evidence.path} does not resolve in this deployment.`,
      };
    }
    case "declaration": {
      const raw = declarations[def.evidence.field];
      const present = !declarationIsAbsent(raw);
      return {
        ...def,
        present,
        detail: present
          ? `${raw}`
          : `Not in place — the kit declares ${def.evidence.field} as ${raw?.trim() || "(unset)"}.`,
      };
    }
    case "doc-section": {
      const body = sectionBody(md, def.evidence.heading);
      const present = (body?.length ?? 0) >= MIN_SECTION_CHARS;
      return {
        ...def,
        present,
        detail: present
          ? `Written up in the kit under "${def.evidence.heading}".`
          : body === null
            ? `Not in place — the kit has no "${def.evidence.heading}" section.`
            : `Not in place — the kit's "${def.evidence.heading}" section is a stub.`,
      };
    }
  }
}

function buildHeadline(
  verdict: ContinuityVerdict,
  present: number,
  total: number,
  missing: ContinuityPieceState[],
  ageDays: number | null,
  interval: number,
): string {
  switch (verdict) {
    case "no-kit":
      // Say WHY, precisely. The deployed image excludes docs/ (.dockerignore,
      // for build-context size), so a running server legitimately cannot read
      // the kit — the same reason the break-glass card email refuses in prod.
      // "Missing" without that context would read as "someone deleted the
      // kit", which is a different and much worse claim.
      return (
        `The continuity kit document is not readable from this deployment (${KIT_DOC}) — ` +
        `nothing about founder-absence can be verified from here. The deployed image excludes docs/, ` +
        `so this is the expected state in production; the kit itself lives in the repository, where ` +
        `tests/unit/continuityKit.test.ts enforces its completeness and freshness on every build.`
      );
    case "incomplete":
      return (
        `${present} of ${total} pieces of the deputy break-glass kit are in place. ` +
        `Still missing: ${missing.map((p) => p.what).join("; ")}.`
      );
    case "unreviewed":
      return `All ${total} pieces are in place, but this kit has never been read through end to end — walk it and append a review block.`;
    case "stale":
      return `All ${total} pieces are in place, but the last review was ${ageDays} days ago — past the ${interval}-day interval, so treat the kit as stale until it is walked again.`;
    case "ready":
      return `All ${total} pieces are in place and the kit was reviewed ${ageDays} days ago.`;
  }
}

/**
 * The whole continuity read: which pieces exist, how fresh the kit is, what a
 * deputy may do, and what can never be delegated. Pure apart from reading the
 * kit document and checking file existence — both injectable.
 */
export function readContinuityKit(opts: ContinuityKitReadOptions = {}): ContinuityKitRead {
  const now = opts.now ?? new Date();
  const fileExists = opts.fileExists ?? realFileExists;
  const md = opts.docText === undefined ? readKitDoc() : opts.docText;

  const hardStops = nonDelegableHardStops();
  const hardStopIds = new Set(hardStops.map((h) => h.id));
  const { permitted, refused } = partitionDeputyActions(
    [...DEPUTY_ACTIONS, ...(opts.proposedDeputyActions ?? [])],
    hardStopIds,
  );

  if (md === null) {
    return {
      docPath: KIT_DOC,
      docPresent: false,
      kitVersion: null,
      reviewIntervalDays: REVIEW_INTERVAL_DAYS,
      lastReviewedAt: null,
      lastReviewedBy: null,
      reviewAgeDays: null,
      lastVacationDrill: null,
      freshness: "no-kit",
      // Refuse, don't fabricate: with no document there is no evidence for
      // ANY piece — they render absent, not unknown-but-probably-fine.
      pieces: CONTINUITY_PIECES.map((def) => ({
        ...def,
        present: false,
        detail: `Not in place — the kit document is missing, so nothing can be verified.`,
      })),
      piecesRequired: CONTINUITY_PIECES.length,
      piecesPresent: 0,
      missingPieces: CONTINUITY_PIECES.map((p) => p.key),
      verdict: "no-kit",
      headline: buildHeadline("no-kit", 0, CONTINUITY_PIECES.length, [], null, REVIEW_INTERVAL_DAYS),
      nonDelegable: hardStops,
      deputyPermitted: permitted,
      deputyRefused: refused,
    };
  }

  const declarations = parseDeclarations(md);
  const pieces = CONTINUITY_PIECES.map((def) => pieceState(def, md, fileExists, declarations));
  const missing = pieces.filter((p) => !p.present);
  const present = pieces.length - missing.length;

  const reviews = parseReviews(md);
  let lastReviewedAt: string | null = null;
  let lastReviewedBy: string | null = null;
  let reviewAgeDays: number | null = null;
  if (reviews.length > 0) {
    const newest = reviews.reduce((a, b) => (a.date >= b.date ? a : b));
    lastReviewedAt = newest.date;
    lastReviewedBy = newest.by;
    reviewAgeDays = Math.floor(
      (now.getTime() - Date.parse(`${newest.date}T00:00:00Z`)) / 86_400_000,
    );
  }

  const freshness: ContinuityFreshness =
    reviewAgeDays === null
      ? "never-reviewed"
      : reviewAgeDays > REVIEW_INTERVAL_DAYS
        ? "stale"
        : "fresh";

  // The kit states its own drill history in one bolded line. NONE (any case)
  // means never run — parsed to null so the surface says so from data rather
  // than from a hardcoded sentence that cannot age.
  const vacationMatch = md.match(/\*\*Last vacation-test drill:\s*([^*]+?)\*\*/i);
  const vacationRaw = vacationMatch ? vacationMatch[1].trim() : null;
  const lastVacationDrill =
    vacationRaw === null || /^none\b/i.test(vacationRaw) ? null : vacationRaw.replace(/[.\s]+$/, "");

  const verdict: ContinuityVerdict =
    missing.length > 0
      ? "incomplete"
      : freshness === "never-reviewed"
        ? "unreviewed"
        : freshness === "stale"
          ? "stale"
          : "ready";

  return {
    docPath: KIT_DOC,
    docPresent: true,
    kitVersion: declarations["kit-version"] ?? null,
    reviewIntervalDays: REVIEW_INTERVAL_DAYS,
    lastReviewedAt,
    lastReviewedBy,
    reviewAgeDays,
    lastVacationDrill,
    freshness,
    pieces,
    piecesRequired: pieces.length,
    piecesPresent: present,
    missingPieces: missing.map((p) => p.key),
    verdict,
    headline: buildHeadline(
      verdict,
      present,
      pieces.length,
      missing,
      reviewAgeDays,
      REVIEW_INTERVAL_DAYS,
    ),
    nonDelegable: hardStops,
    deputyPermitted: permitted,
    deputyRefused: refused,
  };
}
