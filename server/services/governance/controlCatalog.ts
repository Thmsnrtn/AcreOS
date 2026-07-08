/**
 * Governance Control Catalog (Frontier #14).
 *
 * The single, structured map of EVERY governance control the autopilot runs
 * under — gates, switches, invariants, and audit surfaces — each with what it
 * prevents, where it's enforced, and (critically) HOW IT FAILS. A control that
 * fails OPEN is a liability; the catalog makes every fail-mode explicit and
 * machine-checkable, so "is the autonomy actually governed?" has a literal,
 * auditable answer instead of a verbal assurance.
 *
 * This is both a founder-trust surface and the sellable Foundry artifact (it
 * drops straight into the evidence packet / a regulator's questionnaire). It is
 * a COMPOSITION/product layer — it names AcreOS-specific control points — so it
 * lives under governance/, not in the domain-agnostic kernel.
 *
 * Pure data + a renderer. The catalog is asserted COMPLETE by a test: every
 * gate the policy stack runs MUST appear here, so a new gate can't ship
 * uncatalogued.
 */

export type ControlKind = "gate" | "switch" | "invariant" | "audit";
/** A control fails CLOSED (denies/halts on failure — safe) or OPEN (permits — unsafe). */
export type FailMode = "closed" | "open" | "n/a";

export interface GovernanceControl {
  id: string;
  name: string;
  kind: ControlKind;
  /** What this control prevents / guarantees, in one line. */
  prevents: string;
  /** Where it is enforced (module / function) — the auditable location. */
  enforcedAt: string;
  /** On its own failure/uncertainty, does it deny (closed) or permit (open)? */
  failMode: FailMode;
}

/**
 * THE CATALOG. Ordered by the path an outward action travels: switches that can
 * halt everything → the gate stack it must clear → the invariants that hold by
 * construction → the audit surfaces that record + re-verify it.
 */
