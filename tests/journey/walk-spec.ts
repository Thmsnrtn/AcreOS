/**
 * Journey-proof harness — the declarative walk spec format.
 *
 * One hand-written realdb test per vertical does not scale: every vertical
 * sheet in the ALL-15 program assumes a walk that is declarative, runnable in
 * two environments, and recorded into the repo. This module is the format;
 * `runner.ts` executes it, `drivers/realdb.ts` rehearses it against a real
 * database in CI, `drivers/staging.ts` runs it against staging, and the
 * record writer renders the in-repo evidence record.
 *
 * DESIGN CONSTRAINTS (load-bearing, do not relax casually):
 * - This file imports NOTHING. Specs import only types from here, so the
 *   staging CLI (`scripts/run-journey-walk.mjs`) can load a spec without
 *   pulling in any server module.
 * - Only erasable TypeScript: no enums, no parameter properties, no
 *   namespaces. The staging CLI loads specs under Node type-stripping.
 * - A spec is data + leg closures. Legs use ONLY the WalkContext: `api`,
 *   `sql`, `check`, `store`/`get`, `note`. A leg that imports server code
 *   directly breaks staging portability and fails spec validation review.
 * - The no-send fence is structural: `fences.noSend` is true for every
 *   walk, validation rejects any step that declares `sends: true`, and the
 *   runner records the driver's sent count (realdb) or the dry-run +
 *   recipient-count assertions (staging, where the transport is not
 *   observable from outside).
 */

export type WalkStepKind = "api" | "sql" | "observe" | "pax" | "manual";

export type StepStatus = "pass" | "fail" | "skip" | "manual" | "blocked";

export type DriverName = "realdb" | "staging";

/** What a leg observed, in the leg's own words. Rendered verbatim into the record. */
export interface StepObservation {
  observed: Record<string, unknown>;
  notes?: string[];
}

export interface WalkContext {
  /** The org this walk owns. Realdb: numeric id. Staging: numeric id from GET /api/organization. */
  orgId: number | string;
  /** Which driver is executing the walk — legs branch on it explicitly where an observation exists only on one driver (e.g. SQL row counts). */
  driver: DriverName;
  /** Unique tag for this run (fixture names, slugs, emails derive from it). */
  tag: string;
  /** Authenticated API call against the environment under walk. */
  api: (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: any }>;
  /**
   * Parameterised SQL. Realdb only — the staging driver throws, so a leg
   * that needs setup data on staging MUST provide `stagingRun`.
   */
  sql: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  /** Fail the step with a message naming the expected observation. Throws. */
  check: (condition: boolean, message: string) => void;
  /** Cross-step memory (ids the walk creates). Namespaced per run. */
  store: (key: string, value: unknown) => void;
  get: <T = unknown>(key: string) => T;
  /** Append a free-text note to this step's observation. */
  note: (text: string) => void;
  /** Messages the driver has seen sent. Null where unobservable (staging). */
  sentCount: () => number | null;
}

export interface WalkStep {
  /** Stable id, e.g. "buy-box". Unique within the spec. */
  id: string;
  title: string;
  kind: WalkStepKind;
  /** How the step is performed — operator-readable, kept in the record. */
  how: string;
  /** The expected observation — what PASS means, in plain words. */
  mustObserve: string;
  /**
   * True when the step exercises a simulated act (a provider call that is
   * deliberately not made). Requires `simulationNote`; the record renders
   * the note next to the step AND in the record's simulation footnotes, so
   * a simulation can never be mistaken for the real provider accepting
   * the real call.
   */
  simulated?: boolean;
  simulationNote?: string;
  /**
   * Pax leg state. A `pax` step with state "blocked" is an honest record
   * that the vertical's Pax tools do not exist yet — it is NOT a pass, and
   * the walk report carries it as `blocked` with the reason. The bar
   * requires the leg to be exercised; a blocked leg keeps the walk from
   * ever claiming Pax wiring it did not do.
   */
  paxState?: "exercised" | "blocked";
  paxBlockedReason?: string;
  /**
   * How this step runs on staging. Default: `api` steps run as-is, `sql`
   * steps need `stagingRun`, `manual` steps are operator acts recorded as
   * NOT RUN by the runner. A step that cannot run on staging and has no
   * `stagingRun` must declare mode "manual" with a note naming the
   * operator act — silently skipping is not an option.
   */
  staging?: { mode: "api" | "manual"; note?: string };
  /**
   * Values only a human act can produce (e.g. ids of records the operator
   * created through the UI), collected by the driver before the step is
   * recorded — the staging CLI prompts for them, or takes `--input
   * key=value`. Collected values go into walk memory for later steps.
   * A manual step that needs a collected value and does not get one fails
   * the walk loudly instead of proceeding on an invented id.
   */
  collects?: { key: string; prompt: string }[];
  /** The leg. Receives only the WalkContext. */
  run: (ctx: WalkContext) => Promise<StepObservation>;
  /** Staging-only alternative leg (used when `sql` is unavailable). */
  stagingRun?: (ctx: WalkContext) => Promise<StepObservation>;
}

export interface RealDbRouteMount {
  /** "router": default-export express router mounted at `mount`. "register": named export called with the app. */
  kind: "router" | "register";
  /**
   * Module path RELATIVE TO `drivers/realdb.ts` (e.g. "../../../server/routes-wholesale-buy-box").
   * Specs never import server modules themselves; the realdb driver does.
   */
  module: string;
  /** For kind "router": the mount path (e.g. "/api/wholesale"). */
  mount?: string;
  /** For kind "register": the exported function name (e.g. "registerBuyerBlastRoutes"). */
  exportName?: string;
}

