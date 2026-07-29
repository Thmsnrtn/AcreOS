/**
 * Vertical-pack commerce surface (wave V1 — founder ruling #11, 2026-07-28).
 *
 * The pack substrate (VERTICAL_PACKS pricing, POST /api/billing/packs/checkout,
 * org_vertical_packs activation via webhook) existed with ZERO client surface —
 * "The substrate is there; the surface is not"
 * (docs/internal/pricing/alternatives-2026-06-06.md). This section renders it.
 *
 * Data honesty rules:
 *   - Every price comes from GET /api/billing/packs, which reads
 *     shared/billing/tier-pricing.ts VERTICAL_PACKS. No hardcoded prices here.
 *   - Waitlisted packs (vertical not production-ready) are SHOWN with their
 *     honest waitlist reason — never hidden. The landing promises these
 *     verticals; hiding them would be a silent broken promise.
 *   - A purchasable pack whose Stripe price env vars are missing renders an
 *     honest "Purchase not yet enabled" disabled state instead of a live
 *     button that 503s.
 *   - Owned packs render as Active.
 *
 * Maturity remains the single purchasability gate — this component only
 * REPORTS what the server says; the checkout route enforces it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Clock, Package } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { usd } from "@/lib/format";

export interface VerticalPackListing {
  key: string;
  name: string;
  tagline: string;
  businessTypeId: string;
  /** Whole dollars — served from VERTICAL_PACKS cents, never typed here. */
  priceMonthly: number;
  priceYearly: number;
  purchasable: boolean;
  /** Plain-words reason when not purchasable; null when purchasable. */
  waitlistReason: string | null;
  owned: boolean;
  /** Whether the Stripe price env vars exist per billing interval. */
  stripeConfigured: { monthly: boolean; yearly: boolean };
}

interface VerticalPacksResponse {
  authenticated: boolean;
  packs: VerticalPackListing[];
}

const PACKS_QUERY_KEY = ["/api/billing/packs"] as const;

/**
 * Monthly-equivalent display price for the annual toggle — same rounding as
 * displayMonthlyPrice in pricing-copy.ts so the pack tiles and tier cards
 * can never disagree on how annual math is shown.
 */
function packDisplayMonthly(pack: VerticalPackListing, annual: boolean): number {
  return annual ? Math.round(pack.priceYearly / 12) : pack.priceMonthly;
}

function PackTileSkeleton() {
  return (
    <Card data-testid="vertical-pack-skeleton">
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-2/3" announce={false} />
        <Skeleton className="h-4 w-full mt-2" announce={false} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9 w-24" announce={false} />
        <Skeleton className="h-10 w-full" announce={false} />
      </CardContent>
    </Card>
  );
}

