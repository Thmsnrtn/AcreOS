/**
 * The AI-disclaimer surface registry (PKG-5c) — every customer-facing surface
 * where Pax / AI produces tax-, legal- or financial-flavoured output, and what
 * disclaimer it carries.
 *
 * It lives beside `statuteRegister.ts` and `constitution.ts` because it is the
 * same kind of artefact: a machine-readable map of an obligation, read by a
 * ratchet test (`tests/unit/aiDisclaimerSurfaces.test.ts`) that proves each
 * entry against the actual source rather than against this file's own claims.
 *
 * NO DISCLAIMER WORDING LIVES HERE. The copy is owned by the client components
 * (`RequiredDisclaimer`, `DisclaimerBanner`) and, server-side, by
 * `DISCLAIMER_AI` in server/services/legalDisclaimers.ts. This registry only
 * says which surface uses which component.
 *
 * STATUS
 *  - present          carried a disclaimer before PKG-5c
 *  - added            PKG-5c wired the component on (`before`: "none", or "partial" =
 *                     only a standing line / PaxDisclosureRail, not the canonical copy)
 *  - covered-by-host  a card/row rendered only inside hosts that carry the
 *                     disclaimer themselves (repeating it per card is noise);
 *                     `hosts` are asserted to carry it
 *  - not-advice       no tax/legal/financial-flavoured AI output (settings,
 *                     transparency, data plumbing, unmounted) — `reason` says why
 *  - founder-only     out of scope; noted, untouched
 */

export type AiDisclaimerStatus =
  | "present"
  | "added"
  | "covered-by-host"
  | "not-advice"
  | "founder-only";

export interface AiDisclaimerSurface {
  /** Repo-relative source file of the surface. */
  file: string;
  status: AiDisclaimerStatus;
  /** added: what the surface carried BEFORE PKG-5c ("none", or "partial" = only a non-canonical standing line). */
  before?: "none" | "partial";
  /** present/added: the JSX opening tag that must appear in the file. */
  component?: "RequiredDisclaimer" | "DisclaimerBanner";
  /** present/added: the `type` prop of that tag. */
  variant?: string;
  /** present/added: minimum number of such JSX usages in the file. */
  minUsages?: number;
  /** covered-by-host: files that must carry the disclaimer. */
  hosts?: string[];
  /** not-advice / founder-only / covered-by-host: one line, why. */
  reason?: string;
}

const C = "client/src/components/";
const P = "client/src/pages/";

