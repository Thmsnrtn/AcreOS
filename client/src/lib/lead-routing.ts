/**
 * Lead routing — the one place the client names the rules endpoint, the
 * editor's route, the rule-type words and the scope sentence, so the
 * Settings → Organization card and the editor page (/settings/lead-assignment)
 * cannot drift apart. Both read the rules through `fetchLeadRoutingRules`
 * under the same query key, so they must agree on the cached shape too.
 */
import { apiRequest } from "@/lib/queryClient";

/** The editor page (App.tsx routes it; Settings → Organization links to it). */
export const LEAD_ROUTING_PATH = "/settings/lead-assignment";

/** Owner/admin only on the server (requireAdminOrAbove). */
export const LEAD_ASSIGNMENT_RULES_API = "/api/team-readiness/lead-assignment-rules";

export type LeadRoutingRuleType = "round_robin" | "territory" | "random";

export interface LeadRoutingRule {
  id: number;
  organizationId: number;
  name: string;
  ruleType: LeadRoutingRuleType;
  priority: number;
  territoryFilter?: { states?: string[]; counties?: string[] } | null;
  weightedAssignees?: Array<{ teamMemberId: number; weight: number }> | null;
  isDefault: boolean;
  isActive: boolean;
}

/** C1 legibility: the enum is the API contract; the label is what a person reads. */
export const RULE_TYPE_LABEL: Record<LeadRoutingRuleType, string> = {
  round_robin: "Take turns",
  territory: "By location",
  random: "Random (weighted)",
};

/**
 * Where the rules run. Only POST /api/leads — the Leads page's Add lead form —
 * calls the assigner (server/services/leadAssigner.ts). Imports, Pax and the
 * other intake paths do not, so the copy says so rather than promising
 * "every new lead".
 */
export const LEAD_ROUTING_SCOPE =
  "Rules run when someone adds a lead from the Leads list. Imported lists and leads created by Pax or other tools are not routed — assign those from the Leads list.";

/** The org's rules in priority order. Throws on an unexpected body rather than showing "no rules". */
export async function fetchLeadRoutingRules(): Promise<LeadRoutingRule[]> {
  const res = await apiRequest("GET", LEAD_ASSIGNMENT_RULES_API);
  const body = (await res.json()) as { rules?: unknown };
  if (!Array.isArray(body.rules)) throw new Error("Lead routing rules came back in an unexpected shape.");
  return body.rules as LeadRoutingRule[];
}
