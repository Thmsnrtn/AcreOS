/**
 * useContextProfile — hook wrapper around the server-side investor-type
 * inference. Drives vertical-aware UI: which dashboard widgets to
 * surface, which quick-actions to prioritize, which Pax voice to use,
 * which nav items to hide.
 *
 * Investor types supported today (expand as we onboard more verticals):
 *   wholesaler          — volume buyer/seller focus
 *   note_investor       — seller-financing, cash flow, borrower portal
 *   fix_and_flip        — acquisition + exit pricing, timeline tracking
 *   portfolio_builder   — long-term holds, optimizer, cash flow
 *   auction_hunter      — distress + auto-bid rules
 *   developer           — zoning, entitlement, subdivision
 *   new_investor        — education-first, guided workflows
 *
 * The backend infers the type from the org's actual data signals (lead
 * volume, deal mix, note count, campaign cadence, etc.) so no setup
 * step is required — the platform self-tunes. Users can still override
 * via POST /api/intelligence/context-profile/refresh after onboarding.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

export type InvestorType =
  | "wholesaler"
  | "note_investor"
  | "fix_and_flip"
  | "portfolio_builder"
  | "auction_hunter"
  | "developer"
  | "new_investor";

export interface DashboardWidget {
  id: string;
  title: string;
  priority: number;
  reason: string;
}

export interface QuickAction {
  label: string;
  path: string;
  icon: string;
  reason: string;
}

export interface ContextProfile {
  organizationId: number;
  investorType: InvestorType;
  experienceLevel: "beginner" | "intermediate" | "advanced";
  primaryFocus: string[];
  suggestedModules: string[];
  dashboardWidgets: DashboardWidget[];
  quickActions: QuickAction[];
  detectedAt: string;
}

/** Display labels for investor types — use in UI strings. */
export const INVESTOR_LABELS: Record<InvestorType, string> = {
  wholesaler: "Wholesaler",
  note_investor: "Note Investor",
  fix_and_flip: "Fix & Flip",
  portfolio_builder: "Portfolio Builder",
  auction_hunter: "Auction Hunter",
  developer: "Developer",
  new_investor: "New Investor",
};

/**
 * "How does Pax address you?" — used in system prompts and UI copy.
 * Default assumes land investing (the launch vertical), but expansion
 * verticals each get their own noun so a Wholesaler isn't called a
 * Land Investor and vice versa.
 */
export const INVESTOR_NOUN: Record<InvestorType, string> = {
  wholesaler: "Wholesaler",
  note_investor: "Note Investor",
  fix_and_flip: "Fix-and-Flipper",
  portfolio_builder: "Portfolio Builder",
  auction_hunter: "Auction Hunter",
  developer: "Developer",
  new_investor: "Land Investor",
};

export function useContextProfile() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading, isError } = useQuery<{ profile: ContextProfile }>({
    queryKey: ["/api/intelligence/context-profile"],
    enabled: isAuthenticated,
    staleTime: 6 * 60 * 60 * 1000, // matches server's 6h cache
  });

  const profile = data?.profile ?? null;
  const investorType: InvestorType = profile?.investorType ?? "new_investor";

  return {
    profile,
    investorType,
    label: INVESTOR_LABELS[investorType],
    noun: INVESTOR_NOUN[investorType],
    isLoading: isAuthenticated && isLoading,
    isError,
  };
}
