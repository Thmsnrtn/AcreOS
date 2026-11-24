/**
 * The founder route tree — every founder-owned route registration and its lazy
 * page import. P1-9 / X-2: this moved OUT of client/src/App.tsx so the founder
 * pages ship only in the founder output (dist/founder, mounted by
 * client/src/FounderApp.tsx) and never in the customer bundle.
 *
 * What lives here:
 *   - every `/founder*` route except `/founder-dashboard` (a legacy alias the
 *     customer build keeps, because the server's founder-shell selector covers
 *     `/founder` and `/founder/*` only — shared/founder-surface-paths.ts);
 *   - the six founder-gated pages at non-/founder URLs (/admin/safety-gates,
 *     /executive-dashboard, /dunning, /reseller, /agent-performance,
 *     /job-health).
 * `/commissions` stays in App.tsx: its page module is shared with the
 * customer's Finance → Commissions surface.
 *
 * The four-door doctrine and the FOUNDER_ROUTE_BASELINE ratchet
 * (tests/unit/founderFourDoors.test.ts) count THIS file plus App.tsx — the split
 * must never become a way to hide routes from the ratchet. New founder surfaces
 * live behind one of the four doors (client/src/lib/founder-doors.ts) as a
 * child/section/tab, not as a new top-level route here.
 *
 * Authorization is unchanged and server-side (requireFounder on /api/founder);
 * FounderProtectedRoute is UX gating only.
 */
import React from "react";
import { Switch, Route } from "wouter";
import { legacyAskSearch } from "@/lib/route-redirects";
import { FounderProtectedRoute } from "@/components/founder-protected-route";
import { Redirect } from "@/components/cross-build-redirect";
import NotFound from "@/pages/not-found";

