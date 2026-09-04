/**
 * Welcome-back surface (Renoir §1-§2).
 *
 * The destination of the reactivation deep-link in our post-cancel
 * win-back emails. The link arrives signed (?t=<token>); the user is
 * already authenticated by the time they hit this route, so the token
 * is informational — it tells the page which org context to render —
 * not a primary auth check (the API is gated by Clerk + org middleware).
 *
 * The page composes data from /api/subscription/reactivation-context
 * (shipped in Wave 6) into four sections:
 *
 *   1. Hero — "Welcome back, {name}." + tenure callout
 *   2. What's new since you left — pulled from customer-changelog.ts,
 *      filtered server-side to entries on/after cancellationDate
 *   3. Pre-filled checkout — restores their last plan + grandfathered
 *      price if available; CTA routes to checkout
 *   4. Optional 1-question survey: "Why are you back?"
 *
 * Editorial: tone is warm but not gushing. The user already chose to
 * click — we don't need to oversell.
 */

import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, Plus, Heart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { usePageMeta } from "@/hooks/use-document-title";

interface WhatsNewItem {
  date: string;
  type: "added" | "improved";
  title: string;
  body: string;
}

interface ReactivationContext {
  lastPlan: {
    tier: string;
    billingInterval: "monthly" | "yearly";
    monthlyPriceCents: number;
    lastChargedAt: string | null;
  };
  tenureDays: number;
  grandfatheredPriceAvailable: boolean;
  whatsNew: {
    sinceDate: string | null;
    items: WhatsNewItem[];
  };
  cancellationReason?: string;
}

const RETURN_REASONS: Array<{ value: string; label: string }> = [
  { value: "missed_features", label: "I missed the workflow / features" },
  { value: "tried_alt_didnt_work", label: "Tried something else, didn't work out" },
  { value: "new_project", label: "Starting a new project / portfolio" },
  { value: "team_decision", label: "My team / partners asked me to come back" },
  { value: "fixed_blocker", label: "The thing that was blocking me is fixed" },
  { value: "other", label: "Something else" },
];

function formatTenure(days: number): string {
  if (days < 1) return "less than a day";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = (days / 365).toFixed(1);
  return `${years} years`;
}

