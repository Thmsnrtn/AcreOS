/**
 * Agent identity registry — JC product-call #11.
 *
 * Single source of truth for how internal agents (founder-mode roster)
 * appear in the UI. Replaces four divergent AGENT_COLORS maps and a
 * separate JOB_COLORS map across founder-dashboard.tsx, agent-detail.tsx,
 * components/founder/*, and trust-language.ts. Each agent gets:
 *
 *   - letter: brief §1.3 specifies a "simple letter mark beside it"
 *   - tone: one of four existing acr-* semantic tones, so theme switches
 *     re-tint the agent identity automatically (no per-agent hex)
 *   - role: short label ("Analysis", "Customer Success", …)
 *
 * Four tones × ten agents means agents repeat tones. That's intentional
 * — the letter is the recognition primitive; the tone is mood. Trying
 * to give every agent a unique hue stops scaling past ~6 agents and
 * fights the brief's "considered, not loud" framing.
 *
 * Memory rule: customers see Pax only; founder sees the full roster.
 * Pax is included here so customer-facing surfaces can reuse the same
 * letter+tone formatting; persona-architecture decides which surfaces
 * render which agents.
 */

export type AgentTone = "brand" | "pos" | "warn" | "neg";

export interface AgentIdentity {
  letter: string;
  tone: AgentTone;
  role: string;
  friendlyName: string;
}

export const AGENT_IDENTITY: Record<string, AgentIdentity> = {
  // Tones loosely follow function: analysis/strategy → brand, money-making
  // → pos, customer-facing → warn (welcoming/warm), risk/compliance → neg.
  atlas_cto:        { letter: "A", tone: "brand", role: "Analysis",         friendlyName: "Atlas" },
  sophie_csm:       { letter: "S", tone: "warn",  role: "Customer Success", friendlyName: "Sophie" },
  forge_revenue:    { letter: "F", tone: "pos",   role: "Revenue",          friendlyName: "Forge" },
  beacon_marketing: { letter: "B", tone: "warn",  role: "Marketing",        friendlyName: "Beacon" },
  sentinel_devops:  { letter: "N", tone: "neg",   role: "Infrastructure",   friendlyName: "Sentinel" },
  ledger_finance:   { letter: "L", tone: "pos",   role: "Finance",          friendlyName: "Ledger" },
  shield_legal:     { letter: "H", tone: "neg",   role: "Legal",            friendlyName: "Shield" },
  oracle_analytics: { letter: "O", tone: "brand", role: "Analytics",        friendlyName: "Oracle" },
  compass_pm:       { letter: "C", tone: "brand", role: "Product",          friendlyName: "Compass" },
  crucible_qa:      { letter: "Q", tone: "warn",  role: "Quality",          friendlyName: "Crucible" },
  // Customer-facing persona — reuses brand tone so the customer experience
  // feels continuous with AcreOS branding rather than agent-specific.
  pax:              { letter: "P", tone: "brand", role: "Assistant",        friendlyName: "Pax" },
};

const FALLBACK: AgentIdentity = {
  letter: "·",
  tone: "brand",
  role: "Agent",
  friendlyName: "Unknown",
};

/** Look up identity for a codename; returns a quiet fallback for unknowns. */
export function getAgentIdentity(codename: string | null | undefined): AgentIdentity {
  if (!codename) return FALLBACK;
  return AGENT_IDENTITY[codename] ?? FALLBACK;
}

/**
 * Tailwind class for the agent's text color in this tone. Uses the
 * existing acr-* semantic tokens (defined in client/src/index.css) so
 * theme switches re-tint automatically.
 */
export function agentTextClass(codename: string | null | undefined): string {
  const tone = getAgentIdentity(codename).tone;
  switch (tone) {
    case "brand": return "text-acr-brand";
    case "pos":   return "text-acr-pos";
    case "warn":  return "text-acr-warn";
    case "neg":   return "text-acr-neg";
  }
}

/** Tailwind class for a soft tinted background — chips, avatars, badges. */
export function agentBgClass(codename: string | null | undefined): string {
  const tone = getAgentIdentity(codename).tone;
  switch (tone) {
    case "brand": return "bg-acr-brand-soft text-acr-brand-soft-ink";
    case "pos":   return "bg-acr-pos-soft text-acr-pos-soft-ink";
    case "warn":  return "bg-acr-warn-soft text-acr-warn-soft-ink";
    case "neg":   return "bg-acr-neg-soft text-acr-neg-soft-ink";
  }
}

/**
 * Background job → display tone. Jobs are not first-class agents, but the
 * founder dashboard's autonomous-observatory timeline groups runs by job
 * name. Map each job to a sensible semantic tone; default to brand.
 */
const JOB_TONE: Record<string, AgentTone> = {
  finance_agent:      "brand",
  campaign_optimizer: "warn",
  lead_nurturing:     "pos",
  support_brain:      "warn",
  dunning:            "neg",
  external_monitor:   "warn",
  pax:                "brand",
  churn_engine:       "neg",
  founder_briefing:   "pos",
};

export function jobBgClass(jobName: string): string {
  const tone = JOB_TONE[jobName] ?? "brand";
  switch (tone) {
    case "brand": return "bg-acr-brand";
    case "pos":   return "bg-acr-pos";
    case "warn":  return "bg-acr-warn";
    case "neg":   return "bg-acr-neg";
  }
}
