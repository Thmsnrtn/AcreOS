import React, { Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useWhiteLabel } from "@/hooks/use-white-label";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { useNewFounderUI } from "@/lib/featureFlags";
import { Loader2 } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { setSentryUser } from "@/lib/sentry";
import { identifyUser, trackCanonicalEvent, trackEvent } from "@/lib/analytics";
import { flushPendingUtm, hasSignupIntent } from "@/lib/acquisition-utm";
import { ThemeProvider } from "@/contexts/theme-context";
import { TenantThemeProvider } from "@/contexts/tenant-theme-context";
import { FeatureFlagsProvider } from "@/contexts/feature-flags-context";
import { AccessibilityProvider } from "@/contexts/accessibility-context";
import { PaxRailProvider } from "@/contexts/pax-rail-context";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { pageTransition } from "@/lib/animations";
import { variantPageFadeMobile } from "@/lib/motion-tokens";
import { useToast } from "@/hooks/use-toast";

import { SidebarProvider } from "@/components/layout-sidebar";
import { HintsProvider } from "@/components/feature-hints";
import { KeyboardShortcutsProvider } from "@/hooks/use-keyboard-shortcuts";
// Heavy components that mount on every authenticated page but the user
// rarely interacts with on first paint (NpsDialog appears intermittently;
// modals open on click; rails open on click). Lazy-loading reclaims
// ~5,000 LOC from the entry chunk per the 2026-05-01 perf audit.
const KeyboardShortcutsModal = React.lazy(() => import("@/components/keyboard-shortcuts").then(m => ({ default: m.KeyboardShortcutsModal })));
const NewItemMenu = React.lazy(() => import("@/components/new-item-menu").then(m => ({ default: m.NewItemMenu })));
// Onboarding consolidation (Lens 5, 2026-05-27): the dialog-based
// `OnboardingWizard` is no longer mounted. `/onboarding-v2` is the
// canonical first-run surface — TodayPage is gated behind
// `OnboardingGate` (defined below), which redirects orgs with
// `onboardingCompleted !== true` to `/onboarding-v2`. The dialog
// component file remains on disk pending eventual deletion.
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { ErrorBoundary } from "@/components/error-boundary";
import { OfflineIndicator } from "@/components/offline-indicator";
import { DealModalsHost } from "@/components/modals";
import { FloatingActionButton } from "@/components/floating-action-button";
import { EarlyAccessBanner } from "@/components/early-access-banner";
const CommandPalette = React.lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
// IA consolidation (Lens 4 Fix 3): the founder-only ⌘⇧K palette was
// folded into the main ⌘K palette as a `:founder` scope chip + merged
// inspector/intel/persona-toggle groups. The standalone
// founder-command-palette.tsx file was deleted in the same change.
import { useSwipeNavigation } from "@/hooks/use-swipe-gesture";
import { usePWA } from "@/hooks/use-pwa";
import { usePersonaMode, isTypingTarget } from "@/hooks/use-persona-mode";
import { useNextRoutePrefetch } from "@/hooks/use-next-route-prefetch";
import { MobileBottomNav, FounderMobileBottomNav } from "@/components/mobile";
import { useIsMobile } from "@/hooks/use-mobile";
// Phase D — Atlas Dock follows Tom across every founder surface. Lazy
// so non-founder users never download the chat bundle.
const AtlasDock = React.lazy(() => import("@/components/founder-chat/Dock").then(m => ({ default: m.Dock })));
import { usePageContext } from "@/hooks/use-page-context";
import { BetaActivationDetector } from "@/components/beta-activation-detector";
const PaxCopilotRail = React.lazy(() => import("@/components/pax-copilot-rail").then(m => ({ default: m.PaxCopilotRail })));
import { DynamicIsland } from "@/components/dynamic-island";
import { DynamicIslandProvider } from "@/contexts/dynamic-island-context";
import { useCursorGlass } from "@/hooks/use-cursor-glass";
import { TrialBanner } from "@/components/trial-banner";
import { NotificationStack } from "@/components/notification-stack";
import { NotificationBanner } from "@/components/notification-banner";
const NpsDialog = React.lazy(() => import("@/components/nps-dialog").then(m => ({ default: m.NpsDialog })));

// Authed users hit /today and never see LandingPage; landing visitors never
// hit AuthPage. Lazy-loading both keeps each side's first paint lean — the
// other tree only ships when actually navigated to. NotFound stays eager
// (tiny, useful as the universal Suspense-free fallback).
const AuthPage = React.lazy(() => import("@/pages/auth-page"));
const LandingPage = React.lazy(() => import("@/pages/landing"));
import NotFound from "@/pages/not-found";

// ─── Lazy-loaded page bundles ───────────────────────────────────────────────
// Core (primary nav)
const TodayPage = React.lazy(() => import("@/pages/today"));
const PipelinePage = React.lazy(() => import("@/pages/pipeline"));
const MoneyPage = React.lazy(() => import("@/pages/money"));
const PaxPage = React.lazy(() => import("@/pages/pax"));
// AtlasPage archived 2026-06-01 — was "Atlas is coming soon" placeholder; no route wired.
// Dashboard archived 2026-06-01 — route is a Redirect to /today; lazy import was dead code.
const LeadsPage = React.lazy(() => import("@/pages/leads"));
const LeadDetailPage = React.lazy(() => import("@/pages/lead-detail"));
const PropertiesPage = React.lazy(() => import("@/pages/properties"));
const DealsPage = React.lazy(() => import("@/pages/deals"));
const DealDetailPage = React.lazy(() => import("@/pages/deal-detail"));
const FinancePage = React.lazy(() => import("@/pages/finance"));
const PortfolioPage = React.lazy(() => import("@/pages/portfolio"));
// Note Investor vertical (Phase 5 §5) — acquired-notes list + detail + tax + pipeline.
const NotesPage = React.lazy(() => import("@/pages/notes"));
const NoteDetailPage = React.lazy(() => import("@/pages/note-detail"));
const NotesTaxReadinessPage = React.lazy(() => import("@/pages/notes-tax-readiness"));
const NotesPipelinePage = React.lazy(() => import("@/pages/notes-pipeline"));
const NoteAcquisitionDetailPage = React.lazy(() => import("@/pages/note-acquisition-detail"));
// Tax-Delinquent vertical TD-2 — redemption clock.
const RedemptionClockPage = React.lazy(() => import("@/pages/redemption-clock"));
// Tax-Delinquent vertical TD-3 — state rules database.
const StateRulesPage = React.lazy(() => import("@/pages/state-rules"));
// Tax-Delinquent vertical TD-4 — auction worksheet + bid log.
const AuctionWorksheetPage = React.lazy(() => import("@/pages/auction-worksheet"));
// Tax-Delinquent vertical TD-5 — county hub detail page.
const CountyDetailPage = React.lazy(() => import("@/pages/county-detail"));
// Tax-Delinquent vertical TD-6 — quiet-title workflow.
const QuietTitlePage = React.lazy(() => import("@/pages/quiet-title"));
// Wholesaler vertical W-1 — assignment-legality state rules.
const WholesalerStateRulesPage = React.lazy(() => import("@/pages/wholesaler-state-rules"));
// Wholesaler vertical W-2 — EMD inspection-period timer.
const EarnestMoneyPage = React.lazy(() => import("@/pages/earnest-money"));
// Wholesaler vertical W-3 — double-close primitive.
const DoubleClosePage = React.lazy(() => import("@/pages/double-close"));
// Wholesaler vertical W-4 — push-to-buyer-list one-click blast.
const BuyerBlastsPage = React.lazy(() => import("@/pages/buyer-blasts"));
// Wholesaler vertical W-6 — buyer match analytics + freshness.
const BuyerAnalyticsPage = React.lazy(() => import("@/pages/buyer-analytics"));
const CampaignsPage = React.lazy(() => import("@/pages/campaigns"));
const InboxPage = React.lazy(() => import("@/pages/inbox"));
const SettingsPage = React.lazy(() => import("@/pages/settings"));
const DataSourcesPage = React.lazy(() => import("@/pages/data-sources"));
const TasksPage = React.lazy(() => import("@/pages/tasks"));
const AnalyticsPage = React.lazy(() => import("@/pages/analytics"));
const HelpPage = React.lazy(() => import("@/pages/help"));
// Lens 25 #3 — public KB browse surface. Wired into /help as a tab
// (#kb fragment) and as a dedicated /help/article/:slug detail route
// so the Errors.* docsSlug deep links resolve cleanly.
const KnowledgeBasePage = React.lazy(() => import("@/pages/help/kb"));
const KnowledgeBaseArticlePage = React.lazy(() => import("@/pages/help/kb-article"));
// /support stub deleted 2026-05-11 — was a 15-line redirect-to-/help#support
// component. App.tsx now handles the redirect directly (see /support route).

// CRM / Pipeline
const OffersPage = React.lazy(() => import("@/pages/offers"));
const ListingsPage = React.lazy(() => import("@/pages/listings"));
const DocumentsPage = React.lazy(() => import("@/pages/documents"));
const CountiesPage = React.lazy(() => import("@/pages/counties"));
// SequencesPage archived 2026-06-01 — DEPRECATED; route is a Redirect to /campaigns?channel=sequences.
// AbTestsPage archived 2026-06-01 — was a redirect stub; route is a Redirect to /campaigns#ab-tests.
const ActivityPage = React.lazy(() => import("@/pages/activity"));
const MarketplacePage = React.lazy(() => import("@/pages/marketplace"));

// Finance / Portfolio
const CashFlowPage = React.lazy(() => import("@/pages/cash-flow"));
const ForecastingPage = React.lazy(() => import("@/pages/forecasting"));
const CapitalMarketsPage = React.lazy(() => import("@/pages/capital-markets"));
const PortfolioOptimizerPage = React.lazy(() => import("@/pages/portfolio-optimizer"));
const PortfolioHealthPage = React.lazy(() => import("@/pages/portfolio-health"));
const PortfolioPnLPage = React.lazy(() => import("@/pages/portfolio-pnl"));
const Exchange1031Page = React.lazy(() => import("@/pages/exchange-1031"));
const TaxOptimizerPage = React.lazy(() => import("@/pages/tax-optimizer"));
const TaxDelinquentPage = React.lazy(() => import("@/pages/tax-delinquent"));
const BookkeepingPage = React.lazy(() => import("@/pages/bookkeeping"));
const DepreciationCalculatorPage = React.lazy(() => import("@/pages/depreciation-calculator"));
const ClosingCostsPage = React.lazy(() => import("@/pages/closing-costs"));
const PropertyTaxPage = React.lazy(() => import("@/pages/property-tax"));
const FeeDashboardPage = React.lazy(() => import("@/pages/fee-dashboard"));

