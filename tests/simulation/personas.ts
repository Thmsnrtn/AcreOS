/**
 * Shared persona definitions for synthetic beta simulation.
 *
 * Each persona exercises a different slice of the product surface:
 *   - First Timer Fiona: brand new, beginner onboarding, empty states
 *   - Scaling Steve: active operator, CSV imports, campaigns, notes
 *   - Enterprise Elaine: team management, VA roles, cross-org isolation
 *   - Note Nerd Nathan: seller finance heavy, note portfolio, borrower portal
 *   - Tire Kicker Tom: free tier, hits every limit, feature gates
 */

export interface PersonaDefinition {
  name: string;
  email: string;
  password: string;
  tier: "free" | "sprout" | "starter" | "pro" | "scale" | "enterprise";
  onboardingPath: "beginner" | "active" | "enterprise";
  expectedJourney: readonly string[];
}

export const PERSONAS = {
  firstTimer: {
    name: "Fiona Torres",
    email: "fiona.sim@acreos-test.com",
    password: "SimTest2026!Fiona",
    tier: "sprout",
    onboardingPath: "beginner",
    expectedJourney: [
      "signup",
      "onboarding_beginner",
      "explore_dashboard",
      "add_first_lead",
      "create_deal_from_lead",
      "view_pipeline",
      "explore_pax",
      "check_settings",
    ],
  },

  scalingOperator: {
    name: "Steve Marchetti",
    email: "steve.sim@acreos-test.com",
    password: "SimTest2026!Steve",
    tier: "starter",
    onboardingPath: "active",
    expectedJourney: [
      "signup",
      "onboarding_active",
      "csv_import_200_leads",
      "create_campaign",
      "enroll_leads_in_sequence",
      "create_deal",
      "add_property",
      "create_note",
      "generate_amortization_schedule",
      "view_borrower_portal",
      "upgrade_to_pro",
    ],
  },

  enterpriseManager: {
    name: "Elaine Whitfield",
    email: "elaine.sim@acreos-test.com",
    password: "SimTest2026!Elaine",
    tier: "pro",
    onboardingPath: "enterprise",
    expectedJourney: [
      "signup",
      "onboarding_enterprise",
      "invite_team_member",
      "assign_va_role",
      "create_deal_as_va",
      "verify_deal_visible_to_owner",
      "team_dashboard",
      "verify_cross_org_isolation",
    ],
  },

  noteInvestor: {
    name: "Nathan Reeves",
    email: "nathan.sim@acreos-test.com",
    password: "SimTest2026!Nathan",
    tier: "pro",
    onboardingPath: "active",
    expectedJourney: [
      "signup",
      "onboarding_active",
      "create_10_notes",
      "generate_all_schedules",
      "record_payments",
      "trigger_late_payment",
      "verify_dunning_state",
      "generate_payoff_quote",
      "borrower_portal_login",
      "borrower_make_payment",
      "borrower_enable_autopay",
      "portfolio_health_dashboard",
      "finance_export",
    ],
  },

  limitTester: {
    name: "Tom Delacroix",
    email: "tom.sim@acreos-test.com",
    password: "SimTest2026!Tom",
    tier: "free",
    onboardingPath: "beginner",
    expectedJourney: [
      "signup",
      "onboarding_beginner",
      "create_50_leads",
      "attempt_51st_lead_expect_429",
      "create_10_properties",
      "attempt_11th_property_expect_429",
      "verify_upgrade_toast_shown",
      "attempt_marketplace_expect_404",
      "attempt_vision_ai_expect_404",
      "verify_feature_flags_respected",
      "fire_100_ai_requests",
      "attempt_101st_expect_429",
    ],
  },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
