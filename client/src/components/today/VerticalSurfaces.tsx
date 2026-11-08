/**
 * Your vertical's tools, on Today — phones only.
 *
 * Below the md breakpoint the sidebar is not rendered and the More drawer is
 * a fixed list, so a tax-lien, landlord, subdivider, wholesaler or
 * creative-finance operator on a phone had no nav path to the pages their
 * vertical exists for (elite-bar review 2026-09-04, "Mobile has no navigation
 * path to ~34 desktop child surfaces"). This section gives them that path
 * behind the Today door, from the registry in lib/today-vertical-surfaces.ts.
 *
 * On tablet/desktop it renders nothing: the sidebar module for the vertical
 * already carries the same links (pinned by todayVerticalSurfacesLinks.test),
 * and the desktop card was removed as banner sprawl on 2026-05-11.
 *
 * Links only — no fetch of its own. It reads the org, persona-hidden routes
 * and feature flags the shell has already loaded, and drops any link the
 * sidebar would hide, so it never offers a page the nav would not.
 */
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOrganization } from "@/hooks/use-organization";
import { useHiddenRoutes } from "@/hooks/use-hidden-routes";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { isRouteHidden } from "@/lib/sidebar-hidden-routes";
import {
  resolveVerticalSurfaces,
  TODAY_HELD_CLUSTERS,
  type VerticalSurfaceCluster,
} from "@/lib/today-vertical-surfaces";

export function VerticalSurfaces() {
  const isMobile = useIsMobile();
  const { data: organization } = useOrganization();
  const hidden = useHiddenRoutes();
  const { isRouteEnabled, isLoading: flagsLoading } = useFeatureFlags();

  // Desktop/tablet: the sidebar module is the path. While the org or flags
  // are unknown, render nothing rather than flash a link the nav may hide.
  if (!isMobile || !organization || flagsLoading) return null;

  const businessType = (organization.onboardingData as { businessType?: string } | null | undefined)
    ?.businessType;
  const investorType = (organization as { investorType?: string | null }).investorType;

  const clusters: VerticalSurfaceCluster[] = resolveVerticalSurfaces({ businessType, investorType })
    .filter((c) => !(c.id in TODAY_HELD_CLUSTERS))
    .map((c) => ({
      ...c,
      links: c.links.filter((l) => !isRouteHidden(l.href, hidden) && isRouteEnabled(l.href.split(/[?#]/)[0])),
    }))
    .filter((c) => c.links.length > 0);

  if (clusters.length === 0) return null;

  return (
    <Card className="rounded-card shadow-acr-1" data-testid="today-vertical-surfaces">
      <CardContent className="p-4 space-y-4">
        {clusters.map((cluster, idx) => (
          <section
            key={cluster.id}
            aria-labelledby={`today-surfaces-${cluster.id}`}
            data-testid={`today-surfaces-${cluster.id}`}
            className={idx > 0 ? "pt-4 border-t border-border/40 space-y-2" : "space-y-2"}
          >
            <div>
              <h2 id={`today-surfaces-${cluster.id}`} className="text-sm font-semibold leading-snug">
                {cluster.title}
              </h2>
              <p className="text-xs text-muted-foreground leading-snug">{cluster.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {cluster.links.map((l) => (
                <Button key={l.href} asChild size="sm" variant="outline" className="min-h-11">
                  <Link href={l.href} data-testid={`today-surfaces-link-${cluster.id}`}>
                    {l.label}
                  </Link>
                </Button>
              ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
