/**
 * dncScrub — DNC / litigator scrub seam for outbound SMS (TCPA).
 *
 * WHY THIS EXISTS (mature-machine.md §6.1, roadmap-2026-07 Founder decision #1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cold outreach to numbers on the federal/state Do-Not-Call registries — or to
 * known TCPA serial litigators — is live legal exposure. This module is the
 * SEAM so the vendor pick is a config change plus a small adapter, not a build
 * project. VENDOR DECIDED 2026-07-29: **Searchbug** (see
 * docs/company/dnc-vendor-comparison.md and ./searchbugDncProvider.ts).
 *
 * Two distinct "no verdict" states, and they are NOT the same thing:
 *   • NO VENDOR SELECTED (`DNC_SCRUB_PROVIDER` unset/none/off/unknown) — the
 *     seam is INERT: the gate allows everything exactly as before and reports
 *     `scrubbed: false`. Nobody has claimed a scrub is happening.
 *   • VENDOR SELECTED BUT UNUSABLE (named adapter is missing its credentials) —
 *     the seam is NOT inert. It reports `error` (= "not checked"), because an
 *     operator who set DNC_SCRUB_PROVIDER=searchbug believes numbers are being
 *     scrubbed. Silently allowing everything in that state would be a scrub
 *     that lies. A number that could not be checked is not a number that passed.
 *
 * POLICY (once a provider is configured)
 * ──────────────────────────────────────
 *   • `litigator`  → ALWAYS block. Consent is irrelevant — a known serial
 *                    plaintiff is not a lead, they are a lawsuit.
 *   • `dnc_listed` → block UNLESS the lead carries express TCPA consent
 *                    (express consent lawfully overrides registry listing).
 *   • scrub ERROR  → i.e. UNAVAILABLE / NOT CHECKED. FAIL CLOSED for
 *                    lead-matched marketing sends (a
 *                    marketing SMS with an unverifiable scrub is the same
 *                    class of risk as unverifiable consent — see
 *                    tcpaGateForRecipient); fail OPEN for unmatched /
 *                    transactional traffic (billing notices must flow).
 *   • `clean`      → allow.
 *
 * Results cache to `dnc_scrub_results` with a TTL (default 30 days — the
 * federal SAN convention requires re-scrubbing every 31 days). Transient
 * errors are NEVER cached.
 *
 * The gate is wired inside `smsService.tcpaGateForRecipient` — the same
 * gate-by-construction choke point as the consent + quiet-hours checks, so
 * no send path (manual, AI tool, autopilot hand, campaign) can skip it.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { dncScrubResults, type DncScrubResult } from "@shared/schema";
import { logger } from "../../utils/logger";
import { searchbugDncProvider } from "./searchbugDncProvider";

export const DNC_ENGINE_VERSION = "v1";

/** Cache validity window. SAN convention is 31 days; default re-scrub at 30. */
const DEFAULT_TTL_DAYS = 30;

/**
 * `error` is the seam's "UNAVAILABLE / NOT CHECKED" verdict. It is deliberately
 * the only non-verdict an adapter may return: there is no third state between
 * "checked and clean" and "could not check", so an adapter can never leak a
 * failure through as a pass.
 */
export type DncScrubStatus = "clean" | "dnc_listed" | "litigator" | "error";

export interface DncScrubOutcome {
  status: DncScrubStatus;
  provider: string;
  listSource?: string | null;
  reason?: string | null;
  /** True when the outcome came from the `dnc_scrub_results` cache. */
  fromCache?: boolean;
}

export interface DncScrubProvider {
  /** Stable identifier persisted with each result (e.g. "dnc_com"). */
  name: string;
  /** True when the adapter has the credentials/config it needs. */
  isConfigured(): boolean;
  /**
   * Scrub a normalized 10-digit US number. Throw or return status "error"
   * on transient failure — errors are never cached and the gate applies the
   * fail-closed/fail-open posture by traffic class.
   */
  scrub(phoneLast10: string): Promise<Omit<DncScrubOutcome, "provider" | "fromCache">>;
}

// ─── Fixture provider ─────────────────────────────────────────────────────────
// Deterministic in-repo provider for tests/dev (DNC_SCRUB_PROVIDER=fixture).
// Uses reserved fictional-range numbers (555-01XX) so it can never collide
// with a real recipient. Mirrors ofacScreening's bundled-fixture approach.
const FIXTURE_LITIGATOR_LAST10 = new Set(["5555550199", "5555550198"]);
const FIXTURE_DNC_LAST10 = new Set(["5555550100", "5555550101"]);

