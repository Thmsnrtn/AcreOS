import { SUBSCRIPTION_TIERS, type SubscriptionTier } from "@shared/schema";

export type ActionCategory = "insight" | "action";

export interface SkillAction {
  id: string;
  name: string;
  description: string;
  category: ActionCategory;
  requiredTier: SubscriptionTier;
  creditCost?: number;
  agentType: "research" | "deals" | "communications" | "operations";
}

export const SKILL_ACTIONS: SkillAction[] = [
  {
    id: "analyze_property",
    name: "Analyze Property",
    description: "Get comprehensive insights about a property including market analysis, zoning, and investment potential",
    category: "insight",
    requiredTier: "free",
    agentType: "research",
  },
  {
    id: "lookup_environmental",
    name: "Environmental Lookup",
    description: "Check flood zones, wetlands, soil data, and environmental risks",
    category: "insight",
    requiredTier: "free",
    agentType: "research",
  },
  {
    id: "market_analysis",
    name: "Market Analysis",
    description: "Analyze local market trends, comparable sales, and investment outlook",
    category: "insight",
    requiredTier: "free",
    agentType: "research",
  },
  {
    id: "investment_calculator",
    name: "Investment Calculator",
    description: "Calculate ROI, cash flow projections, and financing scenarios",
    category: "insight",
    requiredTier: "free",
    agentType: "deals",
  },
  {
    id: "comp_analysis",
    name: "Comparable Analysis",
    description: "Find and analyze comparable property sales in the area",
    category: "insight",
    requiredTier: "free",
    agentType: "deals",
  },
  {
    id: "deal_scoring",
    name: "Deal Scoring",
    description: "Get AI-powered deal scoring and recommendation",
    category: "insight",
    requiredTier: "free",
    agentType: "deals",
  },
  {
    id: "performance_insights",
    name: "Performance Insights",
    description: "View portfolio performance, trends, and optimization suggestions",
    category: "insight",
    requiredTier: "free",
    agentType: "operations",
  },
  {
    id: "delinquency_check",
    name: "Delinquency Check",
    description: "Check payment status and identify at-risk notes",
    category: "insight",
    requiredTier: "free",
    agentType: "operations",
  },
  {
    id: "run_due_diligence",
    name: "Run Due Diligence Report",
    description: "Generate a comprehensive due diligence report with parcel data, environmental analysis, and risk assessment",
    category: "action",
    requiredTier: "starter",
    creditCost: 50,
    agentType: "research",
  },
  {
    id: "enrich_property",
    name: "Enrich Property Data",
    description: "Automatically pull and update property data from external sources",
    category: "action",
    requiredTier: "starter",
    creditCost: 20,
    agentType: "research",
  },
  {
    id: "generate_offer",
    name: "Generate Offer Letter",
    description: "Create a professional offer letter with customizable terms",
    category: "action",
    requiredTier: "starter",
    creditCost: 10,
    agentType: "deals",
  },
  {
    id: "generate_contract",
    name: "Generate Contract",
    description: "Create purchase agreement or promissory note documents",
    category: "action",
    requiredTier: "pro",
    creditCost: 25,
    agentType: "deals",
  },
  {
    id: "compose_email",
    name: "Compose Email",
    description: "Draft personalized emails for leads or borrowers",
    category: "action",
    requiredTier: "starter",
    creditCost: 5,
    agentType: "communications",
  },
  {
    id: "compose_sms",
    name: "Compose SMS",
    description: "Draft SMS messages for quick outreach",
    category: "action",
    requiredTier: "starter",
    creditCost: 3,
    agentType: "communications",
  },
  {
    id: "send_email",
    name: "Send Email",
    description: "Send email directly to lead or borrower",
    category: "action",
    requiredTier: "starter",
    creditCost: 10,
    agentType: "communications",
  },
  {
    id: "send_sms",
    name: "Send SMS",
    description: "Send SMS directly to lead or borrower",
    category: "action",
    requiredTier: "starter",
    creditCost: 15,
    agentType: "communications",
  },
  {
    id: "launch_campaign",
    name: "Launch Campaign",
    description: "Start an email, SMS, or direct mail campaign",
    category: "action",
    requiredTier: "pro",
    creditCost: 100,
    agentType: "communications",
  },
  {
    id: "send_direct_mail",
    name: "Send Direct Mail",
    description: "Send physical mail via Lob API",
    category: "action",
    requiredTier: "pro",
    creditCost: 150,
    agentType: "communications",
  },
  {
    id: "generate_alert",
    name: "Generate Alert",
    description: "Create and send system alerts or notifications",
    category: "action",
    requiredTier: "starter",
    creditCost: 5,
    agentType: "operations",
  },
  {
    id: "run_digest",
    name: "Run Digest",
    description: "Generate and send daily/weekly digest reports",
    category: "action",
    requiredTier: "pro",
    creditCost: 20,
    agentType: "operations",
  },
  {
    id: "optimize_campaign",
    name: "Optimize Campaign",
    description: "AI-powered campaign optimization with automatic adjustments",
    category: "action",
    requiredTier: "pro",
    creditCost: 50,
    agentType: "operations",
  },
  {
    id: "bulk_import",
    name: "Bulk Import",
    description: "Import leads or properties in bulk from CSV",
    category: "action",
    requiredTier: "starter",
    creditCost: 30,
    agentType: "operations",
  },
  {
    id: "bulk_export",
    name: "Bulk Export",
    description: "Export data in bulk to CSV or other formats",
    category: "action",
    requiredTier: "starter",
    creditCost: 10,
    agentType: "operations",
  },
  {
    id: "team_assignment",
    name: "Team Assignment",
    description: "Assign leads, properties, or tasks to team members",
    category: "action",
    requiredTier: "pro",
    creditCost: 0,
    agentType: "operations",
  },
  {
    id: "workflow_automation",
    name: "Workflow Automation",
    description: "Create automated workflows for lead nurturing and follow-ups",
    category: "action",
    requiredTier: "scale",
    creditCost: 0,
    agentType: "operations",
  },
];