export const GOVERNANCE_CONTROLS: readonly GovernanceControl[] = [
  // ── Master switches (can halt the whole loop) ──
  {
    id: "panic_stop",
    name: "Panic stop",
    kind: "switch",
    prevents: "Any action firing while the founder has hit the kill switch — re-read cooperatively at the witnessed choke point, outside the agent's reach.",
    enforcedAt: "autopilot/settings.isPanicStopped + hands/registry.executeHandWitnessed",
    failMode: "closed",
  },
  {
    id: "dispatch_enabled",
    name: "Dispatch master switch",
    kind: "switch",
    prevents: "The brain dispatching at all when autonomy is OFF — DB-backed, env-safe-off default, re-checked each loop + worker cycle.",
    enforcedAt: "autopilot/settings (autopilot_settings.dispatchEnabled)",
    failMode: "closed",
  },
  {
    id: "publish_enabled",
    name: "Publish master switch",
    kind: "switch",
    prevents: "Any outward publish (the /field-notes rail, marketing artifacts) while publishing is OFF.",
    enforcedAt: "autopilot/settings (autopilot_settings.publishEnabled)",
    failMode: "closed",
  },
  // ── The gate stack (an action must clear all, in order) ──
  {
    id: "compliance_gate",
    name: "Compliance / claims gate",
    kind: "gate",
    prevents: "Outward content making prohibited claims (determinations, investment advice, fair-housing, undisclosed material) — profile-driven screen.",
    enforcedAt: "autopilot/claimsEngine + publishArtifact claimsGate",
    failMode: "closed",
  },
  {
    id: "eval_gate",
    name: "Quality / grounding gate",
    kind: "gate",
    prevents: "A low-quality or ungrounded draft going out — scored before send.",
    enforcedAt: "autopilot/decisionEval",
    failMode: "closed",
  },
  {
    id: "budget_gate",
    name: "Budget / reserve gate",
    kind: "gate",
    prevents: "Spend that breaches the reserve floor or the ensemble cost cap — ramps only on proven-healthy CAC.",
    enforcedAt: "autopilot/economics.budgetGate + cognitionBudget",
    failMode: "closed",
  },
  {
    id: "domain_autonomy_gate",
    name: "Earned-autonomy gate",
    kind: "gate",
    prevents: "A domain acting beyond the autonomy level it has EARNED (OBSERVE → … → TRUSTED) via clean cycles.",
    enforcedAt: "autopilot/domainAutonomy + policyGate",
    failMode: "closed",
  },
  {
    id: "risk_gate",
    name: "Risk-calibrated escalation",
    kind: "gate",
    prevents: "A novel / irreversible / expensive action auto-running even in a trusted domain; an over-confident (miscalibrated) brain auto-running ANYTHING.",
    enforcedAt: "autopilot/riskautonomy.shouldEscalateForRisk",
    failMode: "closed",
  },
  {
    id: "premortem_gate",
    name: "Adversarial pre-mortem",
    kind: "gate",
    prevents: "A high-stakes auto-run proceeding without one skeptical look first (self-gates on high-stakes; active when a model is available).",
    enforcedAt: "autopilot/safety.runPremortem",
    failMode: "closed",
  },
  {
    id: "witnessed_send",
    name: "Witnessed-send",
    kind: "gate",
    prevents: "Any customer-facing / money / broadcast action firing without a real human approver's tap — refuses on a missing/blank witness.",
    enforcedAt: "hands/registry.executeHandWitnessed + approvalKernel",
    failMode: "closed",
  },
  // ── Invariants (hold by construction) ──
  {
    id: "unknown_action_maximally_risky",
    name: "Unknown action is maximally risky",
    kind: "invariant",
    prevents: "An unrecognized action kind being treated as safe — it defaults to customer-facing + irreversible (so it escalates).",
    enforcedAt: "autopilot/act.bindingFor (property-tested)",
    failMode: "closed",
  },
  {
    id: "money_always_witnessed",
    name: "Money never moves unwitnessed",
    kind: "invariant",
    prevents: "Any money-moving hand auto-running — movesMoney ⇒ witnessed-send by invariant, independent of domain.",
    enforcedAt: "hands/* movesMoney flag + policyGate (property-tested)",
    failMode: "closed",
  },
  {
    id: "broadcast_not_laundered",
    name: "Broadcast isn't laundered",
    kind: "invariant",
    prevents: "A public broadcast slipping through as a non-customer-facing action — outwardClass:'broadcast' forces a tap.",
    enforcedAt: "autopilot/policyGate (property-tested)",
    failMode: "closed",
  },
  {
    id: "learning_never_fabricates",
    name: "Learning never fabricates",
    kind: "invariant",
    prevents: "Estimated / counterfactual outcomes feeding the reward edge — successes/failures derive ONLY from real signals; shadow regret is read-only.",
    enforcedAt: "autopilot/experienceLog + efficacy + shadowRegret (the sacred line)",
    failMode: "n/a",
  },
  // ── Audit surfaces (record + re-verify) ──
  {
    id: "proof_receipt_chain",
    name: "Proof-receipt hash chain",
    kind: "audit",
    prevents: "An undetected edit to the witnessed-action record — per-row seal + prev-hash linkage, re-verified daily and offline-verifiable.",
    enforcedAt: "autopilot/proofReceipt + proofReceiptStore + scripts/verify-receipt.mjs",
    failMode: "n/a",
  },
  {
    id: "audit_log_chain",
    name: "Audit-log hash chain",
    kind: "audit",
    prevents: "Tampering with the per-org compliance audit log — end-to-end hash-chain verification.",
    enforcedAt: "compliance/auditChain.verifyAuditChain",
    failMode: "n/a",
  },
  {
    id: "evidence_packet",
    name: "Governance evidence packet",
    kind: "audit",
    prevents: "An unverifiable governance posture — composes the audit chain + witnessed sends + trust ledger + constitution into one sealed, re-derivable artifact.",
    enforcedAt: "governance/evidencePacket",
    failMode: "n/a",
  },
] as const;

export interface ControlCatalogSummary {
  total: number;
  byKind: Record<ControlKind, number>;
  /** Controls that can fail OPEN — the audit's red flags (should be empty). */
  failOpen: string[];
}

/** Pure: aggregate the catalog. failOpen SHOULD be empty — every gate/switch fails closed. */
export function summarizeControlCatalog(controls: readonly GovernanceControl[] = GOVERNANCE_CONTROLS): ControlCatalogSummary {
  const byKind: Record<ControlKind, number> = { gate: 0, switch: 0, invariant: 0, audit: 0 };
  const failOpen: string[] = [];
  for (const c of controls) {
    byKind[c.kind] += 1;
    if (c.failMode === "open") failOpen.push(c.id);
  }
  return { total: controls.length, byKind, failOpen };
}

/** Pure: render the catalog as a Markdown table for the evidence packet / a regulator doc. */
export function renderControlCatalogMarkdown(controls: readonly GovernanceControl[] = GOVERNANCE_CONTROLS): string {
  const rows = controls
    .map((c) => `| ${c.id} | ${c.name} | ${c.kind} | ${c.failMode} | ${c.prevents} | \`${c.enforcedAt}\` |`)
    .join("\n");
  return [
    "# AcreOS Governance Control Catalog",
    "",
    "Every control an autonomous action runs under, and how each fails.",
    "",
    "| id | control | kind | fail-mode | prevents | enforced at |",
    "| --- | --- | --- | --- | --- | --- |",
    rows,
    "",
  ].join("\n");
}
