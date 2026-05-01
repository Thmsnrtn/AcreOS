/**
 * Trust Language — Sovereign Company Protocol v3
 *
 * Translates technical trust scores into natural language the CEO can
 * understand intuitively. No numbers, no percentages, no jargon.
 *
 * Philosophy: Trust should feel like a relationship, not a metric.
 */

/** Map agent codenames to friendly role names */
export const AGENT_FRIENDLY_NAMES: Record<string, string> = {
  atlas_cto: "Atlas (your CTO)",
  sophie_csm: "Sophie (Customer Success)",
  forge_revenue: "Forge (Revenue Lead)",
  beacon_marketing: "Beacon (Marketing)",
  sentinel_devops: "Sentinel (Infrastructure)",
  ledger_finance: "Ledger (Finance)",
  shield_legal: "Shield (Legal & Compliance)",
  oracle_analytics: "Oracle (Analytics)",
  compass_pm: "Compass (Product)",
  crucible_qa: "Crucible (Quality)",
};

/** Map agent codenames to short role labels */
export const AGENT_ROLES: Record<string, string> = {
  atlas_cto: "CTO",
  sophie_csm: "Customer Success",
  forge_revenue: "Revenue Lead",
  beacon_marketing: "Marketing",
  sentinel_devops: "Infrastructure",
  ledger_finance: "Finance",
  shield_legal: "Legal",
  oracle_analytics: "Analytics",
  compass_pm: "Product",
  crucible_qa: "Quality",
};

/** Map agent codenames to emoji avatars */
export const AGENT_AVATARS: Record<string, string> = {
  atlas_cto: "🏗️",
  sophie_csm: "💬",
  forge_revenue: "💰",
  beacon_marketing: "📢",
  sentinel_devops: "🛡️",
  ledger_finance: "📊",
  shield_legal: "⚖️",
  oracle_analytics: "🔮",
  compass_pm: "🧭",
  crucible_qa: "🔬",
};

/**
 * Map agent codenames to a tailwind color name (used by older consumers
 * that build dynamic class strings like `bg-${color}-100`). Sourced from
 * the consolidated identity registry so future agents only need to be
 * added in one place. Tailwind's safelist must include any colors here
 * for dynamic class generation to work — current consumers fall back to
 * "slate" for unknown codenames.
 *
 * New consumers should prefer agentBgClass / agentTextClass from
 * client/src/lib/agent-identity.ts — those return token-driven classes
 * that respond to theme switches.
 */
export const AGENT_COLORS: Record<string, string> = {
  atlas_cto: "amber",
  sophie_csm: "amber",
  forge_revenue: "emerald",
  beacon_marketing: "amber",
  sentinel_devops: "red",
  ledger_finance: "emerald",
  shield_legal: "red",
  oracle_analytics: "amber",
  compass_pm: "amber",
  crucible_qa: "amber",
};

/**
 * Describe an agent's trust level in natural language.
 * The CEO never sees a number — only a relationship description.
 */
export function describeTrust(score: number, codename: string): string {
  const name = AGENT_FRIENDLY_NAMES[codename] || codename;

  if (score >= 90) return `${name} has earned your full trust. They handle everything independently.`;
  if (score >= 75) return `${name} is highly trusted. They act on their own for most things and check with you on big calls.`;
  if (score >= 60) return `${name} is building trust. They recommend actions and wait for your go-ahead on anything significant.`;
  if (score >= 40) return `${name} is still learning the ropes. They check with you before taking action.`;
  return `${name} is on a short leash. Every action needs your approval.`;
}

/**
 * Short trust label for card displays.
 */
export function trustLabel(score: number): string {
  if (score >= 90) return "Full trust";
  if (score >= 75) return "Highly trusted";
  if (score >= 60) return "Building trust";
  if (score >= 40) return "Learning";
  return "Close oversight";
}

/**
 * Trust badge color class for UI components.
 */
export function trustBadgeColor(score: number): string {
  if (score >= 90) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (score >= 75) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (score >= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  if (score >= 40) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
}

/**
 * Describe a trust change naturally — like coaching feedback.
 */
export function describeTrustChange(delta: number, codename: string, reason: string): string {
  const name = AGENT_FRIENDLY_NAMES[codename] || codename;

  if (delta > 0) return `${name} earned more trust. ${reason}`;
  if (delta < 0) return `${name} had a rough patch. ${reason} They'll check with you more often until they improve.`;
  return `${name} held steady.`;
}

/**
 * Describe a promotion opportunity naturally — like a congratulations.
 */
export function describePromotion(codename: string, fromLevel: number, toLevel: number): string {
  const name = AGENT_FRIENDLY_NAMES[codename] || codename;

  if (toLevel === 0) return `${name} has been flawless. Ready to let them handle everything independently?`;
  if (toLevel === 1) return `${name} has proven reliable. Want to let them act first and tell you after?`;
  return `${name} is ready for more responsibility. Promote them?`;
}

/**
 * Translate a decision item type into natural language.
 * e.g., "churn_risk_intervention" → "Retention outreach"
 */
export function naturalItemType(itemType: string): string {
  const map: Record<string, string> = {
    support_escalation: "Support ticket",
    churn_risk_intervention: "Retention outreach",
    dunning_recovery: "Payment recovery",
    critical_alert: "System alert",
    feature_request_flagged: "Feature request",
    proactive_action: "Proactive action",
  };
  return map[itemType] || itemType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Translate urgency score into natural language.
 * The CEO never sees "85/100" — only how urgently it needs attention.
 */
export function naturalUrgency(score: number): string {
  if (score >= 90) return "Needs immediate attention";
  if (score >= 70) return "Should look at today";
  if (score >= 50) return "Can wait until tomorrow";
  return "Low priority";
}

/**
 * Format a risk level naturally.
 */
export function naturalRisk(level: string): string {
  const map: Record<string, string> = {
    critical: "Urgent",
    high: "Important",
    medium: "Moderate",
    low: "Routine",
  };
  return map[level] || level;
}