const TIER_HIERARCHY: SubscriptionTier[] = ["free", "starter", "pro", "scale", "enterprise"];

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredTier?: SubscriptionTier;
  currentTier: SubscriptionTier;
  creditCost?: number;
  upgradeMessage?: string;
  canUseTrialToken?: boolean;
  trialTokensRemaining?: number;
}

export interface TrialTokenInfo {
  available: number;
  canUse: boolean;
}

export function checkSkillPermission(
  actionId: string,
  userTier: SubscriptionTier,
  isFounder: boolean = false,
  trialTokens: number = 0
): PermissionCheckResult {
  if (isFounder) {
    return { allowed: true, currentTier: userTier };
  }

  const action = SKILL_ACTIONS.find(a => a.id === actionId);
  if (!action) {
    return {
      allowed: false,
      reason: "Unknown action",
      currentTier: userTier,
    };
  }

  if (action.category === "insight") {
    return {
      allowed: true,
      currentTier: userTier,
      creditCost: action.creditCost,
    };
  }

  const userTierIndex = TIER_HIERARCHY.indexOf(userTier);
  const requiredTierIndex = TIER_HIERARCHY.indexOf(action.requiredTier);

  if (userTierIndex >= requiredTierIndex) {
    return {
      allowed: true,
      currentTier: userTier,
      creditCost: action.creditCost,
    };
  }

  // Check if user can use a trial token for this action
  const canUseTrialToken = trialTokens > 0;
  
  const tierConfig = SUBSCRIPTION_TIERS[action.requiredTier];
  return {
    allowed: false,
    reason: `This action requires ${tierConfig.name} tier or higher`,
    requiredTier: action.requiredTier,
    currentTier: userTier,
    creditCost: action.creditCost,
    upgradeMessage: canUseTrialToken 
      ? `Use a trial token to try "${action.name}" free, or upgrade to ${tierConfig.name} ($${tierConfig.price}/mo) for unlimited access.`
      : `Upgrade to ${tierConfig.name} ($${tierConfig.price}/mo) to unlock "${action.name}" and other powerful actions.`,
    canUseTrialToken,
    trialTokensRemaining: trialTokens,
  };
}