export function VerticalPackSection({ annual }: { annual: boolean }) {
  const queryClient = useQueryClient();
  const interval: "monthly" | "yearly" = annual ? "yearly" : "monthly";

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<VerticalPacksResponse>({
      queryKey: [...PACKS_QUERY_KEY],
    });

  const checkout = useMutation({
    mutationFn: async (vars: { packKey: string; interval: "monthly" | "yearly" }) => {
      const res = await apiRequest("POST", "/api/billing/packs/checkout", vars, {
        idempotent: true,
      });
      return (await res.json()) as { url: string };
    },
    onSuccess: (result) => {
      // Ownership flips via the Stripe webhook after checkout completes —
      // refetch on return (bfcache restore / cancelled checkout) so an
      // already-active pack renders as Active, not as a buy button.
      queryClient.invalidateQueries({ queryKey: [...PACKS_QUERY_KEY] });
      if (result?.url) {
        window.location.href = result.url;
      }
    },
  });

  return (
    <section className="px-6 pb-16" data-testid="vertical-pack-section">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-2">Vertical packs</h2>
        <p className="text-sm text-muted-foreground text-center max-w-2xl mx-auto mb-8">
          Run more than land? Add a vertical on top of any paid plan. Each pack
          is its own subscription — activate any mix, cancel any time. Packs
          still being built are listed on the waitlist; we don&rsquo;t sell
          access to anything before it&rsquo;s production-ready.
        </p>

        {isLoading ? (
          <div
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
            role="status"
            aria-busy="true"
            aria-label="Loading vertical packs"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <PackTileSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
            compact
            title="Couldn't load vertical packs"
            description="The pack catalog didn't load. Retry, or come back in a moment."
            testId="vertical-pack-error"
          />
        ) : !data || data.packs.length === 0 ? (
          <EmptyState
            framed
            icon={Package}
            headline="No packs to show right now"
            subtitle="The pack catalog came back empty. That's our fault, not yours — try again in a moment."
            cta={{
              label: "Reload packs",
              onClick: () => refetch(),
              "data-testid": "vertical-pack-empty-reload",
            }}
            actionIcon={null}
            testId="vertical-pack-empty"
          />
        ) : (
          <motion.ul
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0 m-0"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
          >
            {data.packs.map((pack) => {
              const stripeReady = pack.stripeConfigured[interval];
              const displayMonthly = packDisplayMonthly(pack, annual);
              const isCheckingOut =
                checkout.isPending && checkout.variables?.packKey === pack.key;

              return (
                <motion.li key={pack.key} variants={staggerItem} className="h-full">
                  <Card
                    className={`h-full flex flex-col ${
                      pack.purchasable ? "" : "border-dashed"
                    }`}
                    data-testid={`vertical-pack-${pack.key}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{pack.name}</CardTitle>
                        {pack.owned ? (
                          <Badge
                            className="shrink-0"
                            data-testid={`vertical-pack-${pack.key}-active-badge`}
                          >
                            <Check className="h-3 w-3 mr-1" aria-hidden="true" />
                            Active
                          </Badge>
                        ) : !pack.purchasable ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0"
                            data-testid={`vertical-pack-${pack.key}-waitlist-badge`}
                          >
                            <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
                            Waitlist
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">{pack.tagline}</p>
                    </CardHeader>
                    <CardContent className="flex flex-col flex-1 justify-end space-y-3">
                      <div>
                        <span className="text-3xl font-bold tabular-nums">
                          {usd(displayMonthly, { noCents: true })}
                        </span>
                        <span className="text-muted-foreground text-sm">/mo</span>
                        {annual && (
                          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                            {usd(pack.priceYearly, { noCents: true })}/year
                          </p>
                        )}
                      </div>

                      {pack.owned ? (
                        <Button
                          className="w-full"
                          variant="outline"
                          disabled
                          aria-label={`${pack.name} is active on your plan`}
                          data-testid={`vertical-pack-${pack.key}-owned`}
                        >
                          <Check className="h-4 w-4 mr-2" aria-hidden="true" />
                          Active on your plan
                        </Button>
                      ) : !pack.purchasable ? (
                        <>
                          {/* Honest waitlist framing — the pack is visible,
                              the reason is stated, and nothing is sold. */}
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled
                            aria-label={`${pack.name} is on the waitlist`}
                            data-testid={`vertical-pack-${pack.key}-waitlist`}
                          >
                            On the waitlist
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            {pack.waitlistReason ??
                              "On the waitlist until this vertical is production-ready"}
                          </p>
                        </>
                      ) : !stripeReady ? (
                        <>
                          {/* Purchasable by maturity, but the Stripe price
                              isn't configured — a live button here would
                              503. Say so instead. */}
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled
                            aria-label={`${pack.name} purchase not yet enabled`}
                            data-testid={`vertical-pack-${pack.key}-unconfigured`}
                          >
                            Purchase not yet enabled
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Online checkout for this pack isn&rsquo;t switched on
                            yet. Check back soon.
                          </p>
                        </>
                      ) : !data.authenticated ? (
                        <Button
                          className="w-full"
                          asChild
                          data-testid={`vertical-pack-${pack.key}-signup`}
                        >
                          <Link href="/auth?mode=register">
                            Get started to add this pack
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          onClick={() =>
                            checkout.mutate({ packKey: pack.key, interval })
                          }
                          disabled={checkout.isPending}
                          aria-label={`Add the ${pack.name}`}
                          data-testid={`vertical-pack-${pack.key}-purchase`}
                        >
                          {isCheckingOut ? "Redirecting to checkout…" : "Add pack"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </section>
  );
}
