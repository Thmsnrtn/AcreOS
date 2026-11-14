/**
 * Pax controls — the ONE reader (AUTONOMY_SPEC.md §4.2).
 *
 * Every engine that acts without a tap asks this module one question —
 * `getPaxControls(orgId)` — and gets back the org's stance, its three
 * "runs on its own" switches, and the pause folded in (holder included).
 * server/services/paxPause.ts stays the pause PRIMITIVE; nothing else reads
 * `organizations.pax_controls`.
 *
 * FAILS CLOSED. The column is parsed with a zod-STRICT schema. Any value it
 * does not recognise — a stance nobody offers, a switch that is not a
 * boolean, a stray key, a row that is not an object — and any DB error on
 * either read resolves to the STRICTER stance (`ask_before_everything`),
 * all three switches OFF and `checkFailed: true`. Never a permissive value.
 * This is the direct successor of tests/unit/autonomyLevelFailsClosed:
 * `getOrgAutonomyLevel` once CAST the stored column, so an empty string or a
 * typo conveyed MORE permission than the default. tests/unit/
 * paxStanceFailsClosed.test.ts drives hostile values through this real
 * resolver; a cast in place of the parse fails it.
 *
 * A NULL column is not an error: it means "never set" and reads as
 * PAX_CONTROLS_DEFAULTS, which equal today's live behaviour.
 *
 * Consumers: executeTool / executeSupportTool (the kernel), every engine in
 * §4.4 (paxScheduler, leadCampaignJobs / leadNurturer, paxNudges / alerting,
 * workflow-engine, sequenceProcessor, task-runner, financeAgent), the
 * routes-pax-controls surface, paxAskExecutors and the expiry sweep (stance
 * attribution on receipts).
 *
 * The pause holder ({ userId, name }) comes from the primitive itself —
 * getPaxPauseState resolves it from the same rows it reads for the expiry
 * (one read, not three); this module only passes it through.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { logger } from "../utils/logger";
import { getPaxPauseState } from "./paxPause";
import {
  OFFERED_STANCES,
  PAX_CONTROLS_DEFAULTS,
  PAX_RAIL_LEVELS,
  PAX_LIMIT_KEYS,
  PAX_RECORD_DOMAINS,
  STANCE_RULINGS,
  clampSendsLevel,
  defaultPaxLimits,
  defaultPaxRails,
  type PaxControls,
  type PaxLimits,
  type PaxMemberOverride,
  type PaxRails,
  type PaxStance,
} from "@shared/pax-controls";
import { PAX_PAUSE_COPY } from "@shared/pax-glossary";

export interface PaxControlsState extends PaxControls {
  /** True while the org is paused — or while the pause could not be read. */
  paused: boolean;
  /** Latest active pause expiry; null when not paused or unknowable. */
  pausedUntil: Date | null;
  /** The person holding the latest pause; null when not paused or not on file. */
  pausedBy: { userId: string; name: string } | null;
  /**
   * True when EITHER read failed or the stored value was unrecognised. The
   * stance and switches are then the closed values above, and refusals say
   * "could not verify" rather than inventing a state.
   */
  checkFailed: boolean;
  /** The org's IANA zone — what pause times are printed in server-side. */
  timezone: string;
}

/** The stricter of the two offered stances — where every failure lands. */
const FAIL_CLOSED_STANCE: PaxStance = "ask_before_everything";

/** Every rail at its weakest — the closed state widens nothing. */
function closedRails(): PaxRails {
  const records = defaultPaxRails().records;
  for (const d of PAX_RECORD_DOMAINS) records[d] = "watch";
  return { records, sends: "watch" };
}

/** Every cap at 0 — the closed state allows nothing (checkFailed already refuses all). */
function closedLimits(): PaxLimits {
  return { asksPerDay: 0, creditSpendPerDay: 0, browseCallsPerDay: 0, batchRowsPerDay: 0 };
}

const CLOSED: Readonly<PaxControls> = {
  stance: FAIL_CLOSED_STANCE,
  leadScoring: false,
  borrowerReminders: false,
  inboxDrafts: false,
  rails: closedRails(),
  limits: closedLimits(),
  members: {},
};

/** The org's `timezone` column default (shared/schema.ts). */
const FALLBACK_TIMEZONE = "America/New_York";