// ─── Lazy-loaded founder page bundles ───────────────────────────────────────
const FounderAiObservatory = React.lazy(() => import("@/pages/founder-ai-observatory"));
const FounderFeatures = React.lazy(() => import("@/pages/founder/features"));
const FounderKeysPage = React.lazy(() => import("@/pages/founder/keys"));
const FounderReadinessPage = React.lazy(() => import("@/pages/founder/readiness"));
// Beatrice/Lena — Launch Legal & Peace-of-Mind Readiness checklist surface.
const FounderLegalReadinessPage = React.lazy(() => import("@/pages/founder/legal-readiness"));
const FounderCustomersHealthPage = React.lazy(() => import("@/pages/founder/customers/health"));
const FounderGrowthCampaignsPage = React.lazy(() => import("@/pages/founder/growth/campaigns"));
const FounderTelemetryPage = React.lazy(() => import("@/pages/founder/telemetry"));
// Command cockpit — one synthesis surface aggregating every domain's
// continuous-audit findings into per-domain status tiles.
const FounderCommandPage = React.lazy(() => import("@/pages/founder/command"));
// Costs & economics consolidated into one /founder/admin/costs hub (Phase 2).
const FounderAdminCostsPage = React.lazy(() => import("@/pages/founder/admin/costs"));
const FounderLifeCockpitPage = React.lazy(() => import("@/pages/founder/life-cockpit"));
const FounderRecoveryConsolePage = React.lazy(() => import("@/pages/founder/recovery-console"));
const FounderFeedbackInboxPage = React.lazy(() => import("@/pages/founder/feedback-inbox"));
// Quinn + Rafe — "appeal the AI" founder review surface.
const FounderAppealsPage = React.lazy(() => import("@/pages/founder/appeals"));
// Rafe — the Recourse Loop.
const FounderRecoursePage = React.lazy(() => import("@/pages/founder/recourse"));
// Tier 3F — the data co-op's quarterly market-report DRAFT review surface.
const FounderMarketReportsPage = React.lazy(() => import("@/pages/founder/market-reports"));
const FounderAgentQueuePage = React.lazy(() => import("@/pages/founder/agent-queue"));
const FounderDispatchesPage = React.lazy(() => import("@/pages/founder/dispatches"));
// D2 signup-to-first-value funnel UI.
const FounderOnboardingFunnelPage = React.lazy(() => import("@/pages/founder/onboarding-funnel"));
const FounderFeedPage = React.lazy(() => import("@/pages/founder/feed"));
const FounderPaxTracesPage = React.lazy(() => import("@/pages/founder/pax-traces"));
const FounderPaxCalibrationPage = React.lazy(() => import("@/pages/founder/pax-calibration"));
// Wave 3 Workstream E — distribution truth surface.
const FounderCustomersPage = React.lazy(() => import("@/pages/founder/customers"));
// The Letter — the single fused founder home at /founder.
const FounderHomePage = React.lazy(() => import("@/pages/founder/home"));
// "Your Voice" — durable intents + standing orders the autopilot honors.
const FounderVoicePage = React.lazy(() => import("@/pages/founder/voice"));
// "The Story" — the glass-box timeline of every action + its full reasoning.
const FounderAutopilotStoryPage = React.lazy(() => import("@/pages/founder/autopilot-story"));
// The Control Center — master switches + per-domain trust + everything in one.
const FounderAutopilotControlPage = React.lazy(() => import("@/pages/founder/autopilot-control"));
// Categorized index of every founder deep-dive.
const FounderAllToolsPage = React.lazy(() => import("@/pages/founder/all-tools"));
const FounderTeamPage = React.lazy(() => import("@/pages/founder/team"));
const FounderMoneyPage = React.lazy(() => import("@/pages/founder/money"));
const FounderBuildPage = React.lazy(() => import("@/pages/founder/build"));
// Phase 3 — iOS-Claude-UX chat surface (the live founder chat face).
const FounderSoleneChatPage = React.lazy(() => import("@/pages/founder/solene-chat"));
const FounderBridgePage = React.lazy(() => import("@/pages/founder/bridge"));
const FounderCockpitPage = React.lazy(() => import("@/pages/founder/cockpit"));
const FounderCmoPage = React.lazy(() => import("@/pages/founder/cmo"));
const FounderStudioPage = React.lazy(() => import("@/pages/founder/studio"));
const FounderInspectorRouter = React.lazy(() => import("@/pages/founder/inspector"));
const FounderTrustGraduationPage = React.lazy(() => import("@/pages/founder/trust-graduation"));
const AgentDetailPage = React.lazy(() => import("@/pages/agent-detail"));
const SafetyGatesPage = React.lazy(() => import("@/pages/safety-gates"));
const ResellerDashboardPage = React.lazy(() => import("@/pages/reseller-dashboard"));
const ExecutiveDashboardPage = React.lazy(() => import("@/pages/executive-dashboard"));
// Sovereign Protocol — Census W3-1 refit surfaces under /founder/*.
const FounderGovernancePage = React.lazy(() => import("@/pages/founder/governance"));
const AgentPerformancePage = React.lazy(() => import("@/pages/agent-performance"));
const FounderEventLogPage = React.lazy(() => import("@/pages/founder/event-log"));
const JobHealthPage = React.lazy(() => import("@/pages/job-health"));
const FounderScenariosPage = React.lazy(() => import("@/pages/founder/scenarios"));
const FounderComplianceOpsPage = React.lazy(() => import("@/pages/founder-compliance-ops"));
const FounderDecisionsPage = React.lazy(() => import("@/pages/founder-decisions"));
const FounderLetterPage = React.lazy(() => import("@/pages/founder-letter"));
const FounderSettingsPage = React.lazy(() => import("@/pages/founder-settings"));
const FounderPreviewPage = React.lazy(() => import("@/pages/founder-preview"));
const FounderToolsPage = React.lazy(() => import("@/pages/founder-tools"));
const FounderPromptEvolutionsPage = React.lazy(() => import("@/pages/founder-prompt-evolutions"));
const FounderPromptHistoryPage = React.lazy(() => import("@/pages/founder-prompt-history"));
const FounderTracesPage = React.lazy(() => import("@/pages/founder-traces"));
const FounderStrategyPage = React.lazy(() => import("@/pages/founder-strategy"));
const FounderTrendsPage = React.lazy(() => import("@/pages/founder-trends"));
const FounderOnboardingPage = React.lazy(() => import("@/pages/founder-onboarding"));
const FounderExpansionPage = React.lazy(() => import("@/pages/founder-expansion"));
const FounderExperimentsPage = React.lazy(() => import("@/pages/founder-experiments"));
const DunningManagerPage = React.lazy(() => import("@/pages/dunning-manager"));

