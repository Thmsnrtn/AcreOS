/**
 * Vertical profiles — included with every plan (founder decision 2026-10-18).
 *
 * Verticals are selectable profiles that tailor AcreOS to how you invest —
 * vocabulary, workflows, tooling. They are NEVER priced: a customer's
 * subscription price is determined ONLY by tier (Starter/Pro/Scale).
 * Selecting a vertical is free and writes an org_vertical_packs row via
 * POST /api/verticals/select; deselecting via POST /api/verticals/deselect.
 *
 * Data honesty rules:
 *   - Every vertical comes from GET /api/verticals, which reads
 *     shared/billing/tier-pricing.ts VERTICAL_PACKS. No hardcoded
 *     vertical data here.
 *   - Waitlisted verticals (not production-ready) are SHOWN with their
 *     honest waitlist reason — never hidden. The landing promises these
 *     verticals; hiding them would be a silent broken promise.
 *   - Selected verticals render as Selected.
 *
 * Maturity remains the single selectability gate — this component only
 * REPORTS what the server says; the select route enforces it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Clock, Layers } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useToast } from "@/hooks/use-toast";

export interface VerticalListing {
  key: string;
  name: string;
  tagline: string;
  features: string[];
  businessTypeId: string;
  selectable: boolean;
  /** Plain-words reason when not selectable; null when selectable. */
  waitlistReason: string | null;
  selected: boolean;
}

interface VerticalsResponse {
  authenticated: boolean;
  verticals: VerticalListing[];
}

const VERTICALS_QUERY_KEY = ["/api/verticals"] as const;

function VerticalTileSkeleton() {
  return (
    <Card data-testid="vertical-skeleton">
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-2/3" announce={false} />
        <Skeleton className="h-4 w-full mt-2" announce={false} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" announce={false} />
        <Skeleton className="h-10 w-full" announce={false} />
      </CardContent>
    </Card>
  );
}

export function VerticalSelectSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error, refetch, isRefetching } =
    useQuery<VerticalsResponse>({
      queryKey: [...VERTICALS_QUERY_KEY],
    });

  const select = useMutation({
    mutationFn: async (packKey: string) => {
      const res = await apiRequest("POST", "/api/verticals/select", { packKey });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Couldn't select that vertical");
      }
      return res.json();
    },
    onSuccess: (_result, packKey) => {
      queryClient.invalidateQueries({ queryKey: [...VERTICALS_QUERY_KEY] });
      const name = data?.verticals.find((v) => v.key === packKey)?.name ?? "Vertical";
      toast({
        title: `${name} selected`,
        description: "Your workspace is now tailored to this vertical. Included in your plan — nothing extra was charged.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't select vertical",
        description: `${error.message} — try again in a moment.`,
        variant: "destructive",
      });
    },
  });

  const deselect = useMutation({
    mutationFn: async (packKey: string) => {
      const res = await apiRequest("POST", "/api/verticals/deselect", { packKey });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Couldn't deselect that vertical");
      }
      return res.json();
    },
    onSuccess: (_result, packKey) => {
      queryClient.invalidateQueries({ queryKey: [...VERTICALS_QUERY_KEY] });
      const name = data?.verticals.find((v) => v.key === packKey)?.name ?? "Vertical";
      toast({
        title: `${name} deselected`,
        description: "You can select it again any time.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't deselect vertical",
        description: `${error.message} — try again in a moment.`,
        variant: "destructive",
      });
    },
  });

  const pending = select.isPending || deselect.isPending;

  return (
    <section className="px-6 pb-16" data-testid="vertical-select-section">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-2">Built for your vertical</h2>
        <p className="text-sm text-muted-foreground text-center max-w-2xl mx-auto mb-8">
          Every plan includes every production-ready vertical. Pick the profile
          that matches how you invest — your workspace tailors its vocabulary,
          workflows, and tooling around it. No extra charge, ever: your
          subscription price is set by your plan alone.
        </p>

        {isLoading ? (
          <div
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
            role="status"
            aria-busy="true"
            aria-label="Loading verticals"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <VerticalTileSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
            compact
            title="Couldn't load verticals"
            description="The vertical catalog didn't load. Retry, or come back in a moment."
            testId="vertical-select-error"
          />
        ) : !data || data.verticals.length === 0 ? (
          <EmptyState
            framed
            icon={Layers}
            headline="No verticals to show right now"
            subtitle="The catalog came back empty. That's our fault, not yours — try again in a moment."
            cta={{
              label: "Reload verticals",
              onClick: () => refetch(),
              "data-testid": "vertical-select-empty-reload",
            }}
            actionIcon={null}
            testId="vertical-select-empty"
          />
        ) : (
          <motion.ul
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0 m-0"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
          >
            {data.verticals.map((vertical) => {
              const busy =
                pending &&
                (select.variables === vertical.key || deselect.variables === vertical.key);

              return (
                <motion.li key={vertical.key} variants={staggerItem} className="h-full">
                  <Card
                    className={`h-full flex flex-col ${
                      vertical.selectable ? "" : "border-dashed"
                    }`}
                    data-testid={`vertical-${vertical.key}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{vertical.name}</CardTitle>
                        {vertical.selected ? (
                          <Badge
                            className="shrink-0"
                            data-testid={`vertical-${vertical.key}-selected-badge`}
                          >
                            <Check className="h-3 w-3 mr-1" aria-hidden="true" />
                            Selected
                          </Badge>
                        ) : !vertical.selectable ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0"
                            data-testid={`vertical-${vertical.key}-waitlist-badge`}
                          >
                            <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
                            Waitlist
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="shrink-0"
                            data-testid={`vertical-${vertical.key}-included-badge`}
                          >
                            Included
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{vertical.tagline}</p>
                    </CardHeader>
                    <CardContent className="flex flex-col flex-1 justify-end space-y-3">
                      <ul className="space-y-1.5">
                        {vertical.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2 text-sm">
                            <Check className="h-4 w-4 text-acr-pos flex-shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {vertical.selected ? (
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => deselect.mutate(vertical.key)}
                          disabled={pending}
                          aria-label={`Deselect the ${vertical.name} vertical`}
                          data-testid={`vertical-${vertical.key}-deselect`}
                        >
                          {busy ? "Updating…" : "Selected — tap to remove"}
                        </Button>
                      ) : !vertical.selectable ? (
                        <>
                          {/* Honest waitlist framing — the vertical is visible,
                              the reason is stated, and nothing is gated behind
                              payment. */}
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled
                            aria-label={`${vertical.name} is on the waitlist`}
                            data-testid={`vertical-${vertical.key}-waitlist`}
                          >
                            On the waitlist
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            {vertical.waitlistReason ??
                              "On the waitlist until this vertical is production-ready"}
                          </p>
                        </>
                      ) : !data.authenticated ? (
                        <Button
                          className="w-full"
                          asChild
                          data-testid={`vertical-${vertical.key}-signup`}
                        >
                          <Link href="/auth?mode=register">
                            Get started — it&rsquo;s included
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          onClick={() => select.mutate(vertical.key)}
                          disabled={pending}
                          aria-label={`Select the ${vertical.name} vertical`}
                          data-testid={`vertical-${vertical.key}-select`}
                        >
                          {busy ? "Selecting…" : "Select this vertical"}
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