export function checkTrialTokenEligibility(
  actionId: string,
  userTier: SubscriptionTier,
  trialTokens: number
): { eligible: boolean; reason?: string } {
  const action = SKILL_ACTIONS.find(a => a.id === actionId);
  if (!action) {
    return { eligible: false, reason: "Unknown action" };
  }

  // Insights are always free - no trial token needed
  if (action.category === "insight") {
    return { eligible: false, reason: "This action is already free" };
  }

  // Check if user already has tier access
  const userTierIndex = TIER_HIERARCHY.indexOf(userTier);
  const requiredTierIndex = TIER_HIERARCHY.indexOf(action.requiredTier);
  if (userTierIndex >= requiredTierIndex) {
    return { eligible: false, reason: "You already have access to this action" };
  }

  // Check if tokens available
  if (trialTokens <= 0) {
    return { eligible: false, reason: "No trial tokens remaining" };
  }

  return { eligible: true };
}

export function getAvailableActions(
  userTier: SubscriptionTier,
  isFounder: boolean = false
): { insights: SkillAction[]; actions: SkillAction[]; lockedActions: SkillAction[] } {
  const insights: SkillAction[] = [];
  const actions: SkillAction[] = [];
  const lockedActions: SkillAction[] = [];

  const userTierIndex = isFounder ? TIER_HIERARCHY.length - 1 : TIER_HIERARCHY.indexOf(userTier);

  for (const action of SKILL_ACTIONS) {
    if (action.category === "insight") {
      insights.push(action);
    } else {
      const requiredTierIndex = TIER_HIERARCHY.indexOf(action.requiredTier);
      if (userTierIndex >= requiredTierIndex) {
        actions.push(action);
      } else {
        lockedActions.push(action);
      }
    }
  }

  return { insights, actions, lockedActions };
}

export function getActionsByAgent(
  agentType: "research" | "deals" | "communications" | "operations",
  userTier: SubscriptionTier,
  isFounder: boolean = false
): { available: SkillAction[]; locked: SkillAction[] } {
  const { insights, actions, lockedActions } = getAvailableActions(userTier, isFounder);
  
  const allAvailable = [...insights, ...actions].filter(a => a.agentType === agentType);
  const allLocked = lockedActions.filter(a => a.agentType === agentType);

  return { available: allAvailable, locked: allLocked };
}

export function mapIntentToAction(intent: string): string | null {
  const intentToAction: Record<string, string> = {
    run_due_diligence: "run_due_diligence",
    lookup_environmental: "lookup_environmental",
    analyze_investment: "market_analysis",
    enrich_property: "enrich_property",
    generate_offer: "generate_offer",
    analyze_deal: "deal_scoring",
    lookup_comps: "comp_analysis",
    calculate_financing: "investment_calculator",
    compose_email: "compose_email",
    compose_sms: "compose_sms",
    nurture_lead: "compose_email",
    generate_campaign_content: "compose_email",
    check_delinquencies: "delinquency_check",
    optimize_campaign: "optimize_campaign",
    generate_alert: "generate_alert",
    run_digest: "run_digest",
    analyze_performance: "performance_insights",
    send_email: "send_email",
    send_sms: "send_sms",
    launch_campaign: "launch_campaign",
    send_direct_mail: "send_direct_mail",
    generate_contract: "generate_contract",
    bulk_import: "bulk_import",
    bulk_export: "bulk_export",
    team_assignment: "team_assignment",
    workflow_automation: "workflow_automation",
    analyze_property: "analyze_property",
    market_analysis: "market_analysis",
    investment_calculator: "investment_calculator",
    comp_analysis: "comp_analysis",
    deal_scoring: "deal_scoring",
    performance_insights: "performance_insights",
    delinquency_check: "delinquency_check",
  };

  return intentToAction[intent] || null;
}

export function getActionForIntent(intentAction: string): SkillAction | null {
  const actionId = mapIntentToAction(intentAction);
  if (!actionId) return null;
  return SKILL_ACTIONS.find(a => a.id === actionId) || null;
}