// AI / Intelligence
const AVMPage = React.lazy(() => import("@/pages/avm"));
const AvmBulkPage = React.lazy(() => import("@/pages/avm-bulk"));
// AcquisitionRadarPage archived 2026-06-01 — route is Redirect to /deals/discover.
const NegotiationCopilotPage = React.lazy(() => import("@/pages/negotiation-copilot"));
// DealHunterPage archived 2026-06-01 — route is Redirect to /deals/discover.
// AgentCommandCenterPage archived 2026-06-01 — route is Redirect to /ai#agents.
const VisionAIPage = React.lazy(() => import("@/pages/vision-ai"));
const LandCreditPage = React.lazy(() => import("@/pages/land-credit"));
const MarketIntelligencePage = React.lazy(() => import("@/pages/market-intelligence"));
const MarketWatchlistPage = React.lazy(() => import("@/pages/market-watchlist"));
const PriceOptimizerPage = React.lazy(() => import("@/pages/price-optimizer"));
const SellerIntentPage = React.lazy(() => import("@/pages/seller-intent"));
// DealPatternsPage archived 2026-06-01 — route is Redirect to /deals/discover.
// DealFeedPage archived 2026-06-01 — route is Redirect to /deals/discover.
// MarketDataPage archived 2026-06-01 — no nav entry, no callers.
const DocumentIntelligencePage = React.lazy(() => import("@/pages/document-intelligence"));
// VoiceAnalyticsPage removed — AI Voice feature deprecated
// MarketplaceAnalyticsPage archived 2026-06-01 — @ts-nocheck, no nav entry.

// Operations
const MapsPage = React.lazy(() => import("@/pages/maps"));
const CommandCenterPage = React.lazy(() => import("@/pages/command-center"));
const ConsciousOrganizationPage = React.lazy(() => import("@/pages/conscious-organization"));
const AnticipatoryEnterprisePage = React.lazy(() => import("@/pages/anticipatory-enterprise"));
// /real-runtime removed (Lens 4 Fix 4): customer-facing surface that
// exposed runtime internals and had no nav link or referrers.
const AutomationPage = React.lazy(() => import("@/pages/automation"));
const WorkflowsPage = React.lazy(() => import("@/pages/workflows"));
const ToolsPage = React.lazy(() => import("@/pages/tools"));
// Public /tools/calculator + /tools/calculator/embed surfaces. No auth,
// no PageShell, no NAV_MODULES entry — these are top-of-funnel marketing
// pages that any visitor can hit (and that other land-investing sites
// can iframe in). See server/middleware/security.ts for the
// X-Frame-Options override that scopes iframe-ability to the embed
// route only.
const CalculatorPage = React.lazy(() => import("@/pages/tools/calculator"));
const CalculatorEmbedPage = React.lazy(() => import("@/pages/tools/calculator-embed"));
// Public /tools/parcel-check — no auth. Renders the free open-data moat
// (FEMA/USDA/USGS/USFWS/Census) for any address so a stranger sees the
// free-tier promise work before signing up.
const ParcelCheckPage = React.lazy(() => import("@/pages/tools/parcel-check"));
const SkipTracingPage = React.lazy(() => import("@/pages/skip-tracing"));
// TerritoryManagerPage archived 2026-06-01 — no nav entry, no callers.
const ZoningLookupPage = React.lazy(() => import("@/pages/zoning-lookup"));
const TitleSearchPage = React.lazy(() => import("@/pages/title-search"));
const PropertyEnrichmentPage = React.lazy(() => import("@/pages/property-enrichment"));
// DirectMailCampaignsPage archived 2026-06-01 — route is Redirect to /campaigns?channel=direct-mail.
// Pillar 3 — customer-facing /outreach/mail (Compose + In-Flight tabs).
const OutreachMailPage = React.lazy(() => import("@/pages/outreach/mail"));
// DripSequencesPage archived 2026-06-01 — consolidated into /campaigns; route redirects there.
const ListingSyndicationPage = React.lazy(() => import("@/pages/listing-syndication"));
const SyndicationPage = React.lazy(() => import("@/pages/syndication"));
// DocumentVersionsPage archived 2026-06-01 — no nav entry.
// VaDashboardPage archived 2026-06-01 — no nav entry, no callers.

// Team
// TeamDashboardPage archived 2026-06-01 — no sidebar entry, no callers.
const TeamInboxPage = React.lazy(() => import("@/pages/team-inbox"));
const CommissionsPage = React.lazy(() => import("@/pages/commissions"));
// TeamLeaderboardPage archived 2026-06-01 — no sidebar entry, no callers.
// Phase 5 §5 — team-readiness pages.
const TeamManagerDashboardPage = React.lazy(() => import("@/pages/team-manager-dashboard"));
const TeamOfferApprovalsPage = React.lazy(() => import("@/pages/team-offer-approvals"));
const LeadAssignmentSettingsPage = React.lazy(() => import("@/pages/settings/lead-assignment"));
const UnderwritingSettingsPage = React.lazy(() => import("@/pages/settings/underwriting"));
const IntegrationsSettingsPage = React.lazy(() => import("@/pages/settings/integrations"));

// Analytics / Reporting
// KPIDashboardPage archived 2026-06-01 — no nav entry, no callers.
// CohortAnalysisPage archived 2026-06-01 — no sidebar, founder-gated but no nav link.
// AuditLogPage archived 2026-06-01 — audit log is a tab in compliance-settings, standalone page had no callers.
const DataExportPage = React.lazy(() => import("@/pages/data-export"));
const DataImportPage = React.lazy(() => import("@/pages/data-import"));
// ModelTrainingPage archived 2026-06-01 — no nav entry, no callers.

// Settings / Compliance
// EmailSettingsPage deleted 2026-06-01 — was a redirect stub to /settings#communications.
// MailSettingsPage deleted 2026-06-01 — was a redirect stub to /settings#communications.
const PrivacySettingsPage = React.lazy(() => import("@/pages/privacy-settings"));
const TaxIdentitySettingsPage = React.lazy(() => import("@/pages/settings/tax-identity"));
const AccessibilitySettingsPage = React.lazy(() => import("@/pages/settings/accessibility"));
const PaxControlsPage = React.lazy(() => import("@/pages/settings/pax-controls"));
const WebhooksPage = React.lazy(() => import("@/pages/webhooks"));
const CompliancePage = React.lazy(() => import("@/pages/compliance"));
const DoddFrankCheckerPage = React.lazy(() => import("@/pages/dodd-frank-checker"));
// StateDocumentsPage archived 2026-06-01 — no nav entry, no callers.
const RegulatoryIntelPage = React.lazy(() => import("@/pages/regulatory-intel"));
// UsageQuotaPage archived 2026-06-01 — no nav entry, no callers.
const GoalsPage = React.lazy(() => import("@/pages/goals"));
const TaxResearcherPage = React.lazy(() => import("@/pages/tax-researcher"));

// Platform / Marketplace
// AcademyPage removed — Academy feature deprecated
const InvestorDirectoryPage = React.lazy(() => import("@/pages/investor-directory"));
// BuyerQualificationPage archived 2026-06-01 — no nav entry.
// MatchingEnginePage archived 2026-06-01 — no nav entry.

// Admin / Founder
// AdminSupportPage archived 2026-06-01 — no nav entry, no callers.
// IA consolidation (Lens 4): the legacy FounderDashboard and FounderHomePage
// page bundles are no longer mounted — every prior founder-home route
// redirects to /founder/bridge. Both files deleted 2026-06-01.
const FounderAiObservatory = React.lazy(() => import("@/pages/founder-ai-observatory"));
// FounderFeatureFlags archived 2026-06-01 — route redirects to /founder/features; lazy import was dead code.
const FounderFeatures = React.lazy(() => import("@/pages/founder/features"));
const FounderKeysPage = React.lazy(() => import("@/pages/founder/keys"));
const FounderReadinessPage = React.lazy(() => import("@/pages/founder/readiness"));
// Beatrice/Lena — Launch Legal & Peace-of-Mind Readiness checklist surface.
// Renders docs/legal/launch-readiness-checklist.md status at a glance.
const FounderLegalReadinessPage = React.lazy(() => import("@/pages/founder/legal-readiness"));
const FounderCustomersHealthPage = React.lazy(() => import("@/pages/founder/customers/health"));
const FounderGrowthCampaignsPage = React.lazy(() => import("@/pages/founder/growth/campaigns"));
const FounderTelemetryPage = React.lazy(() => import("@/pages/founder/telemetry"));
// FounderIntegrationsPage archived 2026-06-01 — no sidebar entry.
const FounderCostPage = React.lazy(() => import("@/pages/founder/cost"));
const FounderLifeCockpitPage = React.lazy(() => import("@/pages/founder/life-cockpit"));
const FounderAiCostsPage = React.lazy(() => import("@/pages/founder/ai-costs"));
const FounderObservabilityCostPage = React.lazy(() => import("@/pages/founder/observability-cost"));
const FounderCostOptimizerPage = React.lazy(() => import("@/pages/founder/cost-optimizer"));
const FounderUnitEconomicsPage = React.lazy(() => import("@/pages/founder/unit-economics"));
// FounderDsarPage archived 2026-06-01 — no sidebar entry.
// FounderLegalHoldsPage archived 2026-06-01 — no sidebar entry.
// FounderSubProcessorsPage archived 2026-06-01 — no sidebar entry.
const FounderRecoveryConsolePage = React.lazy(() => import("@/pages/founder/recovery-console"));
// FounderActivationPage archived 2026-06-01 — no sidebar entry.
// FounderMlSnapshotsPage archived 2026-06-01 — no sidebar entry.
// FounderEtlPage archived 2026-06-01 — no sidebar entry.
// FounderPromptVersionsPage archived 2026-06-01 — no sidebar entry.
// FounderTitlePartnersPage archived 2026-06-01 — no sidebar entry.
const FounderFeedbackInboxPage = React.lazy(() => import("@/pages/founder/feedback-inbox"));
const FounderAgentQueuePage = React.lazy(() => import("@/pages/founder/agent-queue"));
const FounderDispatchesPage = React.lazy(() => import("@/pages/founder/dispatches"));
// L6.32 founder-collab UI — surface for /api/founder/asks (commit 05a2e122).
const FounderAsksPage = React.lazy(() => import("@/pages/founder/asks"));
// D2 signup-to-first-value funnel UI — surface for /api/founder/onboarding-funnel.
const FounderOnboardingFunnelPage = React.lazy(() => import("@/pages/founder/onboarding-funnel"));
const FounderFeedPage = React.lazy(() => import("@/pages/founder/feed"));
const FounderPaxTracesPage = React.lazy(() => import("@/pages/founder/pax-traces"));
const FounderPaxCalibrationPage = React.lazy(() => import("@/pages/founder/pax-calibration"));
// Wave 3 Workstream E — distribution truth surface. Paid / trial /
// churned counts + UTM sources + recent signups by name.
const FounderCustomersPage = React.lazy(() => import("@/pages/founder/customers"));
// Solene's daily one-line + Autonomy Horizon + capital + phase — the
// pull-first CEO surface at /founder. Replaces the FounderChat shell
// which was previously served at /founder (now remains at /founder/chat).
const FounderPulsePage = React.lazy(() => import("@/pages/founder/index"));
// Phase 4 of the Solene migration — new 5-door founder UI. /founder/today
// becomes the default landing page when `useNewFounderUI` localStorage flag
// is true (see client/src/lib/featureFlags.ts).
const FounderTodayPage = React.lazy(() => import("@/pages/founder/today"));
// Phase 5 — the remaining three doors (team / money / build). The customers
// door reuses FounderCustomersPage (rewritten in Phase 5).
const FounderTeamPage = React.lazy(() => import("@/pages/founder/team"));
const FounderMoneyPage = React.lazy(() => import("@/pages/founder/money"));
const FounderBuildPage = React.lazy(() => import("@/pages/founder/build"));
// FounderNowPage removed (Lens 4) — /founder/now now redirects to
// /founder/bridge. The page file lives on disk pending extraction sweep.
// /founder is the Atlas chat shell; /founder/bridge is the fused
// canonical home (chat + telemetry).
const FounderChatPage = React.lazy(() => import("@/pages/founder/chat"));
// Phase 3 — iOS-Claude-UX chat surface that consumes the Phase 2 backend
// at /api/founder/solene-chat/*. This is the face Tom interacts with when
// he flips the in-app Solene flag on.
const FounderSoleneChatPage = React.lazy(() => import("@/pages/founder/solene-chat"));
const FounderBridgePage = React.lazy(() => import("@/pages/founder/bridge"));
// FounderLegacyDashboard removed (Lens 4) — /founder/dashboard now
// redirects to /founder/bridge. LegacyNowSurface lives on disk for
// reference but is no longer route-mounted.
const FounderCockpitPage = React.lazy(() => import("@/pages/founder/cockpit"));
const FounderCmoPage = React.lazy(() => import("@/pages/founder/cmo"));
const FounderStudioPage = React.lazy(() => import("@/pages/founder/studio"));
const FounderInspectorRouter = React.lazy(() => import("@/pages/founder/inspector"));
const FounderTrustGraduationPage = React.lazy(() => import("@/pages/founder/trust-graduation"));
// PropertiesComparePage archived 2026-06-01 — no callers.
// DealUnderwritingPage archived 2026-06-01 — route is Redirect to /deals/discover.
// TeamKPIPage archived 2026-06-01 — no nav entry, no callers.
const SovereignV13Page = React.lazy(() => import("@/pages/sovereign-v13"));
const AgentDetailPage = React.lazy(() => import("@/pages/agent-detail"));
const SafetyGatesPage = React.lazy(() => import("@/pages/safety-gates"));
const DecisionQueuePage = React.lazy(() => import("@/pages/decision-queue"));
// OpsDashboardPage archived 2026-06-01 — no nav entry.
// BetaIntakePage archived 2026-06-01 — no nav entry; /admin/beta-intake redirects to /admin/beta.
// BetaAnalyticsPage archived 2026-06-01 — no nav entry.
// QueueMonitorPage archived 2026-06-01 — no nav entry.
// IntegrationsHealthPage archived 2026-06-01 — no nav entry.
// ProactiveMonitorPage archived 2026-06-01 — no nav entry.
// BetaDashboardPage archived 2026-06-01 — no nav entry.
const ResellerDashboardPage = React.lazy(() => import("@/pages/reseller-dashboard"));
// DataMoatDashboardPage archived 2026-06-01 — no nav entry (sidebar shows "/data-moat" which routes to it, but page is a founder deep-tool with no unique value vs other telemetry pages).
const ExecutiveDashboardPage = React.lazy(() => import("@/pages/executive-dashboard"));

