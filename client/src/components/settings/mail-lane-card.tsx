/**
 * Which lane this org's printed mail uses (founder decisions 2026-10-17):
 *
 *   "AcreOS mail — uses purchased credits (N per postcard / M per letter)"
 *   "Your own Lob key — no credits"
 *
 * The numbers come from GET /api/outreach/mail/lane, which prices every spec
 * through the canonical house-mail table (shared/billing/house-mail-pricing.ts)
 * — this component never carries a rate of its own. House mail is paid from
 * PURCHASED credits only, so the card shows that balance and offers "Buy
 * credits" when it cannot pay for a piece. Rendered in Settings → Your
 * provider keys and in the mail send surfaces; it is not a destination of its own.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Printer, KeyRound, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { CreditPurchaseModal } from "@/components/credit-purchase-modal";
import { useMailLane, type MailLaneSummary } from "@/hooks/use-outreach-mail";

const MAIL_SETTINGS_HREF = "/settings?tab=notifications";
const PROVIDER_KEYS_HREF = "/settings/byok";

/**
 * The one-line lane label — exported so the copy is pinned by a test.
 * `showRates: false` is for a send surface that prices pieces itself (the
 * campaign send dialog, whose per-size prices come from its own estimate).
 */
export function mailLaneHeadline(summary: MailLaneSummary, showRates = true): string {
  if (summary.lob.lane === "own_account") return "Your own Lob key — no credits";
  if (!showRates) return "AcreOS mail — uses purchased credits";
  const { postcard, letter } = summary.houseRates;
  return `AcreOS mail — uses purchased credits (${postcard} per postcard / ${letter} per letter)`;
}

/** True when the purchased balance cannot pay for even the cheapest house piece. */
export function purchasedCreditsShort(summary: MailLaneSummary): boolean {
  const cheapest = Math.min(summary.houseRates.postcard, summary.houseRates.letter);
  return summary.purchasedCredits < cheapest;
}

export function MailLaneCard({ compact = false, showRates = true }: { compact?: boolean; showRates?: boolean }) {
  const { data, isLoading, error, refetch, isRefetching } = useMailLane();
  const [buyOpen, setBuyOpen] = useState(false);

  if (isLoading) {
    return (
      <Card data-testid="mail-lane-loading" aria-busy="true">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <QueryErrorState
        error={error instanceof Error ? error : null}
        onRetry={() => void refetch()}
        isRetrying={isRefetching}
        title="Couldn't load how your mail is sent"
        compact
        testId="mail-lane-error"
      />
    );
  }

  if (data.lob.lane === "refused") {
    const needsAddress = data.lob.reason === "no_sender_identity" || data.lob.reason === "sender_identity_unverified";
    return (
      <EmptyState
        icon={ShieldAlert}
        tone="warning"
        headline={needsAddress ? "Verify your return address to use AcreOS mail" : "Printed mail isn't set up yet"}
        subtitle={data.lob.message}
        cta={
          needsAddress
            ? { label: "Open Mail Settings", href: MAIL_SETTINGS_HREF }
            : { label: "Add your own Lob key", href: PROVIDER_KEYS_HREF }
        }
        secondaryCta={needsAddress ? { label: "Use your own Lob key instead", href: PROVIDER_KEYS_HREF } : undefined}
        framed
        testId="mail-lane-refused"
      />
    );
  }

  const own = data.lob.lane === "own_account";
  const Icon = own ? KeyRound : Printer;
  const short = !own && purchasedCreditsShort(data);
  return (
    <Card data-testid="mail-lane-card" data-lane={data.lob.lane}>
      <CardHeader className={compact ? "pb-2" : undefined}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span data-testid="mail-lane-headline">{mailLaneHeadline(data, showRates)}</span>
          <Badge variant={own ? "secondary" : "outline"}>{own ? "Your account" : "AcreOS account"}</Badge>
        </CardTitle>
        <CardDescription>
          {own
            ? "Postcards and letters print on your own Lob account, which bills you directly. AcreOS charges no credits for them."
            : `Postcards and letters print on AcreOS's Lob account, always with your verified return address${
                data.senderIdentity ? ` ("${data.senderIdentity.name}")` : ""
              }. Each piece is paid in advance from credits you purchased — your plan's monthly credits and any bonus credits don't cover printed mail.`}
        </CardDescription>
      </CardHeader>
      {!own && (
        <CardContent className="space-y-3 pt-0 text-sm">
          <p data-testid="mail-lane-purchased">
            Purchased credits available:{" "}
            <span className="font-medium tabular-nums">{data.purchasedCredits.toLocaleString("en-US")}</span>
          </p>
          {showRates && !compact && (
            <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2" aria-label="AcreOS mail prices per piece">
              {data.housePrices.map((p) => (
                <li key={p.key} className="flex justify-between gap-4" data-testid={`mail-lane-price-${p.key}`}>
                  <span>{p.label}</span>
                  <span className="tabular-nums">{p.creditsPerPiece} credits</span>
                </li>
              ))}
            </ul>
          )}
          {short && (
            <div className="flex flex-wrap items-center gap-2" data-testid="mail-lane-short">
              <p className="text-muted-foreground">Not enough purchased credits for a piece yet.</p>
              <Button size="sm" onClick={() => setBuyOpen(true)} data-testid="mail-lane-buy-credits">
                Buy credits
              </Button>
            </div>
          )}
          <CreditPurchaseModal open={buyOpen} onOpenChange={setBuyOpen} />
        </CardContent>
      )}
      {!compact && (
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          <Button asChild variant="outline" size="sm">
            <Link href={PROVIDER_KEYS_HREF}>{own ? "Manage your Lob key" : "Use your own Lob key instead"}</Link>
          </Button>
          {data.ownKeys.postgrid && (
            <p className="text-muted-foreground">Your own PostGrid key is connected too — no credits when it carries a piece.</p>
          )}
          <p className="w-full text-xs text-muted-foreground">
            Email and texts always go out on your own connected accounts — this choice is for printed mail only.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