export const fixtureDncProvider: DncScrubProvider = {
  name: "fixture",
  isConfigured: () => true,
  async scrub(phoneLast10: string) {
    if (FIXTURE_LITIGATOR_LAST10.has(phoneLast10)) {
      return { status: "litigator" as const, listSource: "fixture-litigator", reason: "fixture list" };
    }
    if (FIXTURE_DNC_LAST10.has(phoneLast10)) {
      return { status: "dnc_listed" as const, listSource: "fixture-dnc", reason: "fixture list" };
    }
    return { status: "clean" as const, listSource: "fixture" };
  },
};

// ─── Provider registry ────────────────────────────────────────────────────────
// Vendor adapters register here as they are written. The founder's vendor
// decision (2026-07-29: Searchbug) selects one via DNC_SCRUB_PROVIDER; anything
// unset/unknown means "no vendor selected" and the seam stays inert.
const PROVIDERS: Record<string, DncScrubProvider> = {
  fixture: fixtureDncProvider,
  searchbug: searchbugDncProvider,
};

/** Test seam / future vendor adapters. */
export function registerDncProvider(provider: DncScrubProvider): void {
  PROVIDERS[provider.name] = provider;
}

/**
 * Stand-in for a SELECTED adapter that cannot run (missing credentials).
 *
 * This is the single most important behavior in the seam. The tempting
 * shortcut — "not configured, so return null and stay inert" — turns a
 * deliberately-enabled scrub into a silent allow-all the moment a key is
 * missing or rotated out. Instead the selection stands and every scrub returns
 * `error` (= not checked), so `evaluateDncGate` applies the fail-closed posture
 * for marketing traffic. Errors are never cached, so the real adapter takes
 * over the instant the credential appears.
 */
function unavailableProviderFor(name: string, why: string): DncScrubProvider {
  return {
    name,
    isConfigured: () => true,
    async scrub() {
      return { status: "error" as const, listSource: null, reason: why };
    },
  };
}

const UNCONFIGURED_LOG_INTERVAL_MS = 5 * 60 * 1000;
let lastUnconfiguredLogAt = 0;

export function getConfiguredDncProvider(): DncScrubProvider | null {
  const key = (process.env.DNC_SCRUB_PROVIDER || "").trim().toLowerCase();
  if (!key || key === "none" || key === "off") return null;
  const provider = PROVIDERS[key];
  if (!provider) {
    logger.warn("[dncScrub] DNC_SCRUB_PROVIDER names an unknown adapter — scrub inert", {
      metadata: { provider: key },
    });
    return null;
  }
  if (!provider.isConfigured()) {
    // Selected but unusable — surface it loudly and refuse to fake a pass.
    // Throttled: this is checked on EVERY send, and a flooded log is an
    // ignored log. The refusal itself is never throttled.
    const now = Date.now();
    if (now - lastUnconfiguredLogAt > UNCONFIGURED_LOG_INTERVAL_MS) {
      lastUnconfiguredLogAt = now;
      logger.error(
        "[dncScrub] selected provider is missing its credentials — every scrub returns UNAVAILABLE (marketing sends fail closed)",
        undefined,
        { metadata: { provider: provider.name, __pii_safe: true } },
      );
    }
    return unavailableProviderFor(
      provider.name,
      `provider "${provider.name}" is selected but not configured (missing credentials) — number NOT checked`,
    );
  }
  return provider;
}

/**
 * True when a vendor is SELECTED (the seam is live). Note this is deliberately
 * true for a selected-but-uncredentialed adapter too — the seam is live and
 * returning "not checked", which is very different from inert.
 */
export function isDncScrubConfigured(): boolean {
  return getConfiguredDncProvider() !== null;
}