// Sovereign Protocol — Phase A Visibility Layer
const SovereignDashboardPage = React.lazy(() => import("@/pages/sovereign-dashboard"));
const BoardOfDirectorsPage = React.lazy(() => import("@/pages/board-of-directors"));
const AgentPerformancePage = React.lazy(() => import("@/pages/agent-performance"));
const MemoryBrowserPage = React.lazy(() => import("@/pages/memory-browser"));
const EventLogPage = React.lazy(() => import("@/pages/event-log"));
const JobHealthPage = React.lazy(() => import("@/pages/job-health"));
const AgentCollaborationPage = React.lazy(() => import("@/pages/agent-collaboration"));

// Misc public
const BorrowerPortal = React.lazy(() => import("@/pages/borrower-portal"));
const TermsOfService = React.lazy(() => import("@/pages/terms"));
const PrivacyPolicy = React.lazy(() => import("@/pages/privacy"));
const PublicSubProcessorsPage = React.lazy(() => import("@/pages/sub-processors"));
const DealRoomSharePage = React.lazy(() => import("@/pages/deal-room-share"));
const FieldNotesArchivePage = React.lazy(() => import("@/pages/field-notes-archive"));
const FieldNoteDetailPage = React.lazy(() => import("@/pages/field-note-detail"));
const PricingPage = React.lazy(() => import("@/pages/pricing"));
const WhyPage = React.lazy(() => import("@/pages/why"));
// Public comparison landers — capture "[competitor] alternative" search
// intent. Lazy-loaded so they don't weigh on the landing-page first paint.
const AcreosVsPropstreamPage = React.lazy(() => import("@/pages/compare/acreos-vs-propstream"));
const AcreosVsDealmachinePage = React.lazy(() => import("@/pages/compare/acreos-vs-dealmachine"));
// /learn/<vertical>/<state> — programmatic SEO surface for state×vertical
// long-tail queries. Public, lazy-loaded so it doesn't weigh on first paint.
const StateVerticalLearnPage = React.lazy(() => import("@/pages/learn/state-vertical"));
// /learn/county/<state>/<county> — data-first programmatic SEO surface for
// county-level long-tail queries. Public, lazy-loaded. Pages are only emitted
// by the county-rollup generator when free-data completeness clears the bar.
const CountyLearnPage = React.lazy(() => import("@/pages/learn/county"));
const ParcelDetailPage = React.lazy(() => import("@/pages/parcel-detail"));
const PermitsPage = React.lazy(() => import("@/pages/permits"));
const LotPricingPage = React.lazy(() => import("@/pages/lot-pricing"));
const CountyTimelinesPage = React.lazy(() => import("@/pages/county-timelines"));
const CcrTemplatesPage = React.lazy(() => import("@/pages/ccr-templates"));
const RehabsPage = React.lazy(() => import("@/pages/rehabs"));
const RehabDetailPage = React.lazy(() => import("@/pages/rehab-detail"));
const ContractorsPage = React.lazy(() => import("@/pages/contractors"));
const Contractor1099NecPage = React.lazy(() => import("@/pages/contractor-1099-nec"));
const TenantsPage = React.lazy(() => import("@/pages/tenants"));
const LeasesPage = React.lazy(() => import("@/pages/leases"));
const RentRollPage = React.lazy(() => import("@/pages/rent-roll"));
const MaintenancePage = React.lazy(() => import("@/pages/maintenance"));
// InvestorAnalyticsPage archived 2026-06-01 — no direct callers.
const InspectionDetailPage = React.lazy(() => import("@/pages/inspection-detail"));
const AccountSecurityPage = React.lazy(() => import("@/pages/account-security"));
// FounderFinancialsPage archived 2026-06-01 — no sidebar entry.
const FcraSubstantiveFormPage = React.lazy(() => import("@/pages/fcra-substantive-form"));
const FounderComplianceOpsPage = React.lazy(() => import("@/pages/founder-compliance-ops"));
// MultiVerticalPnLPage archived 2026-06-01 — no callers.
// FounderAgentsPage archived 2026-06-01 — no sidebar entry.
// FounderDailyDigestPage archived 2026-06-01 — no sidebar entry.
const FounderDecisionsPage = React.lazy(() => import("@/pages/founder-decisions"));
const FounderLetterPage = React.lazy(() => import("@/pages/founder-letter"));
const FounderSettingsPage = React.lazy(() => import("@/pages/founder-settings"));
const FounderPreviewPage = React.lazy(() => import("@/pages/founder-preview"));
const FounderToolsPage = React.lazy(() => import("@/pages/founder-tools"));
const FounderPromptEvolutionsPage = React.lazy(() => import("@/pages/founder-prompt-evolutions"));
const FounderPromptHistoryPage = React.lazy(() => import("@/pages/founder-prompt-history"));
const FounderTracesPage = React.lazy(() => import("@/pages/founder-traces"));
const SignDocumentPage = React.lazy(() => import("@/pages/sign-document"));
const OfferBatchesPage = React.lazy(() => import("@/pages/offer-batches"));
const LeadsDedupePage = React.lazy(() => import("@/pages/leads-dedupe"));
const FounderStrategyPage = React.lazy(() => import("@/pages/founder-strategy"));
const FounderTrendsPage = React.lazy(() => import("@/pages/founder-trends"));
// MyLetterPage archived 2026-06-01 — no callers outside App.tsx.
const FounderOnboardingPage = React.lazy(() => import("@/pages/founder-onboarding"));
const FounderExpansionPage = React.lazy(() => import("@/pages/founder-expansion"));
const FounderExperimentsPage = React.lazy(() => import("@/pages/founder-experiments"));
const FounderProvidersPage = React.lazy(() => import("@/pages/founder-providers"));
const FounderTodoPage = React.lazy(() => import("@/pages/founder-todo"));
const ForgotPasswordPage = React.lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage = React.lazy(() => import("@/pages/reset-password"));
// Onboarding consolidation (2026-05-11): `/onboarding-v2` is the canonical
// page-route surface (recoverable on tab-close) for first-run setup; the
// standalone `/pages/onboarding-wizard.tsx` page was deleted as redundant.
const OnboardingV2Page = React.lazy(() => import("@/pages/onboarding-v2"));
const FieldScoutPage = React.lazy(() => import("@/pages/field-scout"));
// B-1: DriveMode — full-screen mobile curb-capture surface.
const DriveModePage = React.lazy(() => import("@/pages/drivemode"));
// B-2: CourthouseMode — Tax-Delinquent leapfrog mobile surface.
const CourthouseModePage = React.lazy(() => import("@/pages/courthouse-mode"));
const DunningManagerPage = React.lazy(() => import("@/pages/dunning-manager"));
// /freedom-meter removed (Lens 4 Fix 4): 706-line customer-facing
// surface with no nav link, no in-app referrers, no link to /today.
// Stale standalone page — deleted.
const BlindOfferWizardPage = React.lazy(() => import("@/pages/blind-offer-wizard"));
// /night-cap + /evening-review removed (Lens 4 Fix 4): both URLs
// pointed at the same EveningReviewPage and neither was linked from
// any nav surface. Server-side /api/night-cap/snapshot endpoint
// remains for any Today-page consumer.
const StatusPage = React.lazy(() => import("@/pages/status"));
const ChangelogPage = React.lazy(() => import("@/pages/changelog"));
const SecurityPage = React.lazy(() => import("@/pages/security"));
const WelcomeBackPage = React.lazy(() => import("@/pages/welcome-back"));
// GlossaryPage archived 2026-06-01 — public route but nothing links to it.

// ─── Page loading fallback ──────────────────────────────────────────────────
// Shown during route-level auth resolution and React.lazy() chunk loads.
// Intentionally branded (not a bare spinner) — users bouncing off a blank
// page with a tiny loader read the app as "is this still working?" A small
// AcreOS moment with a subtle pulse keeps them oriented.
function PageLoader() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background px-4"
      role="status"
      aria-label="Loading AcreOS"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <div
            className="absolute -inset-1 rounded-xl border-2 border-primary/30 animate-ping"
            aria-hidden="true"
          />
        </div>
        <p className="text-sm text-muted-foreground">Loading AcreOS…</p>
      </div>
    </div>
  );
}

// ─── Route wrappers ─────────────────────────────────────────────────────────
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, authFailCount } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  // Check if session cookie exists — if so, user was recently authenticated
  // and the session might just be refreshing. Show a loader instead of redirecting.
  const hasSessionCookie = typeof document !== "undefined" && document.cookie.includes("__session=");

  if (!user) {
    // If there's a session cookie but auth failed, the JWT might have expired
    // while Clerk tries to refresh. Show a brief loader instead of bouncing to /auth
    if (hasSessionCookie && authFailCount < 3) {
      return <PageLoader />;
    }
    return <Redirect to="/auth" />;
  }

  return <Component />;
}

function FounderProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, isFounder } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (!isFounder) {
    return <NotFound />;
  }

  return <Component />;
}

// Feature-flagged protected route: if the feature is disabled globally, render NotFound
function FlaggedRoute({ route, component: Component }: { route: string; component: React.ComponentType }) {
  const { user, isLoading: authLoading } = useAuth();
  const { isRouteEnabled, isLoading: flagsLoading } = useFeatureFlags();

  if (authLoading || flagsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  if (!isRouteEnabled(route)) return <NotFound />;
  return <Component />;
}

// Persona-gated protected route — JC#7 / VERTICAL-EXPANSION-PLAN.md primitive #3.
// Renders the page only when the signed-in user's persona is in the allow-list;
// other personas get NotFound. Defaults treat unauthenticated users as
// land_investor so server-driven redirects still work.
function PersonaRoute({
  personas,
  component: Component,
}: {
  personas: readonly import("@shared/models/auth").Persona[];
  component: React.ComponentType;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  const persona = (user.persona as import("@shared/models/auth").Persona | undefined) ?? "land_investor";
  if (!personas.includes(persona)) return <NotFound />;
  return <Component />;
}
// Re-export so persona-gated routes can be added incrementally without
// touching this file each time the type signature evolves.
export { PersonaRoute };



function HomeRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <PageLoader />;
  }
  return user ? <Redirect to="/today" /> : <LandingPage />;
}

// Onboarding consolidation (Lens 5, 2026-05-27). Fresh signups land on
// `/today` from the auth page; this gate intercepts them and routes
// to `/onboarding-v2` until the org's `onboardingCompleted` flag flips.
// The fetch is unauthenticated-tolerant (returns null on 401) so the
// gate never strands a user with a render error. Whilst the org
// status is loading we render PageLoader rather than the page itself
// to avoid a flash of `/today` before the redirect resolves.
function OnboardingGate({ children }: { children: React.ReactNode }) {
  // Server is the source of truth — `/api/me/needs-onboarding` returns
  // a single boolean that consolidates founder-bypass + legacy-completion
  // signals + canonical column read. Migration 0098 backfilled
  // organizations.onboarding_completed for every legacy customer, so the
  // server answer is now accurate.
  //
  // History (pre-2026-05-27): an earlier version of this gate read
  // /api/organization directly and OR'd four completion fields client-side
  // because the legacy dialog wizard wrote to three different columns.
  // It ran on every /today render, false-redirected every legacy user
  // (including the founder), and shipped with a ?bypass-onboarding=1
  // escape valve we needed twice on the day it shipped. Replaced with
  // this 5-line version after the migration consolidated the data.
  const { data, isLoading, error } = useQuery<{ needsOnboarding: boolean }>({
    queryKey: ["/api/me/needs-onboarding"],
    staleTime: 60_000,
  });

  if (isLoading) return <PageLoader />;
  // If the endpoint failed (network, 401 during refresh, etc.) fall
  // through to render the page — its own auth guard handles the real
  // redirect. Never force-bounce a user into a wizard from an error path.
  if (error || !data) return <>{children}</>;
  if (data.needsOnboarding) return <Redirect to="/onboarding-v2" />;
  return <>{children}</>;
}