export interface WalkSpec {
  /** Short id, e.g. "wholesale". Used in the run id and record filename. */
  id: string;
  /** Business-type id the walk provisions, e.g. "residential_wholesaler". */
  vertical: string;
  title: string;
  version: number;
  fences: {
    /** Every walk: nothing is ever sent to a real counterparty. */
    noSend: boolean;
    /** Every walk: no real money moves. Fees are records. */
    noRealMoney: boolean;
    /** Every walk: staging only, never production. */
    stagingOnly: boolean;
  };
  org: {
    businessType: string;
    /** Suffix for the fixture org name/slug (the run tag makes it unique). */
    nameSuffix: string;
    /** The walk org starts empty — no sample data. */
    skipSampleData: boolean;
  };
  /** Route modules the realdb driver mounts (ignored by the staging driver). */
  realdbRoutes?: RealDbRouteMount[];
  /** Org-scoped tables the realdb driver deletes on cleanup, in order. */
  cleanupTables: string[];
  steps: WalkStep[];
}

/** Identity helper: gives specs a checked type without adding behaviour. */
export function defineWalkSpec(spec: WalkSpec): WalkSpec {
  return spec;
}

/**
 * Validate a spec. Returns the list of errors; empty means valid. The
 * runner refuses to run an invalid spec, and the spec unit tests pin these
 * rules, so a vertical cannot quietly ship a walk that skips its Pax leg,
 * hides a simulation, or declares a send.
 */
export function validateWalkSpec(spec: WalkSpec): string[] {
  const errors: string[] = [];
  if (!spec.id || !/^[a-z0-9-]+$/.test(spec.id)) {
    errors.push(`spec.id must be a lowercase slug, got ${JSON.stringify(spec.id)}`);
  }
  if (!spec.vertical) errors.push("spec.vertical is required");
  if (!spec.title) errors.push("spec.title is required");
  if (!Number.isInteger(spec.version) || spec.version < 1) {
    errors.push(`spec.version must be a positive integer, got ${String(spec.version)}`);
  }
  if (!spec.fences?.noSend) errors.push("fences.noSend must be true — a walk never sends");
  if (!spec.fences?.noRealMoney) errors.push("fences.noRealMoney must be true — a walk moves no real money");
  if (!spec.fences?.stagingOnly) errors.push("fences.stagingOnly must be true — a walk never runs on production");
  if (!spec.org?.businessType) errors.push("spec.org.businessType is required");
  if (spec.org?.businessType && spec.org.businessType !== spec.vertical) {
    errors.push(
      `spec.org.businessType (${spec.org.businessType}) must equal spec.vertical (${spec.vertical}) — the walk org is the vertical's org`,
    );
  }
  if (!spec.cleanupTables?.length) errors.push("spec.cleanupTables must list the org-scoped tables the realdb driver deletes");
  if (!spec.steps?.length) {
    errors.push("spec.steps must not be empty");
    return errors;
  }
  const ids = new Set<string>();
  let paxLegs = 0;
  for (const step of spec.steps) {
    if (!step.id || !/^[a-z0-9-]+$/.test(step.id)) {
      errors.push(`step id must be a lowercase slug, got ${JSON.stringify(step.id)}`);
    } else if (ids.has(step.id)) {
      errors.push(`duplicate step id: ${step.id}`);
    } else {
      ids.add(step.id);
    }
    if (!step.title) errors.push(`step ${step.id}: title is required`);
    if (!step.how) errors.push(`step ${step.id}: how is required`);
    if (!step.mustObserve) errors.push(`step ${step.id}: mustObserve is required`);
    if (typeof step.run !== "function") errors.push(`step ${step.id}: run must be a function`);
    if (step.simulated && !step.simulationNote) {
      errors.push(`step ${step.id}: simulated steps require simulationNote — a simulation without its footnote is a fabrication risk`);
    }
    if (step.kind === "pax") {
      paxLegs += 1;
      if (step.paxState === "blocked" && !step.paxBlockedReason) {
        errors.push(`step ${step.id}: a blocked Pax leg must name the reason (which tools are missing)`);
      }
      if (step.paxState !== "exercised" && step.paxState !== "blocked") {
        errors.push(`step ${step.id}: a Pax leg must declare paxState "exercised" or "blocked"`);
      }
    }
    if (step.kind === "sql" && !step.stagingRun && step.staging?.mode !== "manual") {
      errors.push(
        `step ${step.id}: sql steps cannot run on staging — provide stagingRun or declare staging.mode "manual" with a note naming the operator act`,
      );
    }
    if (step.kind === "manual" && (step.staging?.mode !== "manual" || !step.staging?.note)) {
      errors.push(`step ${step.id}: manual steps must declare staging.mode "manual" with a note naming the operator act`);
    }
    if (step.collects) {
      const keys = new Set<string>();
      for (const c of step.collects) {
        if (!c.key || !/^[a-zA-Z0-9_]+$/.test(c.key)) errors.push(`step ${step.id}: collect key must be a non-empty identifier, got ${JSON.stringify(c.key)}`);
        if (keys.has(c.key)) errors.push(`step ${step.id}: duplicate collect key ${c.key}`);
        keys.add(c.key);
        if (!c.prompt) errors.push(`step ${step.id}: collect ${c.key} needs a prompt telling the operator where the value comes from`);
      }
    }
  }
  if (paxLegs === 0) {
    errors.push("spec must include at least one Pax leg (kind \"pax\") — bar item (c) is unsatisfiable without it, even as a blocked leg");
  }
  return errors;
}