function formatPrice(cents: number): string {
  if (!cents) return "$0";
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function tierLabel(tier: string): string {
  const v = tier.toLowerCase();
  if (v === "starter" || v === "solo") return "Starter";
  if (v === "pro" || v === "operator") return "Pro";
  if (v === "scale" || v === "empire") return "Scale";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function WelcomeBackPage() {
  usePageMeta(
    "Welcome back",
    "Pick up where you left off. Your data, your plan, and what's shipped since you stepped away.",
  );

  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [submittedReason, setSubmittedReason] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<ReactivationContext>({
    queryKey: ["/api/subscription/reactivation-context"],
    staleTime: 60_000,
    retry: 1,
  });

  const firstName = useMemo(() => {
    if (!user) return null;
    const u = user as { firstName?: string | null; email?: string | null };
    if (u.firstName) return u.firstName;
    if (u.email) return u.email.split("@")[0];
    return null;
  }, [user]);

  const tenureLabel = data ? formatTenure(data.tenureDays) : null;

  const handleReasonSelect = async (value: string) => {
    setSubmittedReason(value);
    // Best-effort post — failures shouldn't block the user from
    // continuing to checkout. The signal is nice-to-have, not load-
    // bearing.
    try {
      // unchecked-mutation: reactivation survey signal, already documented best-effort above. Nothing in the UI claims it was recorded and it must not block checkout.
      await fetch("/api/subscription/reactivation-survey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnReason: value }),
      });
    } catch {
      // intentionally swallow — see comment above
    }
  };

  const handleResubscribe = () => {
    if (!data) return;
    // Canonical upgrade deep-link (same pattern as the limit-toast upsell):
    // /pricing#<tier> preselects the plan. There is no client-side /checkout
    // route — the previous target 404'd inside the SPA — and price is always
    // resolved server-side at checkout (a client-passed priceCents must never
    // drive billing; grandfathered pricing is applied by the server from the
    // subscription history).
    const params = new URLSearchParams({
      interval: data.lastPlan.billingInterval,
      from: "welcome_back",
    });
    navigate(`/pricing?${params.toString()}#${data.lastPlan.tier}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="max-w-3xl mx-auto px-6 py-12 space-y-8" id="main">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <h1 className="text-2xl font-semibold">Welcome back to AcreOS</h1>
            <p className="text-muted-foreground">
              We couldn't load your reactivation context right now. Try again
              in a moment, or jump straight to your dashboard.
            </p>
            <div className="flex justify-center gap-2">
              <Button asChild variant="outline">
                <Link href="/">Home</Link>
              </Button>
              <Button asChild>
                <Link href="/today">Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-surface-chrome backdrop-blur sticky top-0 z-overlay">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-11 py-1"
            aria-label="Back to AcreOS home"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="font-semibold">AcreOS</span>
          </Link>
        </div>
      </nav>

      <main id="main" className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        {/* Hero */}
        <section className="space-y-3">
          <Badge variant="secondary" className="rounded-full">
            <Heart className="h-3 w-3 mr-1.5" aria-hidden="true" />
            Welcome back
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight">
            Welcome back{firstName ? `, ${firstName}` : ""}.
          </h1>
          {tenureLabel && data.tenureDays > 0 ? (
            <p className="text-lg text-muted-foreground">
              You were with us for {tenureLabel}. Your data's still here.
            </p>
          ) : (
            <p className="text-lg text-muted-foreground">
              Your data's still here. Pick up right where you left off.
            </p>
          )}
        </section>

        {/* What's new since you left */}
        {data.whatsNew.items.length > 0 && (
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
                  What's new since you left
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {data.whatsNew.items.slice(0, 8).map((item, idx) => (
                    <li key={`${item.date}-${idx}`} className="flex gap-3">
                      <div
                        className={`mt-1 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
                          item.type === "added"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary text-secondary-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        {item.type === "added" ? (
                          <Plus className="h-3 w-3" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.body}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="pt-2">
                  {/* TODO(tsc): Button has no "link" variant (button.tsx is outside
                      this bucket). Using "ghost" + px-0 + underline to mimic a text link. */}
                  <Button asChild variant="ghost" className="px-0 underline underline-offset-4 hover:bg-transparent">
                    <Link href="/changelog">See the full changelog →</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Pre-filled checkout */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle>Resubscribe — your previous plan is ready</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-2xl font-semibold">
                    {tierLabel(data.lastPlan.tier)}
                    <span className="text-muted-foreground font-normal text-base ml-2">
                      ({data.lastPlan.billingInterval})
                    </span>
                  </div>
                  <div className="text-muted-foreground text-sm mt-1">
                    {data.lastPlan.lastChargedAt
                      ? `Your plan when you left.`
                      : `The plan we'll start you on.`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">
                    {formatPrice(data.lastPlan.monthlyPriceCents)}
                    <span className="text-base text-muted-foreground font-normal">
                      /mo
                    </span>
                  </div>
                  {data.grandfatheredPriceAvailable ? (
                    <Badge variant="outline" className="mt-1">
                      Grandfathered price honored
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Button
                size="lg"
                className="w-full"
                onClick={handleResubscribe}
                aria-label={`Resubscribe at ${formatPrice(data.lastPlan.monthlyPriceCents)} per month`}
              >
                Resubscribe at {formatPrice(data.lastPlan.monthlyPriceCents)}/mo
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Cancel any time, no questions asked. Your data stays put.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Optional 1-question survey */}
        {!submittedReason ? (
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Quick one — why are you back? <span className="text-muted-foreground font-normal">(optional)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {RETURN_REASONS.map((r) => (
                    <Button
                      key={r.value}
                      variant="outline"
                      size="sm"
                      onClick={() => handleReasonSelect(r.value)}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        ) : (
          <section>
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                Thanks — that's genuinely useful. See you on the inside.
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}