/**
 * Exactly the stored shape, nothing more. `.strict()` so a key this module
 * does not know about is a parse failure, not a silent passenger — the
 * autonomy matrix's inert fields are the precedent for passengers.
 */
const storedRailLevel = z.enum(PAX_RAIL_LEVELS);

/**
 * PX-2. `rails` is OPTIONAL in the stored row — every org's row written before
 * PX-2 has none and must keep parsing (reads as defaultPaxRails()). Inside it
 * the keys are strict (an unknown domain is a parse failure → fail closed) but
 * each domain is optional so a row written before a domain existed still
 * parses. The stored `sends` level accepts the full level list ON PURPOSE: a
 * hand-edited `act_and_report` there is clamped to `ask` by resolveStoredRails
 * rather than failing the whole row (the PATCH route is what refuses it).
 */
const storedRailsSchema = z
  .object({
    records: z
      .object({
        leads: storedRailLevel.optional(),
        properties: storedRailLevel.optional(),
        deals: storedRailLevel.optional(),
        tasks: storedRailLevel.optional(),
        follow_ups: storedRailLevel.optional(),
        account: storedRailLevel.optional(),
      })
      .strict()
      .optional(),
    sends: storedRailLevel.optional(),
  })
  .strict();

/**
 * PX-3. A stored cap is a whole number ≥ 0 or null (= no cap). A negative, a
 * fractional or a non-number value is a PARSE FAILURE (fail closed), never a
 * silently-coerced cap. Keys are optional so a member's limits may name only
 * the caps they narrow; an unknown key is a parse failure (.strict).
 */
const storedLimitValue = z.number().int().min(0).nullable();
const storedLimitsSchema = z
  .object({
    asksPerDay: storedLimitValue.optional(),
    creditSpendPerDay: storedLimitValue.optional(),
    browseCallsPerDay: storedLimitValue.optional(),
    batchRowsPerDay: storedLimitValue.optional(),
  })
  .strict();

/** One member's override: rails validated exactly like the org's, limits like the org's. */
const storedMemberOverrideSchema = z
  .object({
    rails: storedRailsSchema.optional(),
    limits: storedLimitsSchema.optional(),
  })
  .strict();

/** userId → override. Not an object (an array, a string) or any bad value → parse failure. */
const storedMembersSchema = z.record(z.string().min(1), storedMemberOverrideSchema);

const storedPaxControls = z
  .object({
    stance: z.enum(OFFERED_STANCES),
    leadScoring: z.boolean(),
    borrowerReminders: z.boolean(),
    inboxDrafts: z.boolean(),
    rails: storedRailsSchema.optional(),
    limits: storedLimitsSchema.optional(),
    members: storedMembersSchema.optional(),
  })
  .strict();

/** The stored `limits` (or its absence) → a complete PaxLimits; a missing key is no cap. */
function resolveStoredLimits(stored: z.infer<typeof storedLimitsSchema> | undefined): PaxLimits {
  const limits = defaultPaxLimits();
  for (const k of PAX_LIMIT_KEYS) limits[k] = stored?.[k] ?? null;
  return limits;
}

/**
 * The stored `members` (or its absence) → userId → override, keeping only what
 * was stored (an override is partial by nature). Sends are clamped to the
 * ceiling exactly like resolveStoredRails. Built with fromEntries so a
 * `__proto__` key becomes an own property, never a prototype.
 */
function resolveStoredMembers(
  stored: z.infer<typeof storedMembersSchema> | undefined,
): Readonly<Record<string, PaxMemberOverride>> {
  if (!stored) return {};
  return Object.fromEntries(
    Object.entries(stored).map(([userId, o]): [string, PaxMemberOverride] => {
      const out: PaxMemberOverride = {};
      if (o.rails) {
        const records: NonNullable<NonNullable<PaxMemberOverride["rails"]>["records"]> = {};
        for (const d of PAX_RECORD_DOMAINS) {
          const level = o.rails.records?.[d];
          if (level !== undefined) records[d] = level;
        }
        out.rails = {};
        if (o.rails.records) out.rails.records = records;
        if (o.rails.sends !== undefined) out.rails.sends = clampSendsLevel(o.rails.sends);
      }
      if (o.limits) {
        const limits: Partial<PaxLimits> = {};
        for (const k of PAX_LIMIT_KEYS) {
          const v = o.limits[k];
          if (v !== undefined) limits[k] = v;
        }
        out.limits = limits;
      }
      return [userId, out];
    }),
  );
}