/**
 * The founder Switch. Rendered by FounderApp inside its Suspense + shell.
 *
 * The Letter (/founder) is the single founder home per the four-door doctrine
 * (client/src/lib/founder-doors.ts + CLAUDE.md). Every legacy founder-home
 * variant redirects to /founder; Bridge stays reachable as a deep chat +
 * telemetry TOOL, not a competing home. Retired surfaces keep a redirect so an
 * old bookmark lands somewhere real (see client/src/lib/route-redirects.ts).
 */
export function FounderRoutes() {
  return (
    <Switch>
      <Route path="/founder/now">
        {() => <Redirect to="/founder" />}
      </Route>
      <Route path="/founder/cockpit">
        {() => <Redirect to="/founder" />}
      </Route>
      {/* Pillar R — per-(agent, category) tier admin. */}
      <Route path="/founder/trust-graduation">
        {() => <FounderProtectedRoute component={FounderTrustGraduationPage} />}
      </Route>
      {/* CMO ad engine — single founder surface to review + ship ads. */}
      <Route path="/founder/cmo">
        {() => <FounderProtectedRoute component={FounderCmoPage} />}
      </Route>
      {/* Studio — every dial in one place. */}
      <Route path="/founder/studio">
        {() => <FounderProtectedRoute component={FounderStudioPage} />}
      </Route>
      {/* Inspector — provenance lens for agents, decisions, the audit trail. */}
      <Route path="/founder/inspector/:scope/:id">
        {() => <FounderProtectedRoute component={FounderInspectorRouter} />}
      </Route>
      <Route path="/founder/inspector/audit">
        {() => <FounderProtectedRoute component={FounderInspectorRouter} />}
      </Route>
      <Route path="/founder/dashboard">
        {() => <Redirect to="/founder" />}
      </Route>
      {/* D6 — the single fused founder home (board report + pulse strip + chat +
          hub). The old Pulse and /founder/autopilot (Letter) overviews redirect here. */}
      <Route path="/founder">
        {() => <FounderProtectedRoute component={FounderHomePage} />}
      </Route>
      <Route path="/founder/today">
        {() => <Redirect to="/founder" />}
      </Route>
      <Route path="/founder/autopilot">
        {() => <Redirect to="/founder" />}
      </Route>
      {/* "Your Voice" — durable intents + standing orders the autopilot honors. */}
      <Route path="/founder/autopilot/voice">
        {() => <FounderProtectedRoute component={FounderVoicePage} />}
      </Route>
      {/* "The Story" — glass-box timeline of every autopilot action + its why. */}
      <Route path="/founder/autopilot/story">
        {() => <FounderProtectedRoute component={FounderAutopilotStoryPage} />}
      </Route>
      {/* The Control Center — master switches + per-domain trust + status. */}
      <Route path="/founder/autopilot/control">
        {() => <FounderProtectedRoute component={FounderAutopilotControlPage} />}
      </Route>
      <Route path="/founder/all-tools">
        {() => <FounderProtectedRoute component={FounderAllToolsPage} />}
      </Route>
      {/* iOS-Claude-UX chat surface. 2026-07-27: canonical path renamed to
          /founder/chat — "Solene" is an internal codename that shouldn't leak
          into the founder's URL bar. /founder/solene-chat redirects. */}
      <Route path="/founder/chat">
        {() => <FounderProtectedRoute component={FounderSoleneChatPage} />}
      </Route>
      <Route path="/founder/solene-chat">
        {() => <Redirect to="/founder/chat" />}
      </Route>
      <Route path="/founder/team">
        {() => <FounderProtectedRoute component={FounderTeamPage} />}
      </Route>
      <Route path="/founder/money">
        {() => <FounderProtectedRoute component={FounderMoneyPage} />}
      </Route>
      <Route path="/founder/build">
        {() => <FounderProtectedRoute component={FounderBuildPage} />}
      </Route>
      {/* Bridge — a deep chat + telemetry TOOL, NOT the founder home. */}
      <Route path="/founder/bridge">
        {() => <FounderProtectedRoute component={FounderBridgePage} />}
      </Route>
      {/* /founder/steering — the weekly/monthly surface (the cockpit component). */}
      <Route path="/founder/steering">
        {() => <FounderProtectedRoute component={FounderCockpitPage} />}
      </Route>
      <Route path="/founder/ai-observatory">
        {() => <FounderProtectedRoute component={FounderAiObservatory} />}
      </Route>
      <Route path="/founder/financials">
        {() => <Redirect to="/founder/admin/costs" />}
      </Route>
      <Route path="/founder/compliance-ops">
        {() => <FounderProtectedRoute component={FounderComplianceOpsPage} />}
      </Route>
      <Route path="/founder/appeals">
        {() => <FounderProtectedRoute component={FounderAppealsPage} />}
      </Route>
      <Route path="/founder/recourse">
        {() => <FounderProtectedRoute component={FounderRecoursePage} />}
      </Route>
      <Route path="/founder/market-reports">
        {() => <FounderProtectedRoute component={FounderMarketReportsPage} />}
      </Route>
      {/* Legacy binary-flag page consolidated to /founder/features. */}
      <Route path="/founder/feature-flags">
        {() => <Redirect to="/founder/features" />}
      </Route>
      <Route path="/founder/features">
        {() => <FounderProtectedRoute component={FounderFeatures} />}
      </Route>
      <Route path="/founder/keys">
        {() => <FounderProtectedRoute component={FounderKeysPage} />}
      </Route>
      <Route path="/founder/readiness">
        {() => <FounderProtectedRoute component={FounderReadinessPage} />}
      </Route>
      <Route path="/founder/legal-readiness">
        {() => <FounderProtectedRoute component={FounderLegalReadinessPage} />}
      </Route>
      <Route path="/founder/customers/health">
        {() => <FounderProtectedRoute component={FounderCustomersHealthPage} />}
      </Route>
      <Route path="/founder/growth/campaigns">
        {() => <FounderProtectedRoute component={FounderGrowthCampaignsPage} />}
      </Route>
      <Route path="/founder/telemetry">
        {() => <FounderProtectedRoute component={FounderTelemetryPage} />}
      </Route>
      {/* Command cockpit — "is the company green right now?" */}
      <Route path="/founder/command">
        {() => <FounderProtectedRoute component={FounderCommandPage} />}
      </Route>
      <Route path="/founder/pax-traces">
        {() => <FounderProtectedRoute component={FounderPaxTracesPage} />}
      </Route>
      <Route path="/founder/pax-calibration">
        {() => <FounderProtectedRoute component={FounderPaxCalibrationPage} />}
      </Route>
      {/* Wave 3 Workstream E (distribution telemetry) — acquisition truth */}
      <Route path="/founder/customers">
        {() => <FounderProtectedRoute component={FounderCustomersPage} />}
      </Route>
      <Route path="/founder/integrations">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      {/* Costs & economics — unified hub (Phase 2 consolidation). */}
      <Route path="/founder/admin/costs">
        {() => <FounderProtectedRoute component={FounderAdminCostsPage} />}
      </Route>
      {/* Founder Life-Cockpit — personal taxes, income, deadlines, encrypted vault. */}
      <Route path="/founder/life-cockpit">
        {() => <FounderProtectedRoute component={FounderLifeCockpitPage} />}
      </Route>
      <Route path="/founder/dsar">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/legal-holds">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/sub-processors">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/recovery-console">
        {() => <FounderProtectedRoute component={FounderRecoveryConsolePage} />}
      </Route>
      <Route path="/founder/activation">
        {() => <Redirect to="/founder/onboarding" />}
      </Route>
      <Route path="/founder/ml-snapshots">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/etl">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/prompt-versions">
        {() => <Redirect to="/founder/prompt-evolutions" />}
      </Route>
      <Route path="/founder/title-partners">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/feedback">
        {() => <FounderProtectedRoute component={FounderFeedbackInboxPage} />}
      </Route>
      <Route path="/founder/agent-queue">
        {() => <FounderProtectedRoute component={FounderAgentQueuePage} />}
      </Route>
      <Route path="/founder/dispatches">
        {() => <FounderProtectedRoute component={FounderDispatchesPage} />}
      </Route>
      <Route path="/founder/onboarding-funnel">
        {() => <FounderProtectedRoute component={FounderOnboardingFunnelPage} />}
      </Route>
      {/* 2026-07-27 four-door merge — the standalone Agent-asks queue duplicated
          the Decisions door. The query string is preserved (wouter's Redirect
          drops it otherwise), but `id` is TRANSLATED to `ask`: on this legacy
          route `?id=` always meant an ask id, while on the Decisions door
          `?id=` addresses the decision LOG — a different key space. See
          route-redirects.ts. */}
      <Route path="/founder/asks">
        {() => <Redirect to={`/founder/decisions${legacyAskSearch(window.location.search)}`} />}
      </Route>
      <Route path="/founder/feed">
        {() => <FounderProtectedRoute component={FounderFeedPage} />}
      </Route>
      <Route path="/admin/safety-gates">
        {() => <FounderProtectedRoute component={SafetyGatesPage} />}
      </Route>
      <Route path="/founder/beta-analytics">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/agents">
        {() => <Redirect to="/founder/agent-queue" />}
      </Route>
      <Route path="/founder/daily-digest">
        {() => <Redirect to="/founder" />}
      </Route>
      <Route path="/founder/decisions">
        {() => <FounderProtectedRoute component={FounderDecisionsPage} />}
      </Route>
      <Route path="/founder/letter">
        {() => <FounderProtectedRoute component={FounderLetterPage} />}
      </Route>
      <Route path="/founder/settings">
        {() => <FounderProtectedRoute component={FounderSettingsPage} />}
      </Route>
      <Route path="/founder/preview">
        {() => <FounderProtectedRoute component={FounderPreviewPage} />}
      </Route>
      <Route path="/founder/tools">
        {() => <FounderProtectedRoute component={FounderToolsPage} />}
      </Route>
      <Route path="/founder/prompt-evolutions">
        {() => <FounderProtectedRoute component={FounderPromptEvolutionsPage} />}
      </Route>
      <Route path="/founder/prompt-history">
        {() => <FounderProtectedRoute component={FounderPromptHistoryPage} />}
      </Route>
      <Route path="/founder/traces">
        {() => <FounderProtectedRoute component={FounderTracesPage} />}
      </Route>
      <Route path="/founder/strategy">
        {() => <FounderProtectedRoute component={FounderStrategyPage} />}
      </Route>
      <Route path="/founder/trends">
        {() => <FounderProtectedRoute component={FounderTrendsPage} />}
      </Route>
      <Route path="/founder/onboarding">
        {() => <FounderProtectedRoute component={FounderOnboardingPage} />}
      </Route>
      <Route path="/founder/expansion">
        {() => <FounderProtectedRoute component={FounderExpansionPage} />}
      </Route>
      <Route path="/founder/experiments">
        {() => <FounderProtectedRoute component={FounderExperimentsPage} />}
      </Route>
      {/* /founder/todo — legacy "what needs you" feed, folded into the Today door. */}
      <Route path="/founder/todo">
        {() => <Redirect to="/founder/today" />}
      </Route>
      <Route path="/executive-dashboard">
        {() => <FounderProtectedRoute component={ExecutiveDashboardPage} />}
      </Route>
      <Route path="/dunning">
        {/* The dunning API is founder-only (requireFounder on the whole
            router, P1-5) — a customer reaching this page saw every panel
            404 (2026-07-11 sweep). Gate the page like its API. */}
        {() => <FounderProtectedRoute component={DunningManagerPage} />}
      </Route>
      <Route path="/founder/v13">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/agents/:codename">
        {() => <FounderProtectedRoute component={AgentDetailPage} />}
      </Route>
      <Route path="/reseller">
        {() => <FounderProtectedRoute component={ResellerDashboardPage} />}
      </Route>
      {/* Sovereign Protocol — Census W3-1 retire/refit split (2026-06-11). */}
      <Route path="/founder/governance">
        {() => <FounderProtectedRoute component={FounderGovernancePage} />}
      </Route>
      <Route path="/founder/event-log">
        {() => <FounderProtectedRoute component={FounderEventLogPage} />}
      </Route>
      <Route path="/founder/scenarios">
        {() => <FounderProtectedRoute component={FounderScenariosPage} />}
      </Route>
      <Route path="/agent-performance">
        {() => <FounderProtectedRoute component={AgentPerformancePage} />}
      </Route>
      <Route path="/job-health">
        {() => <FounderProtectedRoute component={JobHealthPage} />}
      </Route>

      {/* Anything else: a path the CUSTOMER build owns (a customer link inside
          founder UI) becomes a full page load inside NotFound
          (pages/not-found.tsx); an unknown founder path is the 404. */}
      <Route component={NotFound} />
    </Switch>
  );
}
