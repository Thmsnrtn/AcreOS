/**
 * Founder Autopilot — Trust Ledger control plane (founder HTTP surface).
 *
 *   GET  /api/founder/autopilot/trust-ledger            — every domain's standing
 *   POST /api/founder/autopilot/domains/:domain/level   — sovereign override:
 *                                                          pause (→ observe) or
 *                                                          grant trust, with a reason
 *
 * Auth: isAuthenticated + requireFounder (404 for non-founder per the existing
 * founder-routes pattern). This is the reversibility/control guarantee — the
 * founder can always pause or re-trust any domain directly from the UI.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId, getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  getTrustLedger,
  setDomainLevel,
  AUTOPILOT_DOMAINS,
  DOMAIN_AUTONOMY_LEVELS,
  type DomainAutonomyLevel,
} from "./services/autopilot/domainAutonomy";
import type { AutopilotDomain } from "./services/autopilot/policyGate";
import {
  createStandingOrder,
  listStandingOrders,
  deactivateStandingOrder,
  STANDING_ORDER_KINDS,
  type StandingOrderKind,
} from "./services/autopilot/standingOrders";

export function registerAutopilotRoutes(app: Express): void {
  // ── GET the Trust Ledger ────────────────────────────────────────────────
  app.get(
    "/api/founder/autopilot/trust-ledger",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const ledger = await getTrustLedger();
        // Attach per-domain decision QUALITY (wire-for-real: decisionEval) so the
        // founder sees not just "9/10 clean cycles" but whether those decisions
        // were actually GOOD — the real basis on which autonomy is earned/held.
        const { getDomainDecisionQuality, decisionEvalLine } = await import(
          "./services/autopilot/decisionEval"
        );
        // Horizon A2 — the shadow-agreement standing (honest: computed only
        // from resolved pairs; below the minimum it says it's accumulating).
        const { getShadowAgreementLine } = await import(
          "./services/autopilot/shadowAgreement"
        );
        const enriched = await Promise.all(
          ledger.map(async (entry) => {
            let quality: Awaited<ReturnType<typeof getDomainDecisionQuality>> | null = null;
            let qualityLine: string | null = null;
            try {
              quality = await getDomainDecisionQuality(entry.domain);
              qualityLine = decisionEvalLine(quality);
            } catch {
              quality = null;
              qualityLine = null;
            }
            return { ...entry, quality, qualityLine, shadowLine: await getShadowAgreementLine(entry.domain) };
          }),
        );
        return res.json({ ledger: enriched });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST the atomic PANIC STOP (T0.3) — halt everything in one tap ───────
  // The most consequential founder control: flips all master switches off +
  // quarantines every domain to OBSERVE + records a receipt + pages. Reversible
  // by re-enabling the switches once the founder has reviewed. (The env
  // SOLENE_PANIC_STOP is the separate out-of-reach hard floor.)
  app.post(
    "/api/founder/autopilot/panic-stop",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const reason = ((req.body ?? {}) as { reason?: string }).reason?.trim() || "founder-initiated panic stop";
        const { panicStop } = await import("./services/autopilot/panicStop");
        const result = await panicStop({ reason, by: getUserId(req) });
        // logger.error's 2nd arg is the Error — passing {reason} there logged
        // "[object Object]" and lost the reason (WS5 drill, 2026-07-08).
        logger.error("[autopilot] founder tripped PANIC STOP via API", undefined, { metadata: { reason } });
        return res.json({ ok: true, ...result });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Guided resume — the staged, honest way BACK from the panic stop ──────
  // Preflight: a plain-words checklist (env-override honesty, what tripped the
  // stop where discoverable, the reused readiness checks) before anything
  // turns on.
  app.get(
    "/api/founder/autopilot/resume/preflight",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { resumePreflight } = await import("./services/autopilot/guidedResume");
        return res.json(await resumePreflight());
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Stage: 1 cognition → 2 observe (verify-only) → 3 dispatch. Domain autonomy
  // levels are NEVER restored automatically — the founder re-grants from the
  // trust ledger (the autopilot restarts cautious).
  app.post(
    "/api/founder/autopilot/resume/stage",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { isResumeStage, resumeStage, RESUME_STAGES } = await import(
          "./services/autopilot/guidedResume"
        );
        const stage = ((req.body ?? {}) as { stage?: unknown }).stage;
        if (!isResumeStage(stage)) {
          return Errors.badRequest(res, "Invalid stage", { allowed: RESUME_STAGES });
        }
        const result = await resumeStage(stage, getUserId(req));
        logger.info("[autopilot] founder ran guided-resume stage", { stage, done: result.done });
        return res.json(result);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET the governance evidence packet (exportable, hash-sealed) ─────────
  // Foundry move #5: AcreOS's own founder-trust artifact AND the sellable
  // "proof the autonomy was governed". Composes existing durable records
  // (audit-chain verification + witnessed-send audit + Trust Ledger +
  // constitution hash) into one sealed packet a reviewer can independently
  // verify with verifyEvidencePacket().
  app.get(
    "/api/founder/autopilot/governance/evidence",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const raw = Number((req.query.days as string) ?? "30");
        const periodDays = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
        const { gatherGovernanceEvidence } = await import("./services/governance/evidencePacket");
        const packet = await gatherGovernanceEvidence(orgId, periodDays);
        return res.json({ packet });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST set a domain's autonomy level (founder sovereign override) ──────
  app.post(
    "/api/founder/autopilot/domains/:domain/level",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const domain = req.params.domain as AutopilotDomain;
      const { level, reason } = (req.body ?? {}) as { level?: string; reason?: string };

      if (!AUTOPILOT_DOMAINS.includes(domain)) {
        return Errors.badRequest(res, `Unknown domain "${domain}"`, {
          allowed: AUTOPILOT_DOMAINS,
        });
      }
      if (!level || !DOMAIN_AUTONOMY_LEVELS.includes(level as DomainAutonomyLevel)) {
        return Errors.badRequest(res, `Invalid level`, { allowed: DOMAIN_AUTONOMY_LEVELS });
      }
      const trimmedReason = (reason ?? "").trim() || "founder override (no reason given)";

      try {
        const result = await setDomainLevel(domain, level as DomainAutonomyLevel, trimmedReason);
        logger.info("[autopilot] founder set domain level via API", { domain, level });
        return res.json({ ok: true, ...result });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Control Center — aggregated status + the master switches ─────────────
  app.get(
    "/api/founder/autopilot/control",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { getEffectiveSettings } = await import("./services/autopilot/settings");
        const [settings, rawLedger] = await Promise.all([getEffectiveSettings(), getTrustLedger()]);
        // Horizon A2 — the Control Center renders each domain's shadow-
        // agreement standing next to its trust dial (small, honest, no new
        // page). Best-effort: a failed read renders nothing, never a guess.
        const ledger = await Promise.all(
          rawLedger.map(async (entry) => {
            try {
              const { getShadowAgreementLine } = await import("./services/autopilot/shadowAgreement");
              return { ...entry, shadowLine: await getShadowAgreementLine(entry.domain) };
            } catch {
              return { ...entry, shadowLine: null };
            }
          }),
        );
        let openAsks = 0;
        try {
          const { listOpenAsks } = await import("./services/solene/founderCollab");
          openAsks = (await listOpenAsks()).length;
        } catch {
          openAsks = 0;
        }
        let calibration: { grade: string; n: number } | null = null;
        try {
          const { getCalibrationPairs } = await import("./services/autopilot/experienceLog");
          const { calibrationReport } = await import("./services/autopilot/forecast");
          const r = calibrationReport(await getCalibrationPairs());
          calibration = { grade: r.grade, n: r.n };
        } catch {
          calibration = null;
        }
        let conversions = { totalSignups: 0, byPlay: [] as Array<{ playId: string; signups: number }> };
        try {
          const { getConversionSummary } = await import("./services/autopilot/attribution");
          conversions = await getConversionSummary();
        } catch {
          conversions = { totalSignups: 0, byPlay: [] };
        }
        // Growth budget: the base env/charter cap, any founder-approved ramp
        // override, the effective cap the loop spends against, and the hard
        // ceiling. Lets the founder see — and reset — the compounding budget.
        let budget: {
          baseCapUsd: number;
          overrideUsd: number | null;
          effectiveCapUsd: number;
          ceilingUsd: number;
        } | null = null;
        try {
          const { getEnsembleMonthlyCapUsd, getEffectiveMonthlyCapUsd, getEnsembleMonthlyCapHardCeilingUsd } =
            await import("./services/solene/capitalTracker");
          budget = {
            baseCapUsd: getEnsembleMonthlyCapUsd(),
            overrideUsd: settings.growthBudgetOverrideUsd,
            effectiveCapUsd: await getEffectiveMonthlyCapUsd(),
            ceilingUsd: getEnsembleMonthlyCapHardCeilingUsd(),
          };
        } catch {
          budget = null;
        }
        return res.json({ settings, ledger, openAsks, calibration, conversions, budget });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/autopilot/settings",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const { key, value } = (req.body ?? {}) as { key?: string; value?: boolean };
      if (key !== "dispatchEnabled" && key !== "publishEnabled" && key !== "cognitionEnabled" && key !== "selfPatchEnabled") {
        return Errors.badRequest(res, "Invalid setting key", { allowed: ["dispatchEnabled", "publishEnabled", "cognitionEnabled", "selfPatchEnabled"] });
      }
      if (typeof value !== "boolean") {
        return Errors.badRequest(res, "value must be a boolean");
      }
      try {
        const { setAutopilotSetting } = await import("./services/autopilot/settings");
        const settings = await setAutopilotSetting(key, value, getUserId(req));
        return res.json({ ok: true, settings });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Reset the growth-budget ramp — roll the cap back to the env/charter base ──
  // The founder-facing reversibility for an approved budget ramp: clears the
  // DB-backed override so the base cap governs again. The next ramp must be
  // re-earned and re-approved.
  app.post(
    "/api/founder/autopilot/budget/reset",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { setGrowthBudgetOverrideUsd } = await import("./services/autopilot/settings");
        const settings = await setGrowthBudgetOverrideUsd(null, getUserId(req));
        return res.json({ ok: true, settings });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Seed the growth-target queue with buy-box counties (ignition) ────────
  // The one-time founder seed: a free-form county list ("TX/Travis", one per
  // line, etc.) → parsed → the queue the daily owned-content loop drains. The
  // autopilot then writes one county-targeted guide/day (publish-gated). Returns
  // what parsed + how many were newly added (idempotent — re-seeding is safe).
  app.post(
    "/api/founder/autopilot/growth/seed-counties",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const { counties } = (req.body ?? {}) as { counties?: string };
      if (!counties || counties.trim().length === 0) {
        return Errors.badRequest(res, "counties must be a non-empty string (e.g. 'TX/Travis' one per line)");
      }
      try {
        const { parseCountyList, seedGrowthTargets, countPendingTargets } = await import(
          "./services/autopilot/growthTargets"
        );
        const parsed = parseCountyList(counties);
        if (parsed.length === 0) {
          return Errors.badRequest(res, "no counties parsed — use 'ST/County' (e.g. TX/Travis), one per line");
        }
        const inserted = await seedGrowthTargets(parsed);
        const pending = await countPendingTargets();
        return res.json({
          ok: true,
          parsed: parsed.map((c) => `${c.state}/${c.countySlug}`),
          parsedCount: parsed.length,
          newlyAdded: inserted,
          pending,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Ignition kit — the agent-prepared, founder-fired one-time seed ───────
  // Returns the launch-post draft (TRUE facts, founder-editable) + the curated
  // tool-directory submission list, so the founder's one-time ignition is
  // review-and-post, not authoring. Read-only; deterministic.
  app.get(
    "/api/founder/autopilot/ignition/drafts",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { buildIgnitionDrafts } = await import("./services/autopilot/ignitionKit");
        const { publicBaseUrl } = await import("./services/autopilot/searchEngineSubmit");
        const base = publicBaseUrl() ?? "https://acreos.com";
        let exampleCounty: { countyLabel: string; state: string } | null = null;
        try {
          const { selectNextGrowthTarget } = await import("./services/autopilot/growthTargets");
          const t = await selectNextGrowthTarget();
          if (t) exampleCounty = { countyLabel: t.countyLabel, state: t.state };
        } catch {
          /* no seeded county yet — the draft uses a generic example */
        }
        return res.json(buildIgnitionDrafts({ baseUrl: base, exampleCounty }));
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── The Context Pack — the eagle-eye briefing the brain reasons over ─────
  // Phase 1 (cognition): the rich, honest whole-business view assembled from real
  // senses. The Operator reasons over this; the founder can read it directly.
  app.get(
    "/api/founder/autopilot/context",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { gatherContextPack } = await import("./services/autopilot/cognitionContext");
        return res.json(await gatherContextPack());
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── The Operator — founder-invoked "advise me" pass over the whole business ──
  // Phase 1 keystone (safe interim): one Opus-grade pass over the live Context
  // Pack → a governed Operating Plan that may PROPOSE net-new moves the catalog
  // lacks. Founder-invoked = zero autonomous risk; the autonomous daily cadence
  // (proposing into the witnessed queue) is the gated follow-on.
  app.post(
    "/api/founder/autopilot/operate",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { gatherContextPack } = await import("./services/autopilot/cognitionContext");
        const { operate, buildOperatorModelCall, OPERATOR_KNOWN_KINDS } = await import(
          "./services/autopilot/operator"
        );
        const pack = await gatherContextPack();
        const callModel = await buildOperatorModelCall();
        if (!callModel) {
          return res.json({ plan: null, briefing: pack.briefing, reason: "no cognition model configured (set AI_INTEGRATIONS_OPENAI_API_KEY / COGNITION_MODEL)" });
        }
        const plan = await operate(pack.briefing, OPERATOR_KNOWN_KINDS, { callModel });
        return res.json({ plan, briefing: pack.briefing, contextPack: pack });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Conversational steering — talk to the company in plain language ──────
  app.post(
    "/api/founder/autopilot/steer",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const { text } = (req.body ?? {}) as { text?: string };
      if (!text || text.trim().length === 0) {
        return Errors.badRequest(res, "text must be non-empty");
      }
      try {
        const { parseSteerCommand, handleSteer } = await import("./services/autopilot/steer");
        const { setDomainLevel: setLvl, getDomainLevel, nextLevel, AUTOPILOT_DOMAINS } = await import(
          "./services/autopilot/domainAutonomy"
        );
        const { createStandingOrder } = await import("./services/autopilot/standingOrders");
        const intent = parseSteerCommand(text);
        const result = await handleSteer(
          intent,
          {
            setDomainLevel: (d, l, reason) => setLvl(d, l as never, reason),
            getDomainLevel: (d) => getDomainLevel(d),
            nextLevel: (l) => nextLevel(l as never),
            createStandingOrder: (i) => createStandingOrder(i),
            status: async (domain) => {
              const { composeFounderBrief } = await import("./services/autopilot/narrate");
              const brief = await composeFounderBrief();
              if (domain) {
                const { getPlayStats } = await import("./services/autopilot/experienceLog");
                const stats = await getPlayStats(domain);
                const top = [...stats].sort((a, b) => b.successes - a.successes)[0];
                const tr = top ? ` Best ${domain} play so far: ${top.playId} (${top.successes}/${top.successes + top.failures} good).` : "";
                return `${brief.neededLine}${tr}`;
              }
              return `${brief.neededLine}${brief.focusLine ? " " + brief.focusLine : ""}`;
            },
            why: async () => {
              const { getRecentStory } = await import("./services/autopilot/experienceLog");
              const [latest] = await getRecentStory(1);
              const trace = latest?.reasoningTrace as { narrative?: string } | null;
              return trace?.narrative ?? "Nothing's run yet — once the autopilot acts, I'll be able to explain each move.";
            },
            listDomains: () => AUTOPILOT_DOMAINS,
            spend: async () => {
              // Real ledger only — never an estimate. If either read fails we
              // say so instead of guessing.
              const { getMonthlyEnvelopeStatus, getSpendSummary } = await import(
                "./services/solene/capitalTracker"
              );
              try {
                const [week, env] = await Promise.all([
                  getSpendSummary(7 * 24),
                  getMonthlyEnvelopeStatus(),
                ]);
                return (
                  `Last 7 days: $${week.totalUsd.toFixed(2)} across ${week.eventCount} events. ` +
                  `Month-to-date: $${env.monthToDateUsd.toFixed(2)} of the $${env.envelopeUsd.toFixed(0)} envelope ` +
                  `(${Math.round(env.percentUsed)}% used, status ${env.status}; projected $${env.projectedMonthlyUsd.toFixed(2)} for the month).`
                );
              } catch {
                return "I can't read the spend ledger right now — no number rather than a guess.";
              }
            },
          },
          getUserId(req),
        );
        return res.json(result);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── The glass-box Story — recent actions with their full reasoning trace ──
  app.get(
    "/api/founder/autopilot/story",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { getRecentStory } = await import("./services/autopilot/experienceLog");
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
        const entries = await getRecentStory(limit);
        return res.json({ entries });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Live heartbeat — "what's it doing now / is it healthy" ──────────────
  // One read that makes the just-wired autonomous behavior WATCHABLE: the last
  // tick's pulse (refreshed every ~30m by the worker), the effective support
  // auto-resolve cut + its provenance (so a learned/cold-start divergence is
  // visible, not silent), and the pending witnessed-send count.
  app.get(
    "/api/founder/autopilot/live",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { getLatestMorningPulse } = await import("./services/solene/continuousLoop");
        const pulse = await getLatestMorningPulse();

        // F1 pulse strip (experience-legibility.md): the brain's actual
        // heartbeat is the solene_continuous_tick job (30-min cadence in
        // jobRegistry) — read its latest successful run from job_runs.
        // Honest null when it has never run (fresh env, jobs disabled);
        // stale after 2 missed cadences, wired to the same reality the
        // deadman watches.
        const LOOP_JOB = "solene_continuous_tick";
        const LOOP_CADENCE_MS = 30 * 60 * 1000;
        let loop: {
          lastCycleAt: string | null;
          cadenceMs: number;
          nextDueAt: string | null;
          stale: boolean;
        } = { lastCycleAt: null, cadenceMs: LOOP_CADENCE_MS, nextDueAt: null, stale: false };
        try {
          const { db } = await import("./storage");
          const { jobRuns } = await import("@shared/schema");
          const { and, desc, eq, isNotNull } = await import("drizzle-orm");
          const [run] = await db
            .select({ completedAt: jobRuns.completedAt })
            .from(jobRuns)
            .where(and(eq(jobRuns.jobName, LOOP_JOB), eq(jobRuns.status, "success"), isNotNull(jobRuns.completedAt)))
            .orderBy(desc(jobRuns.completedAt))
            .limit(1);
          if (run?.completedAt) {
            const last = new Date(run.completedAt);
            loop = {
              lastCycleAt: last.toISOString(),
              cadenceMs: LOOP_CADENCE_MS,
              nextDueAt: new Date(last.getTime() + LOOP_CADENCE_MS).toISOString(),
              stale: Date.now() - last.getTime() > 2 * LOOP_CADENCE_MS,
            };
          }
        } catch {
          /* keep honest nulls */
        }

        let supportThresholdLine: string | null = null;
        let supportThresholdPct: number | null = null;
        try {
          const { currentSupportAutoResolveThreshold } = await import(
            "./services/autopilot/learnedGates"
          );
          const { learnedThresholdLine } = await import("./services/autopilot/learnedPolicy");
          const lt = await currentSupportAutoResolveThreshold();
          supportThresholdLine = learnedThresholdLine("Support auto-resolve", lt);
          supportThresholdPct = Math.round(lt.threshold * 100);
        } catch {
          /* omit */
        }

        let pendingCount = 0;
        try {
          const { listPendingHands } = await import("./services/autopilot/pendingHands");
          pendingCount = (await listPendingHands()).length;
        } catch {
          /* 0 */
        }

        return res.json({
          loop,
          lastTickAt: pulse?.generatedAt ?? null,
          oneLine: pulse?.oneLine ?? null,
          mrr: pulse?.mrr ?? null,
          trials: pulse?.trials ?? null,
          uptimePct: pulse?.uptimePct ?? null,
          envelopeStatus: pulse?.envelopeStatus ?? null,
          decisionsWaitingCount: pulse?.decisionsWaitingCount ?? 0,
          asksOpenCount: pulse?.asksOpenCount ?? 0,
          autonomyHorizonDays: pulse?.autonomyHorizonDays ?? null,
          dispatchesCompletedLast24h: pulse?.dispatchesCompletedLast24h ?? 0,
          dispatchesFlaggedLast24h: pulse?.dispatchesFlaggedLast24h ?? 0,
          supportThresholdLine,
          supportThresholdPct,
          pendingCount,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Wedge receipts — F3 of the experience-legibility cluster ────────────
  // "No number without a tappable source": the Letter's Outreach/Replies/
  // Offers tiles open the actual rows these counts are made of. Same tables
  // and 7-day cutoff as the narrate.ts gatherer, formatted server-side into
  // plain receipt lines so the client stays dumb and the wording stays in
  // one place.
  app.get(
    "/api/founder/autopilot/receipts/wedge",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const metric = String(req.query.metric ?? "");
      if (!["outreach", "replies", "offers"].includes(metric)) {
        return Errors.badRequest(res, `Unknown metric "${metric}"`, {
          allowed: ["outreach", "replies", "offers"],
        });
      }
      try {
        const { db } = await import("./db");
        const { campaignDeliveryEvents, messages, offers, leads } = await import("@shared/schema");
        const { and, desc, eq, gte } = await import("drizzle-orm");
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const LIMIT = 50;
        let rows: Array<{ at: string | null; line: string }> = [];
        if (metric === "outreach") {
          const out = await db
            .select({
              at: campaignDeliveryEvents.sentAt,
              channel: campaignDeliveryEvents.channel,
              status: campaignDeliveryEvents.status,
              first: leads.firstName,
              last: leads.lastName,
            })
            .from(campaignDeliveryEvents)
            .leftJoin(leads, eq(campaignDeliveryEvents.leadId, leads.id))
            .where(gte(campaignDeliveryEvents.sentAt, cutoff))
            .orderBy(desc(campaignDeliveryEvents.sentAt))
            .limit(LIMIT);
          rows = out.map((r) => ({
            at: r.at ? new Date(r.at).toISOString() : null,
            line: `${r.channel === "direct_mail" ? "Letter" : r.channel === "sms" ? "Text" : "Email"} to ${[r.first, r.last].filter(Boolean).join(" ") || "a lead"} — ${r.status}`,
          }));
        } else if (metric === "replies") {
          const out = await db
            .select({ at: messages.createdAt, content: messages.content })
            .from(messages)
            .where(and(eq(messages.direction, "inbound"), gte(messages.createdAt, cutoff)))
            .orderBy(desc(messages.createdAt))
            .limit(LIMIT);
          rows = out.map((r) => ({
            at: r.at ? new Date(r.at).toISOString() : null,
            line: `Reply: “${(r.content ?? "").slice(0, 80)}${(r.content ?? "").length > 80 ? "…" : ""}”`,
          }));
        } else {
          const out = await db
            .select({
              at: offers.createdAt,
              status: offers.status,
              cash: offers.cashOffer,
              first: leads.firstName,
              last: leads.lastName,
            })
            .from(offers)
            .leftJoin(leads, eq(offers.leadId, leads.id))
            .where(gte(offers.createdAt, cutoff))
            .orderBy(desc(offers.createdAt))
            .limit(LIMIT);
          rows = out.map((r) => ({
            at: r.at ? new Date(r.at).toISOString() : null,
            line: `Offer${r.cash ? ` $${Number(r.cash).toLocaleString("en-US")}` : ""} to ${[r.first, r.last].filter(Boolean).join(" ") || "a lead"} — ${r.status}`,
          }));
        }
        return res.json({ metric, windowDays: 7, rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Up next — armed intent (trust audit, 2026-07-28) ────────────────────
  // What the autopilot will do NEXT: the QUEUED (not yet executed) dispatch
  // rows, formatted server-side into plain lines so the Letter's client stays
  // dumb and the wording lives in one place (same doctrine as the wedge
  // receipts). Capped at 10 items + an honest total count.
  app.get(
    "/api/founder/autopilot/up-next",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { db } = await import("./db");
        const { soleneDispatchQueue } = await import("@shared/schema/solene-dispatch");
        const { asc, desc, eq, sql } = await import("drizzle-orm");
        const [count] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(soleneDispatchQueue)
          .where(eq(soleneDispatchQueue.status, "queued"));
        const rows = await db
          .select({
            id: soleneDispatchQueue.id,
            sourceType: soleneDispatchQueue.sourceType,
            promptText: soleneDispatchQueue.promptText,
            notBeforeAt: soleneDispatchQueue.notBeforeAt,
            queuedAt: soleneDispatchQueue.queuedAt,
          })
          .from(soleneDispatchQueue)
          .where(eq(soleneDispatchQueue.status, "queued"))
          // Same order the worker claims in (priority DESC, queued_at ASC) —
          // the list the founder sees is the list that will actually run.
          .orderBy(desc(soleneDispatchQueue.priority), asc(soleneDispatchQueue.queuedAt))
          .limit(10);
        return res.json({
          total: count?.n ?? 0,
          items: rows.map((r) => ({ id: r.id, line: upNextLine(r) })),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Hold ONE queued item (single tap — holding is tightening) ───────────
  // Routes through the existing queued-state cancel path
  // (dispatchQueue.cancelQueuedDispatch): only legal from status='queued';
  // in-flight or terminal rows are refused with an honest reason. There is
  // deliberately NO un-hold here — a held item stays held.
  app.post(
    "/api/founder/autopilot/up-next/:id/hold",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "Invalid id");
      try {
        const { cancelQueuedDispatch } = await import("./services/solene/dispatchQueue");
        const result = await cancelQueuedDispatch(id, "held by founder from The Letter (up-next)");
        if (result.ok) {
          logger.info("[autopilot] founder held a queued dispatch from The Letter", { dispatchId: id });
          return res.json({ ok: true });
        }
        if (result.priorStatus === null) return Errors.notFound(res, "Queued item");
        return Errors.badRequest(
          res,
          result.priorStatus === "in_progress"
            ? "This item already started running — it can no longer be held from here."
            : `This item already finished (${result.priorStatus}) — there's nothing to hold.`,
        );
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── The board report (wire-for-real: boardReport + okr) ─────────────────
  // The CEO-to-board summary: what the company did, how it's tracking
  // (OKR + decision quality), and the handful of things that need the founder.
  app.get(
    "/api/founder/autopilot/board-report",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { buildBoardReport } = await import("./services/autopilot/boardReport");
        const report = await buildBoardReport();
        return res.json(report);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Standing orders + intents ("Your Voice") ────────────────────────────
  app.get(
    "/api/founder/autopilot/standing-orders",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const kind = req.query.kind as StandingOrderKind | undefined;
        const activeOnly = req.query.activeOnly === "true";
        const orders = await listStandingOrders({
          kind: kind && STANDING_ORDER_KINDS.includes(kind) ? kind : undefined,
          activeOnly,
        });
        return res.json({ orders });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/autopilot/standing-orders",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const { kind, body } = (req.body ?? {}) as { kind?: string; body?: string };
      if (!kind || !STANDING_ORDER_KINDS.includes(kind as StandingOrderKind)) {
        return Errors.badRequest(res, "Invalid kind", { allowed: STANDING_ORDER_KINDS });
      }
      if (!body || body.trim().length === 0) {
        return Errors.badRequest(res, "body must be non-empty");
      }
      try {
        const created = await createStandingOrder({
          kind: kind as StandingOrderKind,
          body,
          createdBy: getUserId(req),
        });
        return res.json({ order: created });
      } catch (err) {
        if (err instanceof Error && /exceeds|non-empty|unknown kind/.test(err.message)) {
          return Errors.badRequest(res, err.message);
        }
        return Errors.internal(res, err);
      }
    },
  );

  app.delete(
    "/api/founder/autopilot/standing-orders/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return Errors.badRequest(res, "Invalid id");
      }
      try {
        const { ok } = await deactivateStandingOrder(id);
        if (!ok) return Errors.notFound(res, "Standing order");
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Execution seam (Elite Vision H1) — the founder's witnessed-send queue ──
  // GET the frozen autopilot actions awaiting approval; approve/reject each.
  app.get(
    "/api/founder/autopilot/pending-actions",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { listPendingHands } = await import("./services/autopilot/pendingHands");
        const actions = await listPendingHands();
        return res.json({ actions });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/autopilot/pending-actions/:id/approve",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "Invalid id");
      try {
        const { approvePendingHand } = await import("./services/autopilot/pendingHands");
        const outcome = await approvePendingHand({ id, approvedBy: getUserId(req) });
        switch (outcome.outcome) {
          case "not_found":
            return Errors.notFound(res, "Pending action");
          case "expired":
            return Errors.badRequest(res, "This action expired — have the autopilot draft it again.");
          case "rejected":
            return Errors.badRequest(res, "This action was rejected and can no longer execute.");
          case "hash_mismatch":
            return Errors.badRequest(res, "Integrity check failed — refusing to execute.");
          case "in_flight":
            return res.json({ ok: true, executed: false, inFlight: true });
          case "execution_failed":
            return Errors.badRequest(res, `Execution failed: ${outcome.error}`);
          case "already_executed":
            return res.json({ ok: true, executed: true, alreadyExecuted: true, result: outcome.result });
          case "executed":
            return res.json({ ok: true, executed: true, result: outcome.result });
          default:
            return Errors.internal(res, new Error("unexpected approval outcome"));
        }
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/autopilot/pending-actions/:id/reject",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "Invalid id");
      try {
        const { rejectPendingHand } = await import("./services/autopilot/pendingHands");
        const outcome = await rejectPendingHand(id);
        if (outcome.outcome === "not_found") return Errors.notFound(res, "Pending action");
        return res.json({ ok: true, outcome: outcome.outcome });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Step-Away Readiness — the machine-verified "can I leave?" answer ─────
  app.get(
    "/api/founder/autopilot/step-away",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { buildStepAwayReadiness } = await import("./services/autopilot/stepAwayReadiness");
        const readiness = await buildStepAwayReadiness();
        return res.json(readiness);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── WitnessGrants (step-away gap #5) — bounded delegation of the tap ──────
  // The founder issues/revokes scoped, expiring grants; the 5-minute auto-
  // witness sweep taps frozen actions a live grant covers. Zero grants =
  // exactly today's behavior.
  app.get(
    "/api/founder/autopilot/witness-grants",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { listWitnessGrants } = await import("./services/autopilot/witnessGrantStore");
        const grants = await listWitnessGrants();
        return res.json({ grants });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/autopilot/witness-grants",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const bodySchema = z.object({
        granteeId: z.string().min(1).max(128).default("solene"),
        domains: z.array(z.enum(AUTOPILOT_DOMAINS as unknown as [string, ...string[]])).min(1),
        maxCostUsd: z.number().positive().finite(),
        maxActions: z.number().int().positive().max(10_000),
        expiresInDays: z.number().positive().max(30),
        allowMoney: z.boolean().optional(),
        allowBroadcast: z.boolean().optional(),
        note: z.string().max(2_000).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      try {
        const { issueWitnessGrant } = await import("./services/autopilot/witnessGrantStore");
        const grant = await issueWitnessGrant({
          grantorId: getUserId(req),
          granteeId: parsed.data.granteeId,
          domains: parsed.data.domains as AutopilotDomain[],
          maxCostUsd: parsed.data.maxCostUsd,
          maxActions: parsed.data.maxActions,
          expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000),
          allowMoney: parsed.data.allowMoney,
          allowBroadcast: parsed.data.allowBroadcast,
          note: parsed.data.note ?? null,
        });
        return res.json({ grant });
      } catch (err) {
        // issueWitnessGrant throws plain Errors for bound violations — they are
        // founder-fixable validation failures, not 5xx.
        return Errors.badRequest(res, err instanceof Error ? err.message : String(err));
      }
    },
  );

  app.post(
    "/api/founder/autopilot/witness-grants/:id/revoke",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "Invalid id");
      const reason = typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : "revoked by founder";
      try {
        const { revokeWitnessGrant } = await import("./services/autopilot/witnessGrantStore");
        const revoked = await revokeWitnessGrant(id, reason);
        if (!revoked) return Errors.notFound(res, "Witness grant");
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

// ── Up-next plain-line formatting (kept here so the wording lives with the
// route, mirroring the wedge-receipts pattern) ───────────────────────────────

/** Plain-words lane names for a queued dispatch's sourceType. */
const UP_NEXT_KIND: Record<string, string> = {
  auto_dispatch: "Autopilot task",
  solene_manual: "Task the autopilot queued",
  founder_manual: "Task you asked for",
  founder_bypass: "Task you asked for",
  detector: "Follow-up on something the system noticed",
  code_review: "Review of earlier work",
  self_debug: "Fix-up of work that was flagged",
  adversarial_test: "Stress-test of earlier work",
  verify: "Check on how earlier work turned out",
  self_audit_drift: "Weekly self-audit",
  letter_reply: "Task from your reply to the Letter",
};

/** ET clock label (same UTC-4 approximation narrate.ts uses; never load-bearing). */
function formatEtTime(d: Date): string {
  const et = new Date(d.getTime() - 4 * 60 * 60 * 1000);
  const h = et.getUTCHours();
  const m = et.getUTCMinutes();
  const hr12 = ((h + 11) % 12) + 1;
  return `${hr12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"} ET`;
}

/**
 * One queued dispatch as one plain line — the real prompt's first line
 * (truncated) plus honest timing: a deferred row says when it becomes
 * claimable; anything else is simply waiting its turn in the queue.
 */
function upNextLine(r: {
  sourceType: string;
  promptText: string;
  notBeforeAt: Date | null;
  queuedAt: Date;
}): string {
  const firstLine =
    r.promptText
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ");
  const snippet = collapsed.length > 100 ? `${collapsed.slice(0, 100)}…` : collapsed;
  const kind = UP_NEXT_KIND[r.sourceType] ?? "Queued task";
  const timing =
    r.notBeforeAt && r.notBeforeAt.getTime() > Date.now()
      ? `queued for ${formatEtTime(r.notBeforeAt)}`
      : "ready to run, waiting its turn";
  return snippet ? `${kind}: “${snippet}” — ${timing}` : `${kind} — ${timing}`;
}
