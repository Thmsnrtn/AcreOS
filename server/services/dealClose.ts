/**
 * THE close writer (W10.4 contract items 1–3).
 *
 * Every consequence of a deal closing used to live inside ONE route — PUT
 * /api/deals/:id — while eight other writers (advance-stage, both bulk
 * endpoints, Pax update_deal, the autopilot, workflows, voice CRM, the Kanban
 * PATCH) moved `deals.status` to `closed` through the same repository and got
 * none of it: no calibration, no outcome snapshot, no comp, no commission, no
 * first_deal_closed. Which effects a close had depended on which button closed
 * it.
 *
 * They live here now, and the deal repository's post-write hook
 * (storage/dealRepo.ts updateDeal / bulkUpdateDeals) is the only caller of
 * `recordDealClose` — so a close has the same consequences on every path, and
 * PUT no longer runs them itself (no double-fire). Pinned by
 * oneCloseWriter.test.ts.
 *
 * Behaviour is PUT's, unchanged: the same evidence gates (a disposition's
 * accepted amount is the only sale price; a commission only with an explicit
 * config and a client-book deal; a comp only for a real cash sale) and the
 * same dedupe keys (`deal:<closedSaleDealKey>` for the training row).
 *
 * Fire-and-forget at the call site: the repository does not wait on a network
 * contribution or a Slack webhook before answering the write. Each effect is
 * independently guarded; one failing never stops the next.
 */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db, withTransaction, type PrimaryDb } from "../db";
import { deals, generatedDocuments, outcomeTelemetry, properties } from "@shared/schema";
import { DEAL_STATUS_TRANSITIONS, isDealStatus } from "@shared/lifecycle/pipeline-status";
import { logger } from "../utils/logger";
import { SAMPLE_APN_PREFIX } from "./onboarding/sampleMarkers";
import { DEAL_PURGED } from "./dealLifecycleEvents";
import type { ContractSignedEvidence } from "./wholesaleEvents";

/** The slice of a deal row the close effects read. Real columns only. */
interface ClosedDealRow {
  id: number;
  organizationId: number;
  status: string | null;
  type?: string | null;
  propertyId?: number | null;
  acceptedAmount?: string | number | null;
  offerAmount?: string | number | null;
  closingDate?: Date | string | null;
  assignedTo?: number | null;
  dealBook?: string | null;
  analysisResults?: unknown;
  createdAt?: Date | string | null;
}

/**
 * Request-only facts a writer may have. Never invented: a path with no acting
 * user passes none, and the effect that wants one records null.
 */
export interface DealWriteContext {
  /** The acting user, when a person made the write. */
  userId?: string | null;
  /** PUT only: the operator attested on this request that the contract is signed. */
  contractSignedAttested?: boolean;
}

/** The pause before the close's one retry of its property read. */
const CLOSE_PROPERTY_RETRY_MS = 250;

const warn = (what: string, dealId: number) => (err: unknown) =>
  logger.warn(`[deal-close] ${what} failed (non-fatal)`, {
    metadata: { dealId, error: err instanceof Error ? err.message : String(err) },
  });

/** The deal's property, org-scoped. */
async function propertyOf(orgId: number, propertyId: number | null | undefined, executor: Pick<PrimaryDb, "select"> = db) {
  if (propertyId == null) return null;
  const [p] = await executor
    .select()
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
    .limit(1);
  return p ?? null;
}

// ── The per-deal training lock (DEFECT-0258 (1)) ─────────────────────────────

/**
 * Run `fn` in a transaction holding the per-deal training advisory lock.
 *
 * The close's evidence read + training insert and every retraction of that
 * row (Close & Carry, a reopen, a delete) take THIS lock, so they serialize:
 * the insert's evidence is read after any retraction that committed first,
 * and a retraction that comes after the insert finds the row to retract.
 * Before this, the close read its evidence and inserted on separate
 * connections, unlocked, so a carry landing between the two was overwritten
 * by the insert's `isOutlier: false`.
 */
