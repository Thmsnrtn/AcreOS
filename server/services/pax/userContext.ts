/**
 * SERVER/SERVICES/PAX/USERCONTEXT.TS
 * ----------------------------------------------------------------------------
 * Phase D1 — per-user Pax context capture + injection.
 *
 * Captures the user's vertical / experience / goals / geographic focus /
 * displayed name at onboarding (via PaxContextStep) and exposes
 * `buildUserScopedPromptAppendix(userId)` for Pax to inject into every
 * conversation's system prompt.
 *
 * ── WIRE-IN (deferred — pax/executive.ts is FROZEN this wave) ───────────
 *
 * Pax's conversation runner should call this once per conversation:
 *
 *   import { buildUserScopedPromptAppendix } from "./userContext";
 *   const userAppendix = await buildUserScopedPromptAppendix(userId);
 *   const systemPrompt = `${baseSystemPrompt}\n\n${userAppendix}`;
 *
 * Where `userId` is the Clerk user id from the authenticated request
 * (req.user?.id). When the conversation has no user (system / cron path),
 * pass `null` — we return the land_investing default so Pax stays useful
 * even for anonymous / system surfaces.
 *
 * The onboarding wire-in is similarly deferred: PaxContextStep posts to
 * `POST /api/onboarding/pax-context`, which needs to be added to
 * server/routes.ts (FROZEN this wave) and should call
 * `captureUserContext(...)` from this module.
 *
 * Solene wires both follow-ups after this commit lands.
 *
 * ── PRIVACY POSTURE ─────────────────────────────────────────────────────
 *
 *   - opted_in_personalization defaults TRUE (we ask at onboarding; the
 *     user implicitly opts in by filling the form).
 *   - setPersonalizationOptOut(userId, true) toggles the flag without
 *     deleting the row — re-enabling restores the prior context.
 *   - deleteUserContext(userId) hard-deletes per immutable §8 (7-day
 *     delete).
 *   - When opted-out OR row missing, buildUserScopedPromptAppendix
 *     returns the LAND_INVESTING default — no leakage of partial data.
 *   - Per-user data NEVER appears in another user's conversation: the
 *     appendix is composed FROM and only FROM the calling user's row.
 *
 * ── D1-B INTEGRATION NOTE ───────────────────────────────────────────────
 *
 * The "vertical persona appendix" portion of the output is currently
 * inlined here as `verticalAppendixFor(vertical)`. Once sibling D1-B
 * ships `server/services/pax/verticalSystemPrompt.ts`, this should
 * delegate to `buildVerticalPromptAppendix(vertical)` so the persona
 * voice is owned by one module. The fallback is intentionally minimal
 * so D1-B's richer voice work supersedes it.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { paxUserContext } from "@shared/schema/pax-user-context";
import {
  PAX_VERTICALS,
  PAX_EXPERIENCE_LEVELS,
  PAX_INVESTMENT_GOALS,
  isPaxVertical,
  isPaxExperienceLevel,
  isPaxInvestmentGoal,
  type PaxVertical,
  type PaxExperienceLevel,
  type PaxInvestmentGoal,
} from "@shared/schema/pax-verticals";
import { logger } from "../../utils/logger";

// ── Public types ─────────────────────────────────────────────────────────

export interface UserContext {
  userId: string;
  organizationId: string;
  vertical: PaxVertical | null;
  experienceLevel: PaxExperienceLevel | null;
  investmentGoals: PaxInvestmentGoal[];
  geographicFocus: string | null;
  displayedName: string | null;
  optedInPersonalization: boolean;
}

export interface CaptureContextInput {
  userId: string;
  organizationId: string;
  vertical?: PaxVertical;
  experienceLevel?: PaxExperienceLevel;
  investmentGoals?: PaxInvestmentGoal[];
  geographicFocus?: string;
  displayedName?: string;
}

export interface ContextDistribution {
  totalUsers: number;
  withContext: number;
  optedOut: number;
  byVertical: Record<string, number>;
  byExperience: Record<string, number>;
}

// ── Internal helpers ─────────────────────────────────────────────────────

const DEFAULT_VERTICAL: PaxVertical = "land_investing";

/** Strict validation at the read boundary — DB rows may predate enum changes. */
function normalizeVertical(v: string | null): PaxVertical | null {
  return v && isPaxVertical(v) ? v : null;
}
function normalizeExperience(e: string | null): PaxExperienceLevel | null {
  return e && isPaxExperienceLevel(e) ? e : null;
}
function normalizeGoals(g: unknown): PaxInvestmentGoal[] {
  if (!Array.isArray(g)) return [];
  return g.filter((x): x is PaxInvestmentGoal => isPaxInvestmentGoal(x));
}