export const AI_DISCLAIMER_SURFACES: readonly AiDisclaimerSurface[] = [
  // ── Pax conversation surfaces ──────────────────────────────────────────
  { file: `${C}pax-copilot-rail.tsx`, status: "added", before: "partial", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${C}help/HelpPanel.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${P}pax.tsx`, status: "added", before: "partial", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${P}command-center.tsx`, status: "present", component: "DisclaimerBanner", variant: "ai" },
  { file: `${C}property-analysis-chat.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  {
    file: `${C}pax/PaxAskCard.tsx`,
    status: "covered-by-host",
    hosts: [
      `${C}pax-copilot-rail.tsx`,
      `${C}help/HelpPanel.tsx`,
      `${C}today/DecisionQueue.tsx`,
      `${P}command-center.tsx`,
    ],
    reason: "Approval card rendered once per Pax proposal, only inside hosts that carry the disclaimer; a per-card banner would repeat down the list.",
  },
  { file: `${C}today/DecisionQueue.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${P}inbox.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },

  // ── Generated advice-flavoured content ────────────────────────────────
  { file: `${C}ai-offer-generator.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${C}deal-detail-content.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai", minUsages: 2 },
  { file: `${C}deal-feed/daily-deal-feed.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${C}due-diligence-panel.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${P}portfolio.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  { file: `${P}portfolio-optimizer.tsx`, status: "added", before: "none", component: "RequiredDisclaimer", variant: "ai" },
  {
    file: `${C}ai-reasoning.tsx`,
    status: "covered-by-host",
    hosts: [`${C}deal-feed/daily-deal-feed.tsx`, `${C}ai-offer-generator.tsx`],
    reason: "Explanation chip rendered only inside the deal feed and the offer generator.",
  },

  // ── Already carried a (non-"ai") disclaimer ───────────────────────────
  { file: `${P}finance.tsx`, status: "present", component: "DisclaimerBanner", variant: "finance" },
  { file: `${P}tax-optimizer.tsx`, status: "present", component: "RequiredDisclaimer", variant: "financial" },

  // ── Marked not-advice (judgement calls — see reasons) ────────────────
  { file: `${C}content-generation.tsx`, status: "not-advice", reason: "Marketing/share copy generation (campaign subject+body); no importer in client/src today, so nothing mounts it." },
  { file: `${C}seller-intent-panel.tsx`, status: "not-advice", reason: "No importer in client/src today (unmounted); intent-score panel, revisit if it is mounted." },
  { file: `${C}pax-why-explainer.tsx`, status: "not-advice", reason: "Explains why Pax took an action (transparency); not advice." },
  { file: `${C}pax/pax-recourse-panel.tsx`, status: "not-advice", reason: "Appeals and refusals of Pax actions; not advice." },
  { file: `${C}growth/PaxLanguageCard.tsx`, status: "not-advice", reason: "Pax language preference setting." },
  { file: `${C}pax-memory-panel.tsx`, status: "not-advice", reason: "Pax memory management panel; shown from inside the rail, which carries the disclaimer." },
  { file: `${C}pax-knowledge-panel.tsx`, status: "not-advice", reason: "Pax knowledge-base management panel (rail sheet)." },
  { file: `${C}pax-connector-panel.tsx`, status: "not-advice", reason: "Connector management panel (rail sheet)." },
  { file: `${C}pax-project-panel.tsx`, status: "not-advice", reason: "Project management panel (rail sheet)." },
  { file: `${C}pax-entity-picker.tsx`, status: "not-advice", reason: "Entity search picker; returns records, no generated text." },
  { file: `${C}pax-schedule-button.tsx`, status: "not-advice", reason: "Schedules a task; no generated output." },
  { file: `${C}pax-relationship-indicator.tsx`, status: "not-advice", reason: "Relationship-stage indicator." },
  { file: `${C}ai-cost-dashboard.tsx`, status: "not-advice", reason: "Settings usage/cost report." },
  { file: `${C}layout-sidebar.tsx`, status: "not-advice", reason: "Navigation badge counts only." },
  { file: "client/src/hooks/usePaxNeedsYou.ts", status: "not-advice", reason: "Data hook; renders nothing." },
  { file: "client/src/hooks/use-due-diligence.ts", status: "not-advice", reason: "Data hook; its only consumer, due-diligence-panel, carries the disclaimer." },
  { file: `${P}activity.tsx`, status: "not-advice", reason: "Receipts of what Pax did; a log, not advice." },
  { file: `${P}settings/pax-controls.tsx`, status: "not-advice", reason: "Pax controls settings." },

  // ── Founder-only: out of scope, not touched ──────────────────────────
  { file: "client/src/components/founder/ai-console/AiOperationsPanel.tsx", status: "founder-only", reason: "Founder AI console." },
];

/**
 * Founder-only trees the completeness sweep does not require to be registered.
 * Any path containing one of these segments is out of scope.
 */
export const FOUNDER_ONLY_PATH_SEGMENTS: readonly string[] = [
  "/founder/",
  "/founder-chat/",
];

/**
 * COUNSEL FLAGS — flags only, no action taken in PKG-5c, no product copy
 * changed. For counsel to rule on.
 */
export const AI_DISCLAIMER_COUNSEL_FLAGS: readonly string[] = [
  "Section numbering: the draft ToS numbers the AI disclosure §7, while the repo terms page (client/src/pages/terms.tsx) numbers it §3. One of the two needs to move before the in-product pointer to 'the AI disclosure' can cite a section.",
  "Scope (LQ-03): §7 may need extending to cover valuations, predictions and distress signals, not only conversational AI output. This registry marks surfaces that show model output (AVM-style estimates, acceptance predictions, distress/intent scores) as in scope only where they are AI-generated text; the non-AI valuation surfaces keep their own 'valuation'/'score' disclaimers.",
  "Wording split: the client 'ai' variants (RequiredDisclaimer, DisclaimerBanner) are shorter than DISCLAIMER_AI in server/services/legalDisclaimers.ts and do not name fiduciary/legal/tax advice; counsel may want the client copy reconciled with the server copy. Not changed here.",
];