async function withDealTrainingLock<T>(
  orgId: number,
  dealId: number,
  fn: (tx: PrimaryDb) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`deal_training:${orgId}:${dealId}`}))`);
    return fn(tx);
  });
}

/**
 * Feed a qualifying closed SALE into the valuation training corpus
 * (transaction_training). closedSaleEvidence admits only a real cash
 * disposition; the row is keyed by the deal's anonymous dealKey (a re-close
 * is not a second sale; a reopen retracts it) and labelled "medium": an
 * operator-entered close is not a recorded deed price. The evidence read and
 * the insert are ONE transaction under the per-deal lock.
 */
async function recordClosedSaleTraining(orgId: number, dealId: number): Promise<"recorded" | "not_a_sale"> {
  const { closedSaleEvidence } = await import("./marketNetworkContributor");
  const { acreOSValuation } = await import("./acreOSValuation");
  return withDealTrainingLock(orgId, dealId, async (tx) => {
    const sale = await closedSaleEvidence(dealId, orgId, tx);
    if (!sale.ok) {
      logger.info("[deal-close] not recorded as a sale comp", { dealId, reason: sale.reason });
      return "not_a_sale" as const;
    }
    const prop = await propertyOf(orgId, sale.propertyId, tx);
    await acreOSValuation.recordTransactionForTraining(
      String(orgId),
      {
        propertyId: String(sale.propertyId),
        salePrice: sale.price,
        saleDate: sale.closingDate ?? new Date(),
        acres: sale.acres,
        pricePerAcre: sale.price / sale.acres,
        location: {
          state: sale.state,
          county: sale.county,
          zipCode: prop?.zip ?? "",
          latitude: prop?.latitude != null ? Number(prop.latitude) : 0,
          longitude: prop?.longitude != null ? Number(prop.longitude) : 0,
        },
        characteristics: {
          zoning: prop?.zoning ?? undefined,
          roadAccess: prop?.roadAccess ?? undefined,
          topography: prop?.terrain ?? undefined,
        },
        marketConditions: {
          quarterlyInterestRate: 0,
          localUnemploymentRate: 0,
          populationGrowth: 0,
          nearbyDevelopment: false,
        },
      },
      "medium",
      // Evidence re-read on THIS transaction under the lock every retraction
      // takes: a reopened-then-re-closed sale that qualifies now is live again.
      { dedupeKey: `deal:${sale.dealKey}`, tx, reaffirmUnderLock: true },
    );
    return "recorded" as const;
  });
}

/**
 * Retract the cash-sale label a close recorded (a carried, reopened or
 * deleted deal) under the same per-deal lock. Idempotent.
 *
 * Unconditional: Close & Carry calls this on a deal that IS closed — a
 * carried sale is seller-financed, so it is never a cash comp. A reopen goes
 * through recordDealReopen instead, which retracts only if the deal is not
 * closed again by the time it holds the lock.
 */
export async function retractClosedSaleTraining(orgId: number, dealId: number): Promise<boolean> {
  const { closedSaleDealKey } = await import("./marketNetworkContributor");
  const { acreOSValuation } = await import("./acreOSValuation");
  return withDealTrainingLock(orgId, dealId, (tx) =>
    acreOSValuation.retractTrainingTransaction(orgId, `deal:${closedSaleDealKey(orgId, dealId)}`, tx),
  );
}

/**
 * A deal LEFT `closed` — the bulk undo's backward move, or a delete. The
 * close's reversible money effects are reversed:
 *
 *  - the training row is retracted, under the per-deal lock, ONLY if the deal
 *    is not `closed` now. Both hooks are fire-and-forget, so close → undo →
 *    close in quick succession could run this reopen's retraction AFTER the
 *    re-close's insert and leave a closed sale retracted; reading the status
 *    on the locked transaction makes the last committed status decide.
 *  - the commission is retracted (commissionService.retractDealCommission):
 *    an unpaid record removed, a paid one kept and flagged for review —
 *    never removed or reset. Decided on the status now, too.
 *
 * Called by recordDealTransitionEvidence (dealLifecycleEvents.ts), the seam
 * every write out of `closed` passes. Each half is independently guarded.
 */
export async function recordDealReopen(
  orgId: number,
  dealId: number,
  toStatus: string | null | undefined,
): Promise<void> {
  const { closedSaleDealKey } = await import("./marketNetworkContributor");
  const { acreOSValuation } = await import("./acreOSValuation");
  await withDealTrainingLock(orgId, dealId, async (tx) => {
    const [now] = await tx
      .select({ status: deals.status })
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)))
      .limit(1);
    if (now?.status === "closed") return false; // closed again since: the re-close's row stands
    return acreOSValuation.retractTrainingTransaction(orgId, `deal:${closedSaleDealKey(orgId, dealId)}`, tx);
  }).catch(warn("reopen training retraction", dealId));

  try {
    const { withdrawStagedNetworkContribution } = await import("./marketNetworkContributor");
    const network = await withdrawStagedNetworkContribution(orgId, dealId);
    if (network === "pooled") {
      // Already published into the cross-customer pool: changing that shared
      // aggregate is DEFECT-0235's founder decision, so it is logged, not edited.
      logger.warn("[deal-close] reopened deal's sale is already in the market-network pool (DEFECT-0235)", { dealId });
    }
  } catch (err) {
    warn("reopen network withdrawal", dealId)(err);
  }

  // A retention purge of an old closed deal is not "the sale didn't happen":
  // the commission an agent is owed on it stands.
  if (toStatus === DEAL_PURGED) return;
  try {
    const { retractDealCommission } = await import("./commissionService");
    // Shown to a person on the commissions page: words, not the status slug.
    await retractDealCommission(orgId, dealId, `Deal left closed (now ${(toStatus ?? "no status").replace(/_/g, " ")})`);
  } catch (err) {
    warn("reopen commission retraction", dealId)(err);
  }
}

// ── Contract evidence (contract item 2) ──────────────────────────────────────

/**
 * The evidence that a deal's purchase agreement was signed: a signed document
 * on the deal (a provider-completed e-sign receipt), else the operator's
 * explicit attestation on this request, else none (quality directive
 * 2026-09-29 — the stage alone is not evidence).
 */
async function contractSignedEvidence(
  orgId: number,
  dealId: number,
  attestedBy: string | null,
): Promise<ContractSignedEvidence | null> {
  const [doc] = await db
    .select({ id: generatedDocuments.id, signedAt: generatedDocuments.signedAt })
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.organizationId, orgId),
        eq(generatedDocuments.dealId, dealId),
        // A document is evidence of a signature when it carries one. "final"
        // means finalized for sending, not signed, and admitted every
        // generated-but-unsigned contract (audit of e3debe0).
        or(isNotNull(generatedDocuments.signedAt), eq(generatedDocuments.status, "signed")),
      ),
    )
    // The most recent signature first; Postgres sorts NULL first under a bare
    // DESC, which put an undated "signed" row ahead of a dated one.
    .orderBy(sql`${generatedDocuments.signedAt} desc nulls last`)
    .limit(1);
  if (doc) return { kind: "signed_document", documentId: doc.id, signedAt: doc.signedAt ?? null };
  if (attestedBy) return { kind: "operator_attested", attestedBy };
  return null;
}

/**
 * Emit deal.contract_signed for a deal that just entered escrow, iff there is
 * evidence. The ONE caller is the repository hook (on entering in_escrow), so
 * every path — PUT, advance-stage, bulk, the agent — emits exactly when a
 * signed document exists. PUT's operator attestation arrives as
 * `attested: true` with the acting user (DealWriteContext), never a guess:
 * an attestation with no acting user is no attestation.
 */
export async function emitContractSignedIfEvidenced(
  orgId: number,
  deal: ClosedDealRow & { closingDate?: Date | string | null },
  opts: { from: string | null | undefined; attested?: boolean; attestedBy?: string | null },
): Promise<void> {
  try {
    if (opts.from === "in_escrow" || deal.status !== "in_escrow") return;
    // Not a BACKWARD move. The bulk undo moves a deal back from closed into
    // in_escrow; that is not a contract being signed, and re-emitting would
    // re-fire every workflow keyed on it. A known status the machine does
    // not let forward into in_escrow is that move; a legacy or absent status
    // (which validateDealTransition lets into escrow) is a forward entry.
    const from = opts.from ?? null;
    if (isDealStatus(from) && !DEAL_STATUS_TRANSITIONS[from].includes("in_escrow")) return;
    const attestedBy = opts.attested === true && opts.attestedBy ? String(opts.attestedBy) : null;
    const evidence = await contractSignedEvidence(orgId, deal.id, attestedBy);
    const property = await propertyOf(orgId, deal.propertyId);
    const { emitContractSigned } = await import("./wholesaleEvents");
    emitContractSigned(opts.from, deal as Parameters<typeof emitContractSigned>[1], {
      propertyAddress: property?.address ?? null,
      evidence,
    });
  } catch (err) {
    warn("deal.contract_signed emit", deal.id)(err);
  }
}

// ── The close (contract item 1) ──────────────────────────────────────────────

/**
 * Claim this deal's FIRST win: write its deal_won outcome-telemetry row iff
 * none exists yet, under a per-deal lock, and say whether this call wrote it.
 *
 * The undo can move a closed deal back to in_escrow, and closing it again
 * re-enters `closed` — a genuine transition, so the repository hook runs the
 * close again. The effects that are not idempotent by their own key (deal_won
 * telemetry, the lead conversion, the "won" calibration, the team post, the
 * referral moment, the pattern fingerprint) run only for the first win; the
 * row is the dedupe key, so it holds across processes and restarts.
 */
async function claimFirstWin(orgId: number, deal: ClosedDealRow): Promise<boolean> {
  return withTransaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`deal_won:${orgId}:${deal.id}`}))`);
    // A close undone before its hook ran is not a win: nothing is claimed,
    // and a later re-close claims it then.
    const [now] = await tx
      .select({ status: deals.status })
      .from(deals)
      .where(and(eq(deals.id, deal.id), eq(deals.organizationId, orgId)))
      .limit(1);
    if (now?.status !== "closed") return false;
    const [prior] = await tx
      .select({ id: outcomeTelemetry.id })
      .from(outcomeTelemetry)
      .where(
        and(
          eq(outcomeTelemetry.organizationId, orgId),
          eq(outcomeTelemetry.relatedDealId, deal.id),
          eq(outcomeTelemetry.outcomeType, "deal_won"),
        ),
      )
      .limit(1);
    if (prior) return false;
    await tx.insert(outcomeTelemetry).values({
      organizationId: orgId,
      outcomeType: "deal_won",
      outcome: {
        success: true,
        value: deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined,
        details: { dealType: deal.type, stage: deal.status },
      },
      contributingFactors: {
        offerAmount: deal.offerAmount ? parseFloat(String(deal.offerAmount)) : undefined,
        sequenceUsed: undefined, // deals has no sequenceId column
        marketConditions: (deal.analysisResults ?? undefined) as Record<string, unknown> | undefined,
      },
      relatedDealId: deal.id,
      relatedPropertyId: deal.propertyId ?? undefined,
    });
    return true;
  });
}