// ─── Router ─────────────────────────────────────────────────────────────────
function Router() {
  const [pathname] = useLocation();
  useNextRoutePrefetch(pathname);
  return (
    <React.Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/legal/privacy" component={PrivacyPolicy} />
      <Route path="/legal/sub-processors" component={PublicSubProcessorsPage} />
      <Route path="/deal-rooms/share/:slug" component={DealRoomSharePage} />
      {/* /field-notes — canonical surface (rebranded from /letters on
          2026-06-06 per marketing-OS voice doctrine). */}
      <Route path="/field-notes" component={FieldNotesArchivePage} />
      <Route path="/field-notes/:slug" component={FieldNoteDetailPage} />
      {/* /letters → /field-notes 301 redirects.
          The authoritative 301 is issued server-side in server/static.ts
          (LEGACY_LETTERS_301) before the SPA shell renders, so search
          engines and direct hits get a real HTTP 301. The wouter
          Redirects below are a client-side defense-in-depth fallback
          for in-app navigations that bypass the server (e.g. stale
          deep links cached by the SPA shell). */}
      <Route path="/letters/:slug">
        {(params) => <Redirect to={`/field-notes/${params.slug}`} />}
      </Route>
      <Route path="/letters">
        {() => <Redirect to="/field-notes" />}
      </Route>

        {/* Competitor comparison pages (public, SEO-targeted) */}

      <Route path="/pricing" component={PricingPage} />
      <Route path="/why" component={WhyPage} />
      <Route path="/compare/acreos-vs-propstream" component={AcreosVsPropstreamPage} />
      <Route path="/compare/acreos-vs-dealmachine" component={AcreosVsDealmachinePage} />
      {/* Programmatic SEO — county data primers. Registered before the
          state×vertical route: the 4-segment path is more specific, and
          first-match order keeps the two from colliding. */}
      <Route path="/learn/county/:state/:county" component={CountyLearnPage} />
      {/* Programmatic SEO — state×vertical primers */}
      <Route path="/learn/:vertical/:state" component={StateVerticalLearnPage} />
      <Route path="/status" component={StatusPage} />
      <Route path="/changelog" component={ChangelogPage} />
      <Route path="/security" component={SecurityPage} />
      {/* Public Land Deal Calculator — top-of-funnel + embed-friendly.
          Embed route mounted BEFORE the bare /tools/calculator so
          wouter's first-match Switch routes the more-specific URL first.
          Both must precede the authed /tools route registered later. */}
      <Route path="/tools/calculator/embed" component={CalculatorEmbedPage} />
      <Route path="/tools/calculator" component={CalculatorPage} />
      {/* Public Parcel Check — free open-data moat surface. Must precede the
          authed /tools route registered later. */}
      <Route path="/tools/parcel-check" component={ParcelCheckPage} />
      {/* 2026-06-01 cut — GlossaryPage archived; nothing links to it. */}

      {/* Public Borrower Portal */}
      <Route path="/portal" component={BorrowerPortal} />

      {/* Public signing — external signers (sellers, borrowers) arrive via
          /sign/:docId?s=...&t=... with an HMAC token in the URL. No auth. */}
      <Route path="/sign/:docId" component={SignDocumentPage} />
      <Route path="/portal/:accessToken" component={BorrowerPortal} />
      
      {/* Onboarding V2 wizard */}
      <Route path="/onboarding-v2">
        {() => <ProtectedRoute component={OnboardingV2Page} />}
      </Route>

      {/* Renoir reactivation surface — destination of post-cancel
          win-back deep-links. Auth-required so we can pre-fill plan
          + tenure, but reachable via signed token in the email. */}
      <Route path="/welcome-back">
        {() => <ProtectedRoute component={WelcomeBackPage} />}
      </Route>

      {/* Home: landing page (unauth) or today hub (auth) */}
      <Route path="/" component={HomeRoute} />
      <Route path="/today">
        {() => (
          <ProtectedRoute
            component={() => (
              <OnboardingGate>
                <TodayPage />
              </OnboardingGate>
            )}
          />
        )}
      </Route>
      {/* Legacy alias — see client/src/lib/route-redirects.ts (sunset 2026-07-02). */}
      <Route path="/dashboard">
        {() => <Redirect to="/today" />}
      </Route>
      <Route path="/pipeline">
        {() => <ProtectedRoute component={PipelinePage} />}
      </Route>
      <Route path="/money">
        {() => <ProtectedRoute component={MoneyPage} />}
      </Route>
      <Route path="/ai">
        {() => <ProtectedRoute component={PaxPage} />}
      </Route>
      <Route path="/pax">
        {() => <Redirect to="/ai" />}
      </Route>
      <Route path="/leads">
        {() => <ProtectedRoute component={LeadsPage} />}
      </Route>
      <Route path="/leads/dedupe">
        {() => <ProtectedRoute component={LeadsDedupePage} />}
      </Route>
      {/* P1-28 — shareable URLs for lead detail. Sits AFTER /leads/dedupe
          so wouter doesn't route "dedupe" as the :id param. */}
      <Route path="/leads/:id">
        {() => <ProtectedRoute component={LeadDetailPage} />}
      </Route>
      <Route path="/properties">
        {() => <ProtectedRoute component={PropertiesPage} />}
      </Route>
      {/* Parcel detail v1 — JC #1 / JC #9. Composes existing widgets
          (overview / due diligence / financial / cross-links) into
          one route Land Investors can land on per parcel. */}
      <Route path="/parcels/:id">
        {() => <ProtectedRoute component={ParcelDetailPage} />}
      </Route>
      <Route path="/permits">
        {() => <ProtectedRoute component={PermitsPage} />}
      </Route>
      <Route path="/lot-pricing">
        {() => <ProtectedRoute component={LotPricingPage} />}
      </Route>
      <Route path="/county-timelines">
        {() => <ProtectedRoute component={CountyTimelinesPage} />}
      </Route>
      <Route path="/ccr-templates">
        {() => <ProtectedRoute component={CcrTemplatesPage} />}
      </Route>
      <Route path="/rehabs">
        {() => <ProtectedRoute component={RehabsPage} />}
      </Route>
      <Route path="/rehabs/:id">
        {() => <ProtectedRoute component={RehabDetailPage} />}
      </Route>
      <Route path="/contractors">
        {() => <ProtectedRoute component={ContractorsPage} />}
      </Route>
      <Route path="/contractors/1099-nec">
        {() => <ProtectedRoute component={Contractor1099NecPage} />}
      </Route>
      <Route path="/tenants">
        {() => <ProtectedRoute component={TenantsPage} />}
      </Route>
      <Route path="/leases">
        {() => <ProtectedRoute component={LeasesPage} />}
      </Route>
      <Route path="/rent-roll">
        {() => <ProtectedRoute component={RentRollPage} />}
      </Route>
      <Route path="/maintenance">
        {() => <ProtectedRoute component={MaintenancePage} />}
      </Route>
      <Route path="/investor-analytics">
        {/* 2026-06-01 cut — InvestorAnalyticsPage archived; no direct callers. */}
        {() => <Redirect to="/analytics" />}
      </Route>
      <Route path="/inspections/:id">
        {() => <ProtectedRoute component={InspectionDetailPage} />}
      </Route>
      <Route path="/account/security">
        {() => <ProtectedRoute component={AccountSecurityPage} />}
      </Route>
      <Route path="/account/fcra-attestation/substantive">
        {() => <ProtectedRoute component={FcraSubstantiveFormPage} />}
      </Route>
      <Route path="/money/cross-vertical">
        {/* 2026-06-01 cut — MultiVerticalPnLPage archived; no callers. */}
        {() => <Redirect to="/money" />}
      </Route>
      <Route path="/deals">
        {() => <ProtectedRoute component={DealsPage} />}
      </Route>
      {/* 2026-05-11 audit — unified deal-discovery surface. Replaces the
          previously fragmented /acquisition-radar + /deal-hunter + /deal-feed
          + /deal-patterns + /deal-underwriting cluster. Each of those URLs
          now redirects here; the underlying page bundles remain on disk
          (DEPRECATED comment in each) so we can A/B them later if needed.
          Registered BEFORE /deals/:id so wouter doesn't match "discover" as
          the :id param. */}
      <Route path="/deals/discover">
        {/* 2026-06-01 cut — AcquisitionRadarPage archived; /deals/discover kept as a ProtectedRoute
            to DealsPage until discover tab is extracted as its own page. */}
        {() => <ProtectedRoute component={DealsPage} />}
      </Route>
      {/* P1-28 — shareable URLs for deal detail. */}
      <Route path="/deals/:id">
        {() => <ProtectedRoute component={DealDetailPage} />}
      </Route>
      <Route path="/tasks">
        {() => <ProtectedRoute component={TasksPage} />}
      </Route>
      <Route path="/team-dashboard">
        {/* 2026-06-01 cut — TeamDashboardPage archived; no sidebar entry. */}
        {() => <Redirect to="/team" />}
      </Route>
      {/* Phase 5 §5 — team-readiness routes. */}
      <Route path="/team/dashboard">
        {() => <ProtectedRoute component={TeamManagerDashboardPage} />}
      </Route>
      <Route path="/team/offer-approvals">
        {() => <ProtectedRoute component={TeamOfferApprovalsPage} />}
      </Route>
      <Route path="/settings/lead-assignment">
        {() => <ProtectedRoute component={LeadAssignmentSettingsPage} />}
      </Route>
      <Route path="/settings/underwriting">
        {() => <ProtectedRoute component={UnderwritingSettingsPage} />}
      </Route>
      <Route path="/settings/integrations">
        {() => <ProtectedRoute component={IntegrationsSettingsPage} />}
      </Route>
      <Route path="/team">
        {() => <ProtectedRoute component={TeamInboxPage} />}
      </Route>
      {/* Legacy alias — see client/src/lib/route-redirects.ts (sunset 2026-07-02). */}
      <Route path="/team-inbox">
        {() => <Redirect to="/team" />}
      </Route>
      <Route path="/automation">
        {() => <ProtectedRoute component={AutomationPage} />}
      </Route>
      <Route path="/workflows">
        {() => <ProtectedRoute component={WorkflowsPage} />}
      </Route>
      <Route path="/activity">
        {() => <ProtectedRoute component={ActivityPage} />}
      </Route>
      <Route path="/analytics">
        {() => <ProtectedRoute component={AnalyticsPage} />}
      </Route>
      <Route path="/finance">
        {() => <ProtectedRoute component={FinancePage} />}
      </Route>
      <Route path="/notes">
        {() => <ProtectedRoute component={NotesPage} />}
      </Route>
      <Route path="/notes/tax-readiness">
        {() => <ProtectedRoute component={NotesTaxReadinessPage} />}
      </Route>
      <Route path="/notes/pipeline">
        {() => <ProtectedRoute component={NotesPipelinePage} />}
      </Route>
      <Route path="/notes/pipeline/:id">
        {() => <ProtectedRoute component={NoteAcquisitionDetailPage} />}
      </Route>
      <Route path="/notes/:id">
        {() => <ProtectedRoute component={NoteDetailPage} />}
      </Route>
      <Route path="/redemption-clock">
        {() => <ProtectedRoute component={RedemptionClockPage} />}
      </Route>
      <Route path="/state-rules">
        {() => <ProtectedRoute component={StateRulesPage} />}
      </Route>
      <Route path="/state-rules/:state">
        {() => <ProtectedRoute component={StateRulesPage} />}
      </Route>
      <Route path="/auction-worksheet">
        {() => <ProtectedRoute component={AuctionWorksheetPage} />}
      </Route>
      {/* B-1: DriveMode — Wholesaler + Fix-Flipper Map CTA. Full-screen
          mobile curb-capture surface. No PageShell; the component owns
          its own header + back button. */}
      <Route path="/drivemode">
        {() => <ProtectedRoute component={DriveModePage} />}
      </Route>
      {/* B-2: CourthouseMode — Tax-Delinquent leapfrog mobile surface.
          Fetches auction-worksheet listings; designed for one-handed
          use at a live auction with spotty connectivity. */}
      <Route path="/courthouse-mode">
        {() => <ProtectedRoute component={CourthouseModePage} />}
      </Route>
      <Route path="/counties/:id">
        {() => <ProtectedRoute component={CountyDetailPage} />}
      </Route>
      <Route path="/quiet-title">
        {() => <ProtectedRoute component={QuietTitlePage} />}
      </Route>
      <Route path="/quiet-title/:id">
        {() => <ProtectedRoute component={QuietTitlePage} />}
      </Route>
      <Route path="/wholesaler-state-rules">
        {() => <ProtectedRoute component={WholesalerStateRulesPage} />}
      </Route>
      <Route path="/wholesaler-state-rules/:state">
        {() => <ProtectedRoute component={WholesalerStateRulesPage} />}
      </Route>
      <Route path="/earnest-money">
        {() => <ProtectedRoute component={EarnestMoneyPage} />}
      </Route>
      <Route path="/double-close">
        {() => <ProtectedRoute component={DoubleClosePage} />}
      </Route>
      <Route path="/double-close/:id">
        {() => <ProtectedRoute component={DoubleClosePage} />}
      </Route>
      <Route path="/buyer-blasts">
        {/* 2026-05-11 audit — consolidated into /campaigns (channel-tab).
            Detail route /buyer-blasts/:id stays operational because the
            blast detail surface has its own deep-link semantics. */}
        {() => <Redirect to="/campaigns?channel=buyer-blasts" />}
      </Route>
      <Route path="/buyer-blasts/:id">
        {() => <ProtectedRoute component={BuyerBlastsPage} />}
      </Route>
      <Route path="/buyer-analytics">
        {() => <ProtectedRoute component={BuyerAnalyticsPage} />}
      </Route>
      <Route path="/portfolio">
        {() => <ProtectedRoute component={PortfolioPage} />}
      </Route>
      <Route path="/campaigns">
        {() => <ProtectedRoute component={CampaignsPage} />}
      </Route>
      <Route path="/ab-tests">
        {/* 2026-06-01 cut — ab-tests.tsx deleted; redirect inline. */}
        {() => <Redirect to="/campaigns#ab-tests" />}
      </Route>
      <Route path="/sequences">
        {/* 2026-05-11 audit — consolidated into /campaigns (channel-tab). */}
        {() => <Redirect to="/campaigns?channel=sequences" />}
      </Route>
      <Route path="/counties">
        {() => <ProtectedRoute component={CountiesPage} />}
      </Route>
      <Route path="/offers">
        {() => <ProtectedRoute component={OffersPage} />}
      </Route>
      <Route path="/offers/batches">
        {() => <ProtectedRoute component={OfferBatchesPage} />}
      </Route>
      <Route path="/listings">
        {() => <ProtectedRoute component={ListingsPage} />}
      </Route>
      <Route path="/documents">
        {() => <ProtectedRoute component={DocumentsPage} />}
      </Route>
      <Route path="/tools">
        {() => <ProtectedRoute component={ToolsPage} />}
      </Route>
      <Route path="/command-center">
        {() => <Redirect to="/ai#chat" />}
      </Route>
      <Route path="/agents">
        {() => <Redirect to="/ai#agents" />}
      </Route>
      <Route path="/ai-team">
        {() => <Redirect to="/ai#agents" />}
      </Route>
      <Route path="/support">
        {/* 2026-05-11 — replaced the 15-line SupportPage redirect stub
            with an inline Redirect so /support → /help#support works at
            the router level. */}
        {() => <Redirect to="/help#support" />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} />}
      </Route>
      <Route path="/my-letter">
        {/* 2026-06-01 cut — my-letter.tsx archived; no callers. Redirect to today. */}
        {() => <Redirect to="/today" />}
      </Route>
      <Route path="/settings/email">
        {/* 2026-06-01 cut — email-settings.tsx deleted (was a redirect stub). */}
        {() => <Redirect to="/settings#communications" />}
      </Route>
      <Route path="/settings/mail">
        {/* 2026-06-01 cut — mail-settings.tsx deleted (was a redirect stub). */}
        {() => <Redirect to="/settings#communications" />}
      </Route>
      <Route path="/inbox">
        {() => <ProtectedRoute component={InboxPage} />}
      </Route>
      <Route path="/help">
        {() => <ProtectedRoute component={HelpPage} />}
      </Route>
      {/* Lens 25 #3 — public KB browse + article surfaces. These render
          without ProtectedRoute so signed-out users can land on a
          docsSlug deep link (from an `Errors.*` toast) and read the
          explanation. /help/kb is the alias to the dedicated browse
          page; /help itself still hosts the legacy FAQ tab. */}
      <Route path="/help/kb">
        {() => <KnowledgeBasePage />}
      </Route>
      <Route path="/help/article/:slug">
        {() => <KnowledgeBaseArticlePage />}
      </Route>
      <Route path="/admin/support">
        {/* 2026-06-01 cut — admin-support.tsx archived; redirect to help. */}
        {() => <Redirect to="/help#support" />}
      </Route>
      {/* IA consolidation (Lens 4): /founder/bridge is the canonical
          founder home — fused chat + telemetry surface. Every prior
          founder-home variant redirects here.
            • /founder-dashboard  — was the legacy 7,400-line operations
              console (FounderDashboard). Now points to bridge; the legacy
              component itself stays reachable via the sidebar "Operations
              console (legacy)" overflow entry which still hits its old
              route → bridge (no longer the real dashboard, but extraction
              continues per Sigfried §1).
            • /founder-home      — was the early "clean home" landing page.
            • /founder/now       — was the tile-driven daily inbox.
            • /founder/cockpit   — was the weekly steering surface.
          See client/src/lib/route-redirects.ts. */}
      <Route path="/founder-dashboard">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder-home">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/now">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/cockpit">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      {/* Pillar R — per-(agent, category) tier admin. Linked from the
          cockpit's autonomy section. */}
      <Route path="/founder/trust-graduation">
        {() => <FounderProtectedRoute component={FounderTrustGraduationPage} />}
      </Route>
      {/* CMO ad engine — single founder surface to review + ship ads to
          Meta + TikTok. See server/services/cmo/ + apps/remotion/. */}
      <Route path="/founder/cmo">
        {() => <FounderProtectedRoute component={FounderCmoPage} />}
      </Route>
      {/* Founder redesign Phase C — Studio. Every dial in one place,
          backed by founder_settings + the seeded catalog in
          server/services/settingsSeeder.ts. */}
      <Route path="/founder/studio">
        {() => <FounderProtectedRoute component={FounderStudioPage} />}
      </Route>
      {/* Founder redesign Phase D — Inspector. Provenance lens for
          agents, decisions, and the founder audit trail. */}
      <Route path="/founder/inspector/:scope/:id">
        {() => <FounderProtectedRoute component={FounderInspectorRouter} />}
      </Route>
      <Route path="/founder/inspector/audit">
        {() => <FounderProtectedRoute component={FounderInspectorRouter} />}
      </Route>
      {/* IA consolidation (Lens 4): /founder/dashboard was the legacy
          tile-driven Now-surface (LegacyNowSurface). Folded into the
          bridge per the consolidation plan. */}
      <Route path="/founder/dashboard">
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      {/* /founder — Pulse home (Solene's daily one-line + Autonomy Horizon
          + capital position + phase + team activity). Replaces the chat
          shell that was previously at this URL; chat remains at
          /founder/chat. Every other variant home (/founder-dashboard,
          /founder-home, /founder/now, /founder/cockpit, /founder/dashboard)
          continues to redirect to /founder/bridge. */}
      <Route path="/founder">
        {() => {
          // Phase 4 of Solene migration: when the new-UI flag is on,
          // /founder is the new Today landing page. Otherwise, the
          // existing Pulse page (current behavior).
          const isNewUI = useNewFounderUI();
          if (isNewUI) {
            return <FounderProtectedRoute component={FounderTodayPage} />;
          }
          return <FounderProtectedRoute component={FounderPulsePage} />;
        }}
      </Route>
      {/* Phase 4 — new 5-door founder Today landing page. Direct URL
          always resolves regardless of the feature flag; the flag only
          controls whether /founder defaults here. */}
      <Route path="/founder/today">
        {() => <FounderProtectedRoute component={FounderTodayPage} />}
      </Route>
      {/* Phase 3 — iOS-Claude-UX chat surface. Consumes the Phase 2 backend
          at /api/founder/solene-chat/*. Linked from the sidebar "Chat with
          Solene" CTA and from a compact panel on /founder/today. */}
      <Route path="/founder/solene-chat">
        {() => <FounderProtectedRoute component={FounderSoleneChatPage} />}
      </Route>
      {/* Phase 5 of the Solene migration — the remaining three doors next
          to /founder/today. Each is a lean aggregation view that escapes to
          Solene chat for any deep action. /founder/customers is registered
          below at its existing route entry (rewritten in Phase 5). */}
      <Route path="/founder/team">
        {() => <FounderProtectedRoute component={FounderTeamPage} />}
      </Route>
      <Route path="/founder/money">
        {() => <FounderProtectedRoute component={FounderMoneyPage} />}
      </Route>
      <Route path="/founder/build">
        {() => <FounderProtectedRoute component={FounderBuildPage} />}
      </Route>
      {/* Bridge — fused chat + telemetry surface. Canonical founder home
          per the Lens 4 IA consolidation. */}
      <Route path="/founder/bridge">
        {() => <FounderProtectedRoute component={FounderBridgePage} />}
      </Route>
      {/* Founder redesign Phase E — /founder/steering is the canonical
          weekly/monthly surface. Renders the existing cockpit component;
          future enhancement folds in recovery console + cmo intelligence. */}
      <Route path="/founder/steering">
        {() => <FounderProtectedRoute component={FounderCockpitPage} />}
      </Route>
      <Route path="/founder/ai-observatory">
        {() => <FounderProtectedRoute component={FounderAiObservatory} />}
      </Route>
      <Route path="/founder/financials">
        {/* 2026-06-01 cut — FounderFinancialsPage archived; no sidebar entry. */}
        {() => <Redirect to="/founder/cost" />}
      </Route>
      <Route path="/founder/compliance-ops">
        {() => <FounderProtectedRoute component={FounderComplianceOpsPage} />}
      </Route>
      {/* Legacy binary-flag page consolidated to /founder/features per
          JUDGMENT-CALL-RECOMMENDATIONS #6. Old page kept registered (lazy-
          loaded only on direct URL hit, not in nav) for one release in case
          migration edge-cases surface; planned removal next cleanup. */}
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
        {/* 2026-06-01 cut — FounderIntegrationsPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      {/* Consolidated cost screen — AI spend + infra + vendor lines. */}
      <Route path="/founder/cost">
        {() => <FounderProtectedRoute component={FounderCostPage} />}
      </Route>
      {/* Founder Life-Cockpit — personal taxes, income, deadlines, encrypted vault. */}
      <Route path="/founder/life-cockpit">
        {() => <FounderProtectedRoute component={FounderLifeCockpitPage} />}
      </Route>
      <Route path="/founder/ai-costs">
        {() => <FounderProtectedRoute component={FounderAiCostsPage} />}
      </Route>
      <Route path="/founder/observability-cost">
        {() => <FounderProtectedRoute component={FounderObservabilityCostPage} />}
      </Route>
      <Route path="/founder/cost-optimizer">
        {() => <FounderProtectedRoute component={FounderCostOptimizerPage} />}
      </Route>
      <Route path="/founder/unit-economics">
        {() => <FounderProtectedRoute component={FounderUnitEconomicsPage} />}
      </Route>
      <Route path="/founder/dsar">
        {/* 2026-06-01 cut — FounderDsarPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/legal-holds">
        {/* 2026-06-01 cut — FounderLegalHoldsPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/sub-processors">
        {/* 2026-06-01 cut — FounderSubProcessorsPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/recovery-console">
        {() => <FounderProtectedRoute component={FounderRecoveryConsolePage} />}
      </Route>
      <Route path="/founder/activation">
        {/* 2026-06-01 cut — FounderActivationPage archived; redirect to onboarding. */}
        {() => <Redirect to="/founder/onboarding" />}
      </Route>
      <Route path="/founder/ml-snapshots">
        {/* 2026-06-01 cut — FounderMlSnapshotsPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/etl">
        {/* 2026-06-01 cut — FounderEtlPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/prompt-versions">
        {/* 2026-06-01 cut — FounderPromptVersionsPage archived; redirect to prompt-evolutions. */}
        {() => <Redirect to="/founder/prompt-evolutions" />}
      </Route>
      <Route path="/founder/title-partners">
        {/* 2026-06-01 cut — FounderTitlePartnersPage archived; redirect to bridge. */}
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
      <Route path="/founder/asks">
        {() => <FounderProtectedRoute component={FounderAsksPage} />}
      </Route>
      <Route path="/founder/feed">
        {() => <FounderProtectedRoute component={FounderFeedPage} />}
      </Route>
      <Route path="/properties/compare">
        {/* 2026-06-01 cut — PropertiesComparePage archived; no callers. */}
        {() => <Redirect to="/properties" />}
      </Route>
      <Route path="/marketplace">
        {() => <FlaggedRoute route="/marketplace" component={MarketplacePage} />}
      </Route>
      {/* AcademyPage removed — Academy feature deprecated */}
      <Route path="/land-credit">
        {() => <FlaggedRoute route="/land-credit" component={LandCreditPage} />}
      </Route>
      <Route path="/radar">
        {/* 2026-05-11 audit — consolidated into /deals/discover. */}
        {() => <Redirect to="/deals/discover" />}
      </Route>
      <Route path="/acquisition-radar">
        {() => <Redirect to="/deals/discover" />}
      </Route>
      <Route path="/portfolio-optimizer">
        {() => <FlaggedRoute route="/portfolio-optimizer" component={PortfolioOptimizerPage} />}
      </Route>
      <Route path="/avm">
        {() => <FlaggedRoute route="/avm" component={AVMPage} />}
      </Route>
      <Route path="/maps">
        {() => <ProtectedRoute component={MapsPage} />}
      </Route>
      <Route path="/negotiation">
        {() => <FlaggedRoute route="/negotiation" component={NegotiationCopilotPage} />}
      </Route>
      <Route path="/cash-flow">
        {() => <ProtectedRoute component={CashFlowPage} />}
      </Route>
      <Route path="/deal-hunter">
        {/* 2026-05-11 audit — consolidated into /deals/discover. */}
        {() => <Redirect to="/deals/discover" />}
      </Route>
      <Route path="/vision-ai">
        {() => <FlaggedRoute route="/vision-ai" component={VisionAIPage} />}
      </Route>
      <Route path="/capital-markets">
        {() => <FlaggedRoute route="/capital-markets" component={CapitalMarketsPage} />}
      </Route>
      <Route path="/market-intelligence">
        {() => <FlaggedRoute route="/market-intelligence" component={MarketIntelligencePage} />}
      </Route>
      <Route path="/compliance">
        {() => <FlaggedRoute route="/compliance" component={CompliancePage} />}
      </Route>
      <Route path="/tax-researcher">
        {() => <FlaggedRoute route="/tax-researcher" component={TaxResearcherPage} />}
      </Route>
      <Route path="/document-intelligence">
        {() => <FlaggedRoute route="/document-intelligence" component={DocumentIntelligencePage} />}
      </Route>
      <Route path="/admin/beta">
        {/* 2026-06-01 cut — BetaDashboardPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/admin/safety-gates">
        {() => <FounderProtectedRoute component={SafetyGatesPage} />}
      </Route>
      <Route path="/admin/decisions">
        {/* Cycle 7 r8 Gabriel: autonomous-decision-review is a customer-
            facing feature per acreos-product-model.md; opening this to
            any authenticated user so non-founders can see the
            Decisions Inbox for their own org. */}
        {() => <ProtectedRoute component={DecisionQueuePage} />}
      </Route>
      {/* Cycle 7: legacy /decision-queue alias — /today linked there
          but the real route is /admin/decisions. Redirect so existing
          CTAs and bookmarks still land on the right surface. */}
      <Route path="/decision-queue">
        {() => <Redirect to="/admin/decisions" />}
      </Route>
      <Route path="/admin/ops">
        {/* 2026-06-01 cut — OpsDashboardPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/admin/beta-intake">
        {/* Cycle 10 F03: /admin/beta-intake was routing to the PUBLIC
            beta sign-up form (beta-intake.tsx). The founder's admin
            review queue is at beta-dashboard.tsx (routed at /admin/beta).
            Redirect so founders land on the actual admin queue. The
            public form remains at /beta-intake for non-founder users. */}
        {() => <Redirect to="/admin/beta" />}
      </Route>
      <Route path="/founder/beta-analytics">
        {/* 2026-06-01 cut — BetaAnalyticsPage archived; redirect to bridge. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/founder/agents">
        {/* 2026-06-01 cut — FounderAgentsPage archived; redirect to agent-queue. */}
        {() => <Redirect to="/founder/agent-queue" />}
      </Route>
      <Route path="/founder/daily-digest">
        {/* 2026-06-01 cut — FounderDailyDigestPage archived; redirect to founder pulse. */}
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
      <Route path="/founder/providers">
        {() => <FounderProtectedRoute component={FounderProvidersPage} />}
      </Route>
      <Route path="/founder/todo">
        {() => <FounderProtectedRoute component={FounderTodoPage} />}
      </Route>
      <Route path="/executive-dashboard">
        {() => <FounderProtectedRoute component={ExecutiveDashboardPage} />}
      </Route>

      <Route path="/deal-underwriting">
        {/* 2026-05-11 audit — consolidated into /deals/discover. */}
        {() => <Redirect to="/deals/discover" />}
      </Route>
      <Route path="/deal-feed">
        {/* 2026-05-11 audit — consolidated into /deals/discover. */}
        {() => <Redirect to="/deals/discover" />}
      </Route>
      <Route path="/market-data">
        {/* 2026-06-01 cut — MarketDataPage archived; redirect to market-intelligence. */}
        {() => <Redirect to="/market-intelligence" />}
      </Route>
      <Route path="/team-kpi">
        {/* 2026-06-01 cut — TeamKPIPage archived; redirect to analytics. */}
        {() => <Redirect to="/analytics" />}
      </Route>

      {/* Finance — additional */}
      <Route path="/forecasting">
        {() => <ProtectedRoute component={ForecastingPage} />}
      </Route>
      <Route path="/portfolio-health">
        {() => <ProtectedRoute component={PortfolioHealthPage} />}
      </Route>
      <Route path="/portfolio-pnl">
        {() => <ProtectedRoute component={PortfolioPnLPage} />}
      </Route>
      <Route path="/exchange-1031">
        {() => <ProtectedRoute component={Exchange1031Page} />}
      </Route>
      <Route path="/tax-optimizer">
        {() => <ProtectedRoute component={TaxOptimizerPage} />}
      </Route>
      <Route path="/tax-delinquent">
        {() => <ProtectedRoute component={TaxDelinquentPage} />}
      </Route>
      <Route path="/bookkeeping">
        {() => <ProtectedRoute component={BookkeepingPage} />}
      </Route>
      <Route path="/depreciation">
        {() => <ProtectedRoute component={DepreciationCalculatorPage} />}
      </Route>
      <Route path="/closing-costs">
        {() => <ProtectedRoute component={ClosingCostsPage} />}
      </Route>
      <Route path="/property-tax">
        {() => <ProtectedRoute component={PropertyTaxPage} />}
      </Route>
      <Route path="/fee-dashboard">
        {() => <FounderProtectedRoute component={FeeDashboardPage} />}
      </Route>

      {/* AI / Intelligence — additional */}
      <Route path="/avm-bulk">
        {() => <FlaggedRoute route="/avm-bulk" component={AvmBulkPage} />}
      </Route>
      <Route path="/market-watchlist">
        {() => <FlaggedRoute route="/market-watchlist" component={MarketWatchlistPage} />}
      </Route>
      <Route path="/price-optimizer">
        {() => <FlaggedRoute route="/price-optimizer" component={PriceOptimizerPage} />}
      </Route>
      <Route path="/seller-intent">
        {() => <FlaggedRoute route="/seller-intent" component={SellerIntentPage} />}
      </Route>
      <Route path="/deal-patterns">
        {/* 2026-05-11 audit — consolidated into /deals/discover. */}
        {() => <Redirect to="/deals/discover" />}
      </Route>
      <Route path="/conscious-organization">
        {/* Founder-gated 2026-05-11: this page exposes the org-consciousness
            agent surface (Atlas/Sophie/Forge codenames) which must never
            reach customer-facing users per the persona-architecture rule. */}
        {() => <FounderProtectedRoute component={ConsciousOrganizationPage} />}
      </Route>
      <Route path="/anticipatory-enterprise">
        {/* Exposes internal agent-negotiation codenames (forge_revenue,
            sophie_support, shield_compliance...). Founder-only to keep
            the internal agent taxonomy off customer surfaces — customers
            see one AI brand (Pax), not the dozen under the hood. */}
        {() => <FounderProtectedRoute component={AnticipatoryEnterprisePage} />}
      </Route>
      {/* /real-runtime removed (Lens 4 Fix 4) — see lazy-import note. */}
      <Route path="/agent-command-center">
        {() => <Redirect to="/ai#agents" />}
      </Route>

      {/* Operations — additional */}
      <Route path="/zoning">
        {() => <ProtectedRoute component={ZoningLookupPage} />}
      </Route>
      <Route path="/title-search">
        {() => <ProtectedRoute component={TitleSearchPage} />}
      </Route>
      <Route path="/property-enrichment">
        {() => <ProtectedRoute component={PropertyEnrichmentPage} />}
      </Route>
      <Route path="/skip-tracing">
        {() => <ProtectedRoute component={SkipTracingPage} />}
      </Route>
      <Route path="/direct-mail">
        {/* 2026-05-11 audit — consolidated into /campaigns (channel-tab). */}
        {() => <Redirect to="/campaigns?channel=direct-mail" />}
      </Route>
      <Route path="/direct-mail-campaigns">
        {() => <Redirect to="/campaigns?channel=direct-mail" />}
      </Route>
      {/* Pillar 3 — customer-facing direct mail composer + in-flight tracker. */}
      <Route path="/outreach/mail">
        {() => <ProtectedRoute component={OutreachMailPage} />}
      </Route>
      <Route path="/syndication">
        {() => <ProtectedRoute component={SyndicationPage} />}
      </Route>
      <Route path="/syndication-status">
        {() => <ProtectedRoute component={ListingSyndicationPage} />}
      </Route>

      {/* Team — additional */}
      <Route path="/commissions">
        {/* Founder-gated 2026-05-11: org-wide commission ledgers are a
            founder-business surface; per-user commissions land in
            /settings → Payouts and /money for customers. */}
        {() => <FounderProtectedRoute component={CommissionsPage} />}
      </Route>
      <Route path="/team-leaderboard">
        {/* 2026-06-01 cut — TeamLeaderboardPage archived; no callers. */}
        {() => <Redirect to="/team" />}
      </Route>

      {/* Analytics / Reporting */}
      <Route path="/kpis">
        {/* 2026-06-01 cut — KPIDashboardPage archived; redirect to analytics. */}
        {() => <Redirect to="/analytics" />}
      </Route>
      <Route path="/cohort-analysis">
        {/* 2026-06-01 cut — CohortAnalysisPage archived. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/audit-log">
        {/* 2026-06-01 cut — AuditLogPage archived; audit log is in compliance-settings. */}
        {() => <Redirect to="/settings" />}
      </Route>
      <Route path="/data-export">
        {() => <ProtectedRoute component={DataExportPage} />}
      </Route>
      <Route path="/import">
        {() => <ProtectedRoute component={DataImportPage} />}
      </Route>
      <Route path="/model-training">
        {/* 2026-06-01 cut — ModelTrainingPage archived; no nav entry. */}
        {() => <Redirect to="/analytics" />}
      </Route>
      <Route path="/investor-network">
        {() => <ProtectedRoute component={InvestorDirectoryPage} />}
      </Route>
      <Route path="/regulatory-intel">
        {() => <ProtectedRoute component={RegulatoryIntelPage} />}
      </Route>

      {/* Settings — additional */}
      <Route path="/settings/privacy">
        {() => <ProtectedRoute component={PrivacySettingsPage} />}
      </Route>
      <Route path="/settings/tax-identity">
        {() => <ProtectedRoute component={TaxIdentitySettingsPage} />}
      </Route>
      <Route path="/settings/accessibility">
        {() => <ProtectedRoute component={AccessibilitySettingsPage} />}
      </Route>
      <Route path="/settings/pax">
        {() => <ProtectedRoute component={PaxControlsPage} />}
      </Route>
      {/* Quinn item #5 — "How AcreOS sources data" disclosure. Linked from
          Settings and from each datum's provenance "i" affordance. */}
      <Route path="/data-sources">
        {() => <ProtectedRoute component={DataSourcesPage} />}
      </Route>
      <Route path="/usage">
        {/* 2026-06-01 cut — UsageQuotaPage archived; no nav entry. */}
        {() => <Redirect to="/settings" />}
      </Route>
      <Route path="/goals">
        {() => <ProtectedRoute component={GoalsPage} />}
      </Route>
      <Route path="/webhooks">
        {() => <ProtectedRoute component={WebhooksPage} />}
      </Route>
      <Route path="/dodd-frank">
        {() => <FlaggedRoute route="/dodd-frank" component={DoddFrankCheckerPage} />}
      </Route>
      <Route path="/state-documents">
        {/* 2026-06-01 cut — StateDocumentsPage archived; no nav entry. */}
        {() => <Redirect to="/settings" />}
      </Route>
      <Route path="/dunning">
        {() => <ProtectedRoute component={DunningManagerPage} />}
      </Route>
      {/* /freedom-meter, /night-cap, /evening-review removed (Lens 4
          Fix 4) — see lazy-import notes. Page files deleted. */}
      <Route path="/blind-offer-wizard">
        {() => <ProtectedRoute component={BlindOfferWizardPage} />}
      </Route>

      {/* Founder / Admin — additional */}
      <Route path="/founder/v13">
        {() => <FounderProtectedRoute component={SovereignV13Page} />}
      </Route>
      <Route path="/founder/agents/:codename">
        {() => <FounderProtectedRoute component={AgentDetailPage} />}
      </Route>
      <Route path="/admin/beta-analytics">
        {/* 2026-06-01 cut — BetaAnalyticsPage archived; no nav entry. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/admin/queues">
        {/* 2026-06-01 cut — QueueMonitorPage archived; no nav entry. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/admin/integrations-health">
        {/* 2026-06-01 cut — IntegrationsHealthPage archived; no nav entry. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/admin/monitor">
        {/* 2026-06-01 cut — ProactiveMonitorPage archived; no nav entry. */}
        {() => <Redirect to="/founder/bridge" />}
      </Route>
      <Route path="/reseller">
        {() => <FounderProtectedRoute component={ResellerDashboardPage} />}
      </Route>
      <Route path="/data-moat">
        {/* 2026-06-01 cut — DataMoatDashboardPage archived; no nav entry. */}
        {() => <Redirect to="/founder/telemetry" />}
      </Route>

      {/* Sovereign Protocol — Phase A Visibility Layer */}
      <Route path="/sovereign">
        {() => <FounderProtectedRoute component={SovereignDashboardPage} />}
      </Route>
      <Route path="/board-of-directors">
        {() => <FounderProtectedRoute component={BoardOfDirectorsPage} />}
      </Route>
      <Route path="/agent-performance">
        {() => <FounderProtectedRoute component={AgentPerformancePage} />}
      </Route>
      <Route path="/memory-browser">
        {() => <FounderProtectedRoute component={MemoryBrowserPage} />}
      </Route>
      <Route path="/event-log">
        {() => <FounderProtectedRoute component={EventLogPage} />}
      </Route>
      <Route path="/job-health">
        {() => <FounderProtectedRoute component={JobHealthPage} />}
      </Route>
      <Route path="/agent-collaboration">
        {() => <FounderProtectedRoute component={AgentCollaborationPage} />}
      </Route>

      <Route component={NotFound} />
      </Switch>
    </React.Suspense>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isMobile } = useIsMobile();
  // Mobile: opacity cross-fade only — the persistent bottom-nav makes
  // route changes feel like tab switches, not forward navigation, so
  // the x-translate reads as drift. Desktop keeps the existing fade+x.
  const variants = isMobile ? variantPageFadeMobile : pageTransition;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="min-h-screen"
        id="main-content"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * AtlasDockHost — thin wrapper that resolves the current page context
 * (route + URL params) and hands it to the lazy Dock. Lives in App.tsx
 * because both the gating logic and the dock mount belong to the global
 * shell; pulling it into its own file would split a 4-line concern.
 */
