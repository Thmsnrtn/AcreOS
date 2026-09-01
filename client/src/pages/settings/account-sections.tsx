/**
 * Settings → Account sections (Refer & earn, Privacy & data rights) —
 * extracted from the settings.tsx monolith (T3 census W1-2). Behavior and
 * test ids preserved; loading states upgraded to content-shaped Skeletons
 * and query failures now render QueryErrorState with retry.
 *
 * The Privacy section is a THREE-LINE re-export of the component the
 * `/settings/privacy` route renders. It was 257 lines of near-duplicate until
 * 2026-08-20 — see the note on `PrivacyDataSettings` at the bottom, and ledger
 * 48, for why a second copy of a GDPR control is the condition rather than the
 * accident.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { usd } from "@/lib/format";
import {
  Gift,
  Link2,
  Users,
  CheckCircle2,
  Coins,
  Wallet,
} from "lucide-react";
import { Verbs } from "@/lib/labels";
import { PrivacyDataRights } from "@/pages/privacy-settings";

// ── Referral Settings ──────────────────────────────────────────────────────

export function ReferralSettings() {
  const { toast } = useToast();
  const appUrl = typeof window !== "undefined" ? window.location.origin : "https://app.acreos.io";

  const codeQuery = useQuery<{ code: string }>({
    queryKey: ["/api/referral/code"],
    queryFn: async () => {
      const res = await fetch("/api/referral/code", { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
  });

  const statsQuery = useQuery<{ signups: number; conversions: number; creditsEarned: number; creditBalance: number }>({
    queryKey: ["/api/referral/stats"],
    queryFn: async () => {
      const res = await fetch("/api/referral/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
  });

  const referralLink = codeQuery.data?.code
    ? `${appUrl}/?ref=${codeQuery.data.code}`
    : "";

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      toast({ title: "Referral link copied to clipboard" });
    });
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5" aria-hidden="true" />
            Refer &amp; earn
          </CardTitle>
          <CardDescription>
            Give a month, get a month. Their first month is on us when they become a paying subscriber — and you earn a $49 account credit once they've been aboard 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Offer callout */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-start gap-3">
            <Gift className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Give a month, get a month</p>
              <p className="text-xs text-muted-foreground">
                When someone signs up with your code and becomes a paying subscriber, they get a $49 account
                credit — their first month, on us. Once they've stayed aboard 30 days, you get a $49 credit
                too ($98 if they chose annual billing), applied to your next invoice. Bonus credits land at
                your 5th and 10th successful referral. Credits apply to AcreOS invoices only.
              </p>
            </div>
          </div>

          {/* Referral link */}
          <div className="space-y-2">
            <Label htmlFor="input-referral-link" className="text-sm font-medium">Your referral link</Label>
            {codeQuery.isLoading ? (
              <Skeleton className="h-10 w-full" announceText="Loading your referral link" />
            ) : codeQuery.isError ? (
              <QueryErrorState
                error={codeQuery.error as Error}
                onRetry={() => codeQuery.refetch()}
                isRetrying={codeQuery.isRefetching}
                compact
                title="Couldn't load your referral link"
                description="Your referral credits are unchanged — this is just a display issue."
                testId="error-referral-link"
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  id="input-referral-link"
                  readOnly
                  value={referralLink}
                  className="font-mono text-sm"
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="input-referral-link"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyLink}
                  className="shrink-0 min-h-11 pointer-fine:sm:min-h-9"
                  aria-label="Copy referral link to clipboard"
                >
                  <Link2 className="w-4 h-4 mr-1" aria-hidden="true" />
                  {Verbs.COPY}
                </Button>
              </div>
            )}
          </div>

          {/* Stats */}
          {statsQuery.isError ? (
            <QueryErrorState
              error={statsQuery.error as Error}
              onRetry={() => statsQuery.refetch()}
              isRetrying={statsQuery.isRefetching}
              compact
              title="Couldn't load your referral stats"
              testId="error-referral-stats"
            />
          ) : (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Signups", value: stats?.signups ?? 0, icon: Users, isMoney: false },
                { label: "Converted", value: stats?.conversions ?? 0, icon: CheckCircle2, isMoney: false },
                { label: "Credits earned", value: stats ? usd(stats.creditsEarned / 100, { noCents: true }) : "$0", icon: Coins, isMoney: true },
                { label: "Available credit", value: stats ? usd(stats.creditBalance / 100, { noCents: true }) : "$0", icon: Wallet, isMoney: true },
              ].map(({ label, value, icon: Icon }, i) => (
                <div key={label} className="rounded-card border border-border/60 bg-card p-4 space-y-1 text-center">
                  <Icon className="w-4 h-4 text-primary mx-auto" aria-hidden="true" />
                  {statsQuery.isLoading ? (
                    <Skeleton
                      className="h-8 w-12 mx-auto"
                      announce={i === 0}
                      announceText="Loading referral stats"
                    />
                  ) : (
                    <dd className="text-2xl font-bold tabular-nums">{value}</dd>
                  )}
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          )}

          <p className="text-xs text-muted-foreground">
            Credits are applied automatically to your subscription invoice once a referee has been a paying subscriber for 30+ days.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Privacy & Data Settings ─────────────────────────────────────────────────

/**
 * The Privacy section of Settings — the SAME component the `/settings/privacy`
 * route renders, not a second copy of it.
 *
 * It used to be 257 lines of near-duplicate: its own export mutation, its own
 * delete mutation, its own confirm-text state, its own "already deleted" branch,
 * against the same two endpoints as `pages/privacy-settings.tsx`. That copy is
 * the one that shipped the defect ledger 41 closed — it called `res.blob()` on a
 * 202 QUEUE RECEIPT, saved `{requestId, status:"queued"}` as a file named after
 * the user's personal data, toasted "Account anonymized" and signed them out,
 * all while the sibling page had been honest the whole time.
 *
 * Making the copy match was the right emergency fix and the wrong resting state.
 * Two implementations of a legally consequential control is the CONDITION that
 * produced the lie; "keep them in sync" is a promise nobody keeps, and the test
 * that existed to hold them in sync was titled "both privacy surfaces agree, in
 * source" — a chore, where "there is one surface" is a property.
 */
export function PrivacyDataSettings() {
  return <PrivacyDataRights variant="section" />;
}
