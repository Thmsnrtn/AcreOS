import { useOrganization } from "@/hooks/use-organization";
import { useContextProfile } from "@/hooks/use-context-profile";
import { resolveHiddenRoutes, type OrgInvestorType } from "@/lib/sidebar-hidden-routes";

/**
 * The routes this account's persona hides, from the same three axes the
 * sidebar reads (layout-sidebar.tsx) — so an in-page section strip never
 * offers a route the sidebar would hide.
 */
export function useHiddenRoutes(): string[] {
  const { data: organization } = useOrganization();
  const { investorType } = useContextProfile();
  const businessType = (organization?.onboardingData as { businessType?: string } | undefined)?.businessType;
  const orgInvestorType = ((organization as { investorType?: string } | undefined)?.investorType ?? "land") as OrgInvestorType;
  return resolveHiddenRoutes({ businessType, detectedInvestorType: investorType, orgInvestorType });
}