function AtlasDockHost() {
  const pageContext = usePageContext();
  // Subscribe to the global "atlas:discuss" event so any artifact card
  // can request the dock open with a prefilled question. See
  // client/src/lib/atlas-discuss.ts for the publisher helper.
  const [prefill, setPrefill] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setPrefill(detail?.message ?? undefined);
    };
    window.addEventListener("atlas:discuss", handler);
    return () => window.removeEventListener("atlas:discuss", handler);
  }, []);
  return <AtlasDock pageContext={pageContext} prefillMessage={prefill} />;
}

function AppContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const { isMobile } = useIsMobile();
  useSwipeNavigation();
  useWhiteLabel();
  useCursorGlass();

  // NPS feedback collection
  const [npsOpen, setNpsOpen] = React.useState(false);
  const [npsDismissChecked, setNpsDismissChecked] = React.useState(false);

  const { data: npsData } = useQuery<{ shouldShow: boolean; trigger: string | null }>({
    queryKey: ["/api/nps/pending"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Check at most every 5 minutes
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (!npsData?.shouldShow || npsDismissChecked) return;
    setNpsDismissChecked(true);

    // Respect 7-day dismiss window
    const dismissedAt = localStorage.getItem("nps_dismissed_at");
    if (dismissedAt) {
      const dismissedDate = new Date(dismissedAt);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (dismissedDate > sevenDaysAgo) return;
    }

    // Delay showing NPS dialog so it doesn't interrupt page load
    const timer = setTimeout(() => setNpsOpen(true), 3000);
    return () => clearTimeout(timer);
  }, [npsData, npsDismissChecked]);

  React.useEffect(() => {
    if (user) {
      telemetry.sessionStart();
      // Tag Sentry events with the authenticated user so error reports
      // are searchable by id/email. Cleared on logout via the else branch.
      setSentryUser({ id: user.id, email: user.email ?? undefined });
      // Wave 3 Workstream E — distribution telemetry. Tag every
      // PostHog event with the server-confirmed user id + persona so
      // the founder can answer "who signed up?" not just "how many."
      // No-op when VITE_POSTHOG_KEY is unset (see lib/analytics.ts).
      identifyUser(String(user.id), {
        persona: user.persona ?? "land_investor",
        email: user.email ?? undefined,
      });
    } else {
      setSentryUser(null);
    }
  }, [user]);

  // Wave 3 Workstream E — flush captured UTM on the first authenticated
  // render after sign-up. AuthPage planted `acreos-pending-signup` when
  // it mounted in sign-up mode; we read it here and, if present, POST
  // the sessionStorage UTM snapshot to /api/me/acquisition-utm and emit
  // `signup_completed` with the same attribution attached. The server
  // endpoint is idempotent so a duplicate fire on rerender is harmless,
  // but the ref ensures we only attempt the flush once per session.
  const signupFlushedRef = React.useRef(false);
  React.useEffect(() => {
    if (!user || signupFlushedRef.current) return;
    if (!hasSignupIntent()) return;
    signupFlushedRef.current = true;
    void (async () => {
      const snap = await flushPendingUtm();
      // Phase Zero-Two — canonical funnel event 2 of 5. trackCanonicalEvent
      // is the type-checked variant so a typo here can't silently break
      // attribution. The UTM snapshot was captured pre-signup by
      // capturePendingUtm() on the landing → auth path.
      trackCanonicalEvent("signup_completed", {
        persona: user.persona ?? "land_investor",
        utm_source: snap?.utm_source ?? null,
        utm_medium: snap?.utm_medium ?? null,
        utm_campaign: snap?.utm_campaign ?? null,
        utm_content: snap?.utm_content ?? null,
        utm_term: snap?.utm_term ?? null,
        referrer: snap?.referrer ?? null,
      });
    })();
  }, [user]);

  // Single first-mount pageview. SPA route changes are NOT captured
  // (we disabled capture_pageview in analytics.ts); instead, deliberate
  // events are emitted at meaningful boundaries (signup_completed, etc.).
  // The app_open event is the substrate for "is the app being opened
  // at all?" — useful even before any other instrumentation lands.
  const appOpenSentRef = React.useRef(false);
  React.useEffect(() => {
    if (appOpenSentRef.current) return;
    appOpenSentRef.current = true;
    trackEvent("app_open", {
      path: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, []);

  // ── Offline sync toasts ─────────────────────────────────────────────────────
  // usePWA tracks the SW's OFFLINE_SYNC_COMPLETE message (incrementing
  // syncedCount) and the pending offline queue size. We surface:
  //   1. When a request is queued offline → SW response already says so
  //      in its 202 body; the OfflineIndicator banner covers this state.
  //   2. When the queue flushes on reconnect → toast: "Synced N items."
  //   3. When pendingSyncCount drops to 0 from >0 → handled by (2).
  // We do NOT show the "Saved offline" toast here — that's embedded in
  // the individual mutation callers (field-scout, courthouse, etc.) where
  // context is meaningful ("Scout saved offline" vs a generic message).
  const { syncedCount } = usePWA();
  const prevSyncedCountRef = React.useRef(0);
  React.useEffect(() => {
    if (syncedCount > prevSyncedCountRef.current && syncedCount > 0) {
      const delta = syncedCount - prevSyncedCountRef.current;
      toast({
        title: delta === 1 ? "Synced offline change" : `Synced ${delta} offline changes`,
        description: "Your data is up to date.",
        duration: 4000,
      });
    }
    prevSyncedCountRef.current = syncedCount;
  }, [syncedCount, toast]);

  // Cmd+; (Ctrl+; on Windows/Linux) — toggle persona mode. Solves Tom's
  // #1 nav pain (founder dashboard → had to hit Back repeatedly).
  // Skipped when the user is typing in an input/textarea/contenteditable.
  const { toggle: togglePersonaMode } = usePersonaMode();
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // ";" is the key on both US and most international layouts; we
      // match by .key (not .code) so it works on the unshifted glyph.
      if (e.key !== ";") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      togglePersonaMode();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePersonaMode]);

  // One-time first-launch hint for the command palette.
  // Phase 4 Week 19-20 (cmdk-v2 / Anya §8): promoted from DEV-only to
  // production so every signed-in user sees the ⌘K hint exactly once.
  // localStorage key 'hint_cmdk_shown' guarantees idempotency across
  // navigations and reloads. Suppressed on mobile — there is no Cmd
  // key, and the mobile shell already exposes Search as a header icon.
  if (typeof window !== 'undefined' && !isMobile) {
    const seen = localStorage.getItem('hint_cmdk_shown');
    if (!seen && user) {
      localStorage.setItem('hint_cmdk_shown', '1');
      setTimeout(() => {
        toast({
          title: 'Press ⌘K to do anything in AcreOS',
          description: 'Search, run actions, ask Pax — all from one place.',
        });
      }, 800);
    }
  }

  // Mobile uses the standard Router + MobileBottomNav (below). The earlier
  // experimental "MobileShell" (a parallel persona-tab layout behind the
  // mobile.new_shell_enabled flag) was removed 2026-05-29 — it was never
  // enabled in production and duplicated the live navigation.

  return (
    <>
      <a href="#main-content" className="skip-to-content" aria-label="Skip to main content">
        Skip to content
      </a>
      {user && (
        <NotificationStack>
          {/* most-urgent first; only the top active one shows */}
          <TrialBanner />
          <EarlyAccessBanner />
        </NotificationStack>
      )}
      <PageWrapper>
        <Router />
      </PageWrapper>
      {/* Floating dock — canonical slots, no overlaps (see lib/floating-slots.ts):
          slot 0 (bottom-4):    primary FAB  — new lead/property/deal/etc
          slot 1 (bottom-24):   conversation tray — chat with agents
          slot 2 (bottom-176):  help (also hosts feedback)
          Feedback was slot 3 until the consolidation pass — now it
          lives inside the help sheet + settings + command palette. */}
      {/* FloatingActionButton hidden on desktop — desktop has ⌘K + sidebar
          New-Item menu; mobile keeps the FAB as a tap target.
          Also hidden on /ai (chat surface has its own send button — the
          global FAB overlaps the chat input on mobile) and on /inbox
          (primary action lives in the page chrome there too). */}
      {user && !location.startsWith("/ai") && !location.startsWith("/inbox") && !location.startsWith("/field-scout") && (
        <div className="md:hidden"><FloatingActionButton /></div>
      )}
      {/* ConversationTray removed 2026-05-20 — the floating chat button opened
          to a frosted/empty sheet on every screen (team-messaging feature isn't
          mature enough to surface as a global FAB yet). When team messaging
          ships properly, re-mount through a feature flag rather than always-on. */}
      {/* FloatingHelpButton removed 2026-05-01 — folded into ⌘K command
          palette (already shipped). The help search lives there now;
          one fewer FAB on every page. */}
      {/* Lazy-loaded floating components — wrapped in Suspense with null
          fallback so the entry chunk doesn't ship them. They appear after
          first paint with no visible delay (small JS, fetched in parallel
          with main render). */}
      {user && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {/* IA consolidation (Lens 4 Fix 3): ⌘⇧K founder palette was
          merged into the main ⌘K palette above. The provider mount
          point is intentionally removed. */}
      {user && (
        <Suspense fallback={null}>
          <NewItemMenu />
        </Suspense>
      )}
      {/* Suppress MobileBottomNav on founder routes — customer-side nav
          items don't apply to founder mode (#9 audit finding). The founder
          gets a dedicated FounderMobileBottomNav with the 5 canonical
          surfaces, otherwise mobile founders are stranded on whatever page
          they landed on with no nav (F-D22, reported as "single dashboard
          and no controls"). */}
      {user && !location.startsWith("/founder") && <MobileBottomNav />}
      {user && location.startsWith("/founder") && <FounderMobileBottomNav />}
      {/* Atlas Dock — Phase D. Appears on every /founder/* page EXCEPT
          /founder itself (which IS the chat shell — dual surfaces would
          duplicate the UI). Page-context is auto-resolved from the
          current location so Atlas can answer "what am I looking at?". */}
      {user && location.startsWith("/founder") && location !== "/founder" && (
        <Suspense fallback={null}>
          <AtlasDockHost />
        </Suspense>
      )}
      {user && <BetaActivationDetector />}
      {/* Hide the global PaxCopilotRail on /ai because that page has
          its own main-area chat UI ("AcreOS Assistant"). r3 Gabriel
          caught the dual-chat-UI confusion (UX-R3-001). Elsewhere
          the rail remains the primary conversational entry point. */}
      {user && !location.startsWith("/ai") && (
        <Suspense fallback={null}>
          <PaxCopilotRail />
        </Suspense>
      )}
      {user && <DynamicIsland />}
      {user && <NotificationBanner />}
      {user && npsData?.shouldShow && npsData.trigger && (
        <Suspense fallback={null}>
          <NpsDialog
            open={npsOpen}
            trigger={npsData.trigger}
            onClose={() => setNpsOpen(false)}
          />
        </Suspense>
      )}
      {/* PWA install prompt — gated on auth so it never overlaps the
          landing-page primary CTA (Chesky review finding). Unauthenticated
          visitors on landing should never see the install banner. */}
      {user && <PWAInstallPrompt />}
    </>
  );
}

// F-D12: pass wouter's location to the ErrorBoundary so a per-route crash
// doesn't trap the user — boundary clears its error state on next nav.
function LocationAwareErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <LocationAwareErrorBoundary>
      <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <AccessibilityProvider>
        <SidebarProvider>
          <PaxRailProvider>
          <DynamicIslandProvider>
          <QueryClientProvider client={queryClient}>
            {/* Tahoe E5 — per-org accent/logo/density layered over the
                personal theme. Inside QueryClientProvider (uses useQuery)
                and ThemeProvider (defers to personal density). */}
            <TenantThemeProvider>
            <FeatureFlagsProvider>
            <TooltipProvider>
              <HintsProvider>
                <KeyboardShortcutsProvider>
                  <OfflineIndicator />
                  <Toaster />
                  <CookieConsentBanner />
                  <AppContent />
                  <Suspense fallback={null}>
                    <KeyboardShortcutsModal />
                  </Suspense>
                  <DealModalsHost />
                </KeyboardShortcutsProvider>
              </HintsProvider>
            </TooltipProvider>
            </FeatureFlagsProvider>
            </TenantThemeProvider>
          </QueryClientProvider>
          </DynamicIslandProvider>
          </PaxRailProvider>
        </SidebarProvider>
        </AccessibilityProvider>
      </ThemeProvider>
      </MotionConfig>
    </LocationAwareErrorBoundary>
  );
}

export default App;
