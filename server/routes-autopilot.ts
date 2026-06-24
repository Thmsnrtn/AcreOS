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
        const enriched = await Promise.all(
          ledger.map(async (entry) => {
            try {
              const quality = await getDomainDecisionQuality(entry.domain);
              return { ...entry, quality, qualityLine: decisionEvalLine(quality) };
            } catch {
              return { ...entry, quality: null, qualityLine: null };
            }
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
        logger.error("[autopilot] founder tripped PANIC STOP via API", { reason });
        return res.json({ ok: true, ...result });
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
        const [settings, ledger] = await Promise.all([getEffectiveSettings(), getTrustLedger()]);
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
      if (key !== "dispatchEnabled" && key !== "publishEnabled" && key !== "cognitionEnabled") {
        return Errors.badRequest(res, "Invalid setting key", { allowed: ["dispatchEnabled", "publishEnabled", "cognitionEnabled"] });
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
        const { setDomainLevel: setLvl, getDomainLevel, nextLevel } = await import(
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
}