/**
 * Every consequence of a deal entering `closed` (won) or `cancelled` (lost),
 * moved verbatim out of PUT /api/deals/:id. Called ONLY by the repository's
 * post-write hook, once per genuine transition (the conditional UPDATE makes
 * the racing second writer throw StaleDealWriteError instead of re-running
 * this). Creation never calls it: an imported or sample close is history.
 */
export async function recordDealClose(
  orgId: number,
  before: { status?: string | null } | null | undefined,
  after: ClosedDealRow,
  ctx: DealWriteContext = {},
): Promise<void> {
  if (!before || (before.status ?? null) === (after.status ?? null)) return;
  const deal = after;
  const dealId = deal.id;
  const isFirstClose = deal.status === "closed";
  const isFirstCancel = deal.status === "cancelled";
  if (!isFirstClose && !isFirstCancel) return;
  const terminalOutcome = isFirstClose ? ("won" as const) : ("lost" as const);

  // Sample data is not a sale (DEFECT-0137's rule, the one every money
  // surface applies: a deal on a SAMPLE- parcel is sample lineage). Closing
  // the demo deal used to record first_deal_closed — onConflictDoNothing, so
  // the org's REAL first close was later dropped — plus deal_won telemetry,
  // calibration, a Slack post, a referral moment, a pattern and a lead
  // conversion. None of it runs. A property we cannot read is not presumed
  // real: the read is retried once (a bulk close is exactly when the pool is
  // busiest), and a second failure records nothing and is logged as an ERROR
  // naming the deal — every effect it skipped, for reconciliation.
  let property: Awaited<ReturnType<typeof propertyOf>>;
  try {
    property = await propertyOf(orgId, deal.propertyId).catch(async () => {
      await new Promise((r) => setTimeout(r, CLOSE_PROPERTY_RETRY_MS));
      return propertyOf(orgId, deal.propertyId);
    });
  } catch (err) {
    logger.error("[deal-close] property unreadable (sample-lineage check) — NO close effects recorded; reconcile this deal", {
      metadata: { orgId, dealId, toStatus: deal.status, error: err instanceof Error ? err.message : String(err) },
    });
    return;
  }
  if ((property?.apn ?? "").startsWith(SAMPLE_APN_PREFIX)) {
    logger.info("[deal-close] sample-data deal — no close effects", { dealId });
    return;
  }

  // Once per deal (closed → undo → closed): the deal_won telemetry row is the
  // claim. Taken under a per-deal lock; the effects that would double-record
  // run only for the FIRST win. A claim that fails is not a first win.
  let firstWin = false;
  if (isFirstClose) {
    try {
      firstWin = await claimFirstWin(orgId, deal);
    } catch (err) {
      warn("deal_won claim", dealId)(err);
    }
  }
  // A cancel's half is unchanged.
  const firstOutcome = isFirstCancel || firstWin;

  // Outcome loop (S2c): a deal reaching a terminal status feeds the LCS
  // calibration loop automatically — once per won deal.
  if (firstOutcome) {
    void import("./outcomeCalibrationLoop")
      .then(({ onDealClosed }) => onDealClosed(orgId, dealId, terminalOutcome))
      .catch(warn("outcome calibration hook", dealId));
  }

  // Referral: a WON deal no longer rewards (founder decision 2026-09-01 — the
  // reward gates on PAID conversion + a 30-day hold); it is the share moment.
  if (terminalOutcome === "won" && firstWin) {
    void import("./referralReward")
      .then(({ recordReferralShareMoment }) => recordReferralShareMoment(orgId))
      .catch(warn("referral share-moment hook", dealId));
  }

  const acceptedAmount = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : null;

  // Magnus §1 — ML training snapshots on deal close / cancel. `closed` is
  // closed_won; `cancelled` is closed_lost.
  try {
    const { recordSnapshotAsync, pairOutcomeAsync } = await import("./mlSnapshots");
    const wonOrLost = isFirstClose ? "closed_won" : "closed_lost";
    const offerAmount = deal.offerAmount ? parseFloat(String(deal.offerAmount)) : null;

    recordSnapshotAsync({
      snapshotType: "deal_outcome",
      subjectType: "deal",
      subjectId: String(dealId),
      orgId,
      // The decision was made when the deal entered the pipeline; createdAt is
      // the closest recorded proxy.
      decisionAt: deal.createdAt ? new Date(deal.createdAt as string | Date) : new Date(),
      outcomeAt: new Date(),
      features: {
        dealType: deal.type,
        propertyId: deal.propertyId,
        offerAmount,
        analysisResults: deal.analysisResults ?? null,
        // deals has no sequenceId column; left null, never guessed.
        sequenceId: null,
      },
      labels: {
        outcome: wonOrLost,
        acceptedAmount,
        status: deal.status,
      },
    });

    // Pair the AVM snapshot with the actual sale price (closed_won only).
    // Only a DISPOSITION's accepted amount is a sale price; an acquisition's
    // is what the investor paid (audit of e3debe0).
    if (isFirstClose && deal.propertyId && acceptedAmount && deal.type === "disposition") {
      pairOutcomeAsync({
        snapshotType: "avm_vs_actual",
        subjectType: "property",
        subjectId: String(deal.propertyId),
        outcomeLabels: {
          actualSalePrice: acceptedAmount,
          dealId,
        },
        outcomeAt: new Date(),
      });

      // The training row: evidence read + insert in ONE locked transaction.
      void recordClosedSaleTraining(orgId, dealId).catch(warn("recordTransactionForTraining", dealId));
    }

    // Pair the lead-conversion snapshot — closed = converted, cancelled = dismissed.
    try {
      if (property && property.sellerId) {
        pairOutcomeAsync({
          snapshotType: "lead_conversion",
          subjectType: "lead",
          subjectId: String(property.sellerId),
          outcomeLabels: {
            outcome: isFirstClose ? "converted" : "dismissed",
            dealId,
            acceptedAmount,
          },
          outcomeAt: new Date(),
        });
      }
    } catch { /* non-fatal */ }
  } catch { /* non-fatal */ }

  if (!isFirstClose) return;

  // Phase 5 §5 Part D (team readiness) — deal_closed Slack/Teams event.
  // Once per deal: a re-close after an undo is not a second closing to announce.
  if (firstWin) {
    try {
      const { dispatchTeamEvent } = await import("./teamWebhookDispatcher");
      await dispatchTeamEvent(orgId, "deal_closed", {
        title: "Deal closed",
        body: `Deal #${dealId} closed${deal.acceptedAmount ? ` at $${Number(deal.acceptedAmount).toLocaleString()}` : ""}.`,
        context: {
          dealId,
          acceptedAmount: deal.acceptedAmount,
          dealType: deal.type,
        },
      });
    } catch { /* non-fatal */ }
  }

  // Wave 2 pass C — auto-record the closing agent's commission
  // (agent_investor commission wedge). HONESTY GATE: record ONLY when (a) the
  // deal has an assigned agent and (b) the org has EXPLICITLY saved a
  // commission tier config — recording against DEFAULT_CONFIG would fabricate
  // a commission the operator never set up. Signature:
  // recordDealCommission(orgId, teamMemberId, dealId, salePriceCents) —
  // teamMemberId is the deal's assigned agent.
  if (deal.assignedTo != null) {
    const saleAmount = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : 0;
    if (Number.isFinite(saleAmount) && saleAmount > 0) {
      void (async () => {
        const { hasCommissionConfig, recordDealCommission } = await import("./commissionService");
        // STAGE 1 (migration 0226) — an 'own_investment' deal is the agent's
        // OWN P&L, never a brokerage commission. NULL book = client.
        if (deal.dealBook === "own_investment") return;
        if (!(await hasCommissionConfig(orgId))) return; // no config → skip, never fabricate
        // Idempotent per deal (a re-close replaces an UNPAID record; a paid
        // one is never replaced), and decided on the deal's status when it
        // runs — an undo that landed first means no commission.
        await recordDealCommission(
          orgId,
          deal.assignedTo!,
          deal.id,
          Math.round(saleAmount * 100),
          undefined,
          { onlyIfDealClosed: true },
        );
      })().catch(warn("commission auto-record", dealId));
    }
  }

  // Lead scoring feedback loop: the seller lead converted — once per deal.
  try {
    if (firstWin && property && property.sellerId) {
      const dealValue = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined;
      const { leadScoringService } = await import("./leadScoring");
      await leadScoringService.recordConversion(property.sellerId, orgId, "deal_closed", {
        dealValue,
        profitMargin: (deal.analysisResults as { netProfit?: number } | null | undefined)?.netProfit,
      });
    }
  } catch (conversionErr) {
    logger.error("Failed to record conversion", conversionErr instanceof Error ? conversionErr : undefined);
  }

  // Phase 3 Week 14 — activation telemetry. The acting user when a person
  // closed it; null otherwise (never a guessed user).
  try {
    const { recordActivationEventAsync } = await import("./activation");
    recordActivationEventAsync({
      orgId,
      userId: ctx.userId ?? null,
      eventName: "first_deal_closed",
      eventValue: { dealId, acceptedAmount: deal.acceptedAmount },
    });
  } catch { /* non-fatal */ }

  // Outcome telemetry for the feedback loop: the deal_won row was written by
  // claimFirstWin above (it IS the once-per-deal claim).

  // Pillar 3 market signal contribution (non-blocking).
  void import("./marketNetworkContributor")
    .then(({ contributeClosedDealToNetwork }) => contributeClosedDealToNetwork(dealId, orgId))
    .catch((err: unknown) => {
      logger.error("Market signal contribution failed", { error: err instanceof Error ? err.message : String(err) });
    });

  // Auto-fingerprint the closed deal for pattern cloning (non-blocking) —
  // once per deal.
  if (firstWin) void import("./dealPatternCloning")
    .then(({ dealPatternCloningService }) => dealPatternCloningService.recordPatternFromClosedDeal(orgId, dealId))
    .catch((err: unknown) => {
      logger.error("deal pattern fingerprint failed", { error: err instanceof Error ? err.message : String(err) });
    });
}