export function normalizePhoneLast10(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

function ttlDays(): number {
  const parsed = Number.parseInt(process.env.DNC_SCRUB_TTL_DAYS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS;
}

// ─── Scrub with cache ─────────────────────────────────────────────────────────

async function readCachedScrub(
  organizationId: number,
  phoneLast10: string,
  providerName: string,
): Promise<DncScrubResult | null> {
  const [row] = await db
    .select()
    .from(dncScrubResults)
    .where(
      and(
        eq(dncScrubResults.organizationId, organizationId),
        eq(dncScrubResults.phoneLast10, phoneLast10),
        eq(dncScrubResults.provider, providerName),
        gt(dncScrubResults.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(dncScrubResults.scrubbedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Scrub a number for an org via the configured provider, using the cached
 * result inside its TTL. Returns status "error" (never cached) when the
 * provider call fails; returns null when NO provider is configured.
 */
export async function scrubPhone(
  organizationId: number,
  phone: string,
): Promise<DncScrubOutcome | null> {
  const provider = getConfiguredDncProvider();
  if (!provider) return null;

  const phoneLast10 = normalizePhoneLast10(phone);
  if (phoneLast10.length < 7) {
    // Short codes / malformed — nothing to scrub; the carrier will reject.
    return { status: "clean", provider: provider.name, listSource: "unscrubable" };
  }

  try {
    const cached = await readCachedScrub(organizationId, phoneLast10, provider.name);
    if (cached) {
      return {
        status: cached.status as DncScrubStatus,
        provider: cached.provider,
        listSource: cached.listSource,
        reason: cached.reason,
        fromCache: true,
      };
    }
  } catch (err) {
    // Cache read failure is not a scrub failure — fall through to a live scrub.
    logger.warn("[dncScrub] cache read failed — running live scrub", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
  }

  let outcome: Omit<DncScrubOutcome, "provider" | "fromCache">;
  try {
    outcome = await provider.scrub(phoneLast10);
  } catch (err) {
    logger.error(
      "[dncScrub] provider scrub failed",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId, provider: provider.name } },
    );
    return { status: "error", provider: provider.name };
  }
  if (outcome.status === "error") {
    return { ...outcome, provider: provider.name };
  }

  // Persist (best-effort — a cache-write failure must not block the send path).
  try {
    const expiresAt = new Date(Date.now() + ttlDays() * 24 * 60 * 60 * 1000);
    await db.insert(dncScrubResults).values({
      organizationId,
      phoneLast10,
      status: outcome.status,
      provider: provider.name,
      listSource: outcome.listSource ?? null,
      reason: outcome.reason ?? null,
      expiresAt,
    });
  } catch (err) {
    logger.warn("[dncScrub] cache write failed", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
  }

  return { ...outcome, provider: provider.name };
}

// ─── Gate policy ──────────────────────────────────────────────────────────────

export interface DncGateInput {
  /** True when the recipient matched a lead in the org (marketing class). */
  leadMatched: boolean;
  /** True when the matched lead carries express TCPA consent. */
  hasConsent: boolean;
}

export interface DncGateResult {
  allowed: boolean;
  /** False when no provider is configured (seam inert). */
  scrubbed: boolean;
  reason?: string;
}

/**
 * Pure policy over a scrub outcome — unit-testable without DB or provider.
 * `outcome === null` means no provider configured (inert seam → allow).
 */
export function evaluateDncGate(
  outcome: DncScrubOutcome | null,
  input: DncGateInput,
): DncGateResult {
  if (outcome === null) {
    return { allowed: true, scrubbed: false };
  }
  switch (outcome.status) {
    case "litigator":
      return {
        allowed: false,
        scrubbed: true,
        reason: `recipient is on a known-litigator list (${outcome.listSource ?? outcome.provider})`,
      };
    case "dnc_listed":
      if (input.hasConsent) {
        // Express consent lawfully overrides registry listing.
        return { allowed: true, scrubbed: true };
      }
      return {
        allowed: false,
        scrubbed: true,
        reason: `recipient is DNC-listed with no express consent (${outcome.listSource ?? outcome.provider})`,
      };
    case "error":
      if (input.leadMatched) {
        // Marketing send with an unverifiable scrub — fail closed, same
        // posture as unverifiable consent in tcpaGateForRecipient.
        return {
          allowed: false,
          scrubbed: true,
          reason: "DNC scrub unverifiable — refusing marketing send (fail closed)",
        };
      }
      // Transactional traffic must flow — fail open, loudly.
      return { allowed: true, scrubbed: true };
    case "clean":
    default:
      return { allowed: true, scrubbed: true };
  }
}

/**
 * Full gate: scrub (cached) + policy. Call from the send choke point.
 * Never throws.
 */
export async function dncGateForSms(
  organizationId: number,
  phone: string,
  input: DncGateInput,
): Promise<DncGateResult> {
  let outcome: DncScrubOutcome | null;
  try {
    outcome = await scrubPhone(organizationId, phone);
  } catch (err) {
    // scrubPhone shouldn't throw, but the gate must never crash a send path.
    logger.error(
      "[dncScrub] gate failed unexpectedly",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId } },
    );
    outcome = { status: "error", provider: "unknown" };
  }
  const result = evaluateDncGate(outcome, input);
  if (!result.allowed) {
    logger.warn("[dncScrub] send blocked by DNC gate", {
      metadata: { organizationId, reason: result.reason },
    });
  }
  return result;
}