function rowToContext(row: typeof paxUserContext.$inferSelect): UserContext {
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    vertical: normalizeVertical(row.vertical),
    experienceLevel: normalizeExperience(row.experienceLevel),
    investmentGoals: normalizeGoals(row.investmentGoals),
    geographicFocus: row.geographicFocus,
    displayedName: row.displayedName,
    optedInPersonalization: row.optedInPersonalization,
  };
}

// ── Capture (UPSERT) ─────────────────────────────────────────────────────

/**
 * Insert or update the user's Pax context. Idempotent on user_id — calling
 * this twice for the same user UPDATES the existing row (preserving
 * captured_at, refreshing updated_at).
 *
 * NEVER throws — logs and returns null on DB failure. Onboarding should
 * still complete even if context persistence transiently fails.
 */
export async function captureUserContext(
  input: CaptureContextInput,
): Promise<UserContext | null> {
  try {
    // Validate at the boundary — silently drop unknown enum values so a
    // stale client can't corrupt the DB.
    const vertical =
      input.vertical && isPaxVertical(input.vertical) ? input.vertical : null;
    const experienceLevel =
      input.experienceLevel && isPaxExperienceLevel(input.experienceLevel)
        ? input.experienceLevel
        : null;
    const investmentGoals = normalizeGoals(input.investmentGoals);
    const geographicFocus =
      typeof input.geographicFocus === "string" && input.geographicFocus.trim().length > 0
        ? input.geographicFocus.trim().slice(0, 200)
        : null;
    const displayedName =
      typeof input.displayedName === "string" && input.displayedName.trim().length > 0
        ? input.displayedName.trim().slice(0, 80)
        : null;

    const now = new Date();
    const [row] = await db
      .insert(paxUserContext)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        vertical,
        experienceLevel,
        investmentGoals,
        geographicFocus,
        displayedName,
        capturedAt: now,
        updatedAt: now,
        optedInPersonalization: true,
      })
      .onConflictDoUpdate({
        target: paxUserContext.userId,
        set: {
          organizationId: input.organizationId,
          vertical,
          experienceLevel,
          investmentGoals,
          geographicFocus,
          displayedName,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) return null;
    return rowToContext(row);
  } catch (err) {
    logger.error("[paxUserContext] captureUserContext failed", {
      userId: input.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Load ─────────────────────────────────────────────────────────────────

/**
 * Read the user's Pax context. Returns null when no row exists.
 *
 * Fire-and-forget side effect: updates last_used_at so the distribution
 * dashboard's "active personalization" sort stays current. We do NOT
 * await this — a DB write failure here must not break Pax responses.
 */
export async function loadUserContext(userId: string): Promise<UserContext | null> {
  try {
    const [row] = await db
      .select()
      .from(paxUserContext)
      .where(eq(paxUserContext.userId, userId))
      .limit(1);

    if (!row) return null;

    // Fire-and-forget — don't await, don't surface DB write errors.
    void db
      .update(paxUserContext)
      .set({ lastUsedAt: new Date() })
      .where(eq(paxUserContext.userId, userId))
      .catch((err) => {
        logger.debug("[paxUserContext] last_used_at update failed (non-fatal)", {
          userId,
          err: err instanceof Error ? err.message : String(err),
        });
      });

    return rowToContext(row);
  } catch (err) {
    logger.error("[paxUserContext] loadUserContext failed", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Prompt composition ───────────────────────────────────────────────────

/**
 * Inlined vertical persona appendix — minimal voice notes per vertical.
 * Once D1-B's verticalSystemPrompt.ts lands, swap this for a delegated
 * call to `buildVerticalPromptAppendix(vertical)`.
 */
function verticalAppendixFor(vertical: PaxVertical): string {
  switch (vertical) {
    case "land_investing":
      return "You are speaking with a land investor. Use the language of acreage, parcels, APNs, county records, owner-financing, and direct-mail acquisition. Default to raw-land specifics — not residential.";
    case "single_family_rentals":
      return "You are speaking with a single-family rental investor. Frame answers around cash flow, occupancy, property management, and BRRRR-style scaling.";
    case "notes":
      return "You are speaking with a note investor (owner-financed paper). Use the language of UPB, NPV, yield, performing/non-performing notes, RMLO, and Reg-Z compliance.";
    case "multi_family":
      return "You are speaking with a multi-family investor. Frame answers around NOI, cap rates, operating expenses, T-12s, and value-add unit economics.";
    case "mobile_homes":
      return "You are speaking with a mobile-home / park investor. Use the language of pad rent, lot fees, infill, and park-level operations.";
    case "wholesaling":
      return "You are speaking with a wholesaler. Frame answers around assignments, contracts, buyer lists, and quick-flip economics.";
    default:
      // Exhaustiveness check — unreachable with current PAX_VERTICALS.
      return "";
  }
}

function experienceAppendixFor(level: PaxExperienceLevel): string {
  switch (level) {
    case "beginner":
      return "They have closed fewer than 3 deals. Explain mechanics, name jargon when introducing it, and lean on concrete examples over abstract advice.";
    case "intermediate":
      return "They have closed 3-20 deals. Skip jargon definitions, focus on optimization and edge cases, and respect that they've seen the basics.";
    case "expert":
      return "They have closed more than 20 deals. Treat them as a peer — go deep, be precise, surface nuance and tradeoffs, never explain fundamentals unprompted.";
  }
}

const GOAL_LABEL: Record<PaxInvestmentGoal, string> = {
  cash_flow: "monthly cash flow",
  appreciation: "long-term appreciation",
  passive_income: "passive / hands-off income",
  value_add: "value-add (improve to increase value)",
  tax_advantages: "tax advantages (depreciation, 1031, etc.)",
  learning: "learning / still exploring",
};

function goalsAppendixFor(goals: PaxInvestmentGoal[]): string {
  if (goals.length === 0) return "";
  const phrased = goals.map((g) => GOAL_LABEL[g]).join(", ");
  return `Their stated investment goals: ${phrased}. Frame recommendations against those goals first.`;
}

/**
 * The default appendix used when:
 *   - userId is null (system / anonymous surface),
 *   - no row exists for the user,
 *   - the user opted out of personalization.
 *
 * Returns the land_investing voice — Pax's primary vertical — so the
 * assistant stays in voice even with zero context.
 */
function defaultAppendix(): string {
  return ["[USER CONTEXT — DEFAULT]", verticalAppendixFor(DEFAULT_VERTICAL)].join("\n");
}

/**
 * Build the per-user Pax system-prompt appendix. Combines:
 *   - vertical persona voice (default: land_investing),
 *   - experience-level tone,
 *   - investment-goals framing,
 *   - greeting line ("You're speaking with {name} in {geo}").
 *
 * When userId is null OR opted_in_personalization is false OR no row
 * exists, returns the land_investing default — Pax stays useful for
 * anonymous / opted-out users without leaking partial context.
 *
 * Exported so pax/executive.ts can call it ONCE per conversation (not
 * per turn) and append to the existing system prompt.
 */
export async function buildUserScopedPromptAppendix(
  userId: string | null,
): Promise<string> {
  if (!userId) return defaultAppendix();

  const ctx = await loadUserContext(userId);
  if (!ctx || !ctx.optedInPersonalization) return defaultAppendix();

  const vertical = ctx.vertical ?? DEFAULT_VERTICAL;
  const parts: string[] = ["[USER CONTEXT]"];

  // 1. Vertical voice
  parts.push(verticalAppendixFor(vertical));

  // 2. Experience tone
  if (ctx.experienceLevel) {
    parts.push(experienceAppendixFor(ctx.experienceLevel));
  }

  // 3. Goals framing
  const goalsLine = goalsAppendixFor(ctx.investmentGoals);
  if (goalsLine) parts.push(goalsLine);

  // 4. Greeting line (name + geo)
  const greetingBits: string[] = [];
  if (ctx.displayedName) greetingBits.push(`You're speaking with ${ctx.displayedName}`);
  if (ctx.geographicFocus) {
    greetingBits.push(
      ctx.displayedName
        ? `who focuses on ${ctx.geographicFocus}`
        : `You're speaking with a user who focuses on ${ctx.geographicFocus}`,
    );
  }
  if (greetingBits.length > 0) {
    parts.push(`${greetingBits.join(" ")}.`);
  }

  return parts.join("\n");
}

// ── Opt-out + delete ─────────────────────────────────────────────────────

/**
 * Opt-out toggle. Sets opted_in_personalization without deleting the row,
 * so re-enabling restores the prior context. Use deleteUserContext for
 * hard-delete (§8).
 */
export async function setPersonalizationOptOut(
  userId: string,
  optOut: boolean,
): Promise<void> {
  try {
    await db
      .update(paxUserContext)
      .set({
        optedInPersonalization: !optOut,
        updatedAt: new Date(),
      })
      .where(eq(paxUserContext.userId, userId));
  } catch (err) {
    logger.error("[paxUserContext] setPersonalizationOptOut failed", {
      userId,
      optOut,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Hard-delete the user's context row. Distinct from the opt-out toggle —
 * this is the §8 (7-day delete) entrypoint, called when the user requests
 * account / data deletion.
 */
export async function deleteUserContext(userId: string): Promise<void> {
  try {
    await db.delete(paxUserContext).where(eq(paxUserContext.userId, userId));
  } catch (err) {
    logger.error("[paxUserContext] deleteUserContext failed", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    // Surface deletion failures — §8 requires that deletion actually
    // happens, so a silent swallow would be a compliance hole.
    throw err;
  }
}

// ── Distribution (founder dashboard) ─────────────────────────────────────

/**
 * Aggregate counts for the /founder/pax-context dashboard (not built
 * this wave). Returns:
 *   - totalUsers     — every row in pax_user_context
 *   - withContext    — rows where vertical OR experienceLevel is set
 *   - optedOut       — rows where opted_in_personalization is false
 *   - byVertical     — count per known vertical (zero entries omitted)
 *   - byExperience   — count per known experience level
 */
export async function getContextDistribution(): Promise<ContextDistribution> {
  const empty: ContextDistribution = {
    totalUsers: 0,
    withContext: 0,
    optedOut: 0,
    byVertical: {},
    byExperience: {},
  };
  try {
    const rows = await db
      .select({
        vertical: paxUserContext.vertical,
        experienceLevel: paxUserContext.experienceLevel,
        optedInPersonalization: paxUserContext.optedInPersonalization,
      })
      .from(paxUserContext);

    const result: ContextDistribution = {
      totalUsers: rows.length,
      withContext: 0,
      optedOut: 0,
      byVertical: {},
      byExperience: {},
    };
    for (const r of rows) {
      if (!r.optedInPersonalization) result.optedOut += 1;
      if (r.vertical || r.experienceLevel) result.withContext += 1;
      if (r.vertical && isPaxVertical(r.vertical)) {
        result.byVertical[r.vertical] = (result.byVertical[r.vertical] ?? 0) + 1;
      }
      if (r.experienceLevel && isPaxExperienceLevel(r.experienceLevel)) {
        result.byExperience[r.experienceLevel] =
          (result.byExperience[r.experienceLevel] ?? 0) + 1;
      }
    }
    return result;
  } catch (err) {
    logger.error("[paxUserContext] getContextDistribution failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}

// Re-export the enum surfaces so callers can `import { PAX_VERTICALS,
// ... } from "./userContext"` without taking a direct dep on the schema
// file — keeps the import graph tight.
export {
  PAX_VERTICALS,
  PAX_EXPERIENCE_LEVELS,
  PAX_INVESTMENT_GOALS,
  type PaxVertical,
  type PaxExperienceLevel,
  type PaxInvestmentGoal,
};