/** The stored `rails` (or its absence) → a complete PaxRails, sends clamped to the ceiling. */
function resolveStoredRails(stored: z.infer<typeof storedRailsSchema> | undefined): PaxRails {
  const rails = defaultPaxRails();
  for (const d of PAX_RECORD_DOMAINS) {
    rails.records[d] = stored?.records?.[d] ?? rails.records[d];
  }
  rails.sends = stored?.sends ? clampSendsLevel(stored.sends) : rails.sends;
  return rails;
}

/** Log-safe rendering of a rejected value: bounded, never thrown. */
function describeStored(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 200) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The org's Pax controls with the pause folded in. One call per decision.
 */
export async function getPaxControls(orgId: number): Promise<PaxControlsState> {
  const pause = await getPaxPauseState(orgId);

  let controls: PaxControls;
  let checkFailed = pause.checkFailed;
  let timezone = FALLBACK_TIMEZONE;

  try {
    const [row] = await db
      .select({ paxControls: organizations.paxControls, timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!row) {
      logger.warn("[paxControls] No organization row — failing CLOSED", { orgId });
      controls = { ...CLOSED };
      checkFailed = true;
    } else {
      if (row.timezone) timezone = row.timezone;
      if (row.paxControls == null) {
        controls = { ...PAX_CONTROLS_DEFAULTS, rails: defaultPaxRails(), limits: defaultPaxLimits(), members: {} };
      } else {
        const parsed = storedPaxControls.safeParse(row.paxControls);
        if (parsed.success) {
          controls = {
            stance: parsed.data.stance,
            leadScoring: parsed.data.leadScoring,
            borrowerReminders: parsed.data.borrowerReminders,
            inboxDrafts: parsed.data.inboxDrafts,
            rails: resolveStoredRails(parsed.data.rails),
            limits: resolveStoredLimits(parsed.data.limits),
            members: resolveStoredMembers(parsed.data.members),
          };
        } else {
          // The one runtime moment a stance nobody offers is met. The line
          // names what IS offered and the ruling that bounds it, so whoever
          // reads the log knows the set is a founder decision, not a typo.
          logger.warn(
            `[paxControls] Unrecognised pax_controls value ${describeStored(row.paxControls)} — failing CLOSED to ${FAIL_CLOSED_STANCE} with every switch off`,
            {
              orgId,
              metadata: {
                issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
                offered: [...OFFERED_STANCES],
                rulings: STANCE_RULINGS,
              },
            },
          );
          controls = { ...CLOSED };
          checkFailed = true;
        }
      }
    }
  } catch (err) {
    logger.error("[paxControls] pax_controls read failed — failing CLOSED", err as Error, { orgId });
    controls = { ...CLOSED };
    checkFailed = true;
  }

  // A pause read that failed is a DB error like any other: the stance and
  // switches close too. paxPause already reports paused:true for it.
  if (pause.checkFailed) controls = { ...CLOSED };

  // The holder rides along from the primitive. A failed pause read carries no
  // holder (and no expiry) — nothing is invented for the refusal line.
  const pausedBy = pause.paused && !pause.checkFailed ? (pause.pausedBy ?? null) : null;

  return {
    ...controls,
    paused: pause.paused || checkFailed,
    pausedUntil: pause.pausedUntil,
    pausedBy,
    checkFailed,
    timezone,
  };
}

/**
 * The customer-visible refusal for a side-effecting action while paused, or
 * while the controls could not be verified (spec §4.6). Glossary copy; a
 * humanised local time; never an ISO string, never an invented expiry.
 *
 * Wave-1 consumers: executeTool / executeSupportTool (A), paxScheduler,
 * financeAgent, sequenceProcessor, workflow-engine (B) — replacing
 * paxPauseRefusalMessage at each gate as it moves to getPaxControls.
 */
export function paxControlsRefusalMessage(state: PaxControlsState): string {
  if (state.checkFailed) return PAX_PAUSE_COPY.checkFailedRefusal;
  return PAX_PAUSE_COPY.refusal({
    until: state.pausedUntil,
    byName: state.pausedBy?.name ?? null,
    timeZone: state.timezone,
  });
}
