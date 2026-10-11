/**
 * /pricing/founding-member — the founding-member YEARLY offer (W3).
 *
 * Ships closed: behind the offer.founding_member_yearly flag and refused while
 * the founder has not set the plan and the price (pricing is a founder-only
 * hard stop). While closed the server sends no price, so this page cannot show
 * one. No lifetime deal is offered — a yearly subscription only.
 *
 * When open, California's automatic-renewal terms sit next to the consent
 * (Cal. Bus. & Prof. Code § 17602(a)(1)), the buyer must tick that they read
 * them, and checkout records the consent; the acknowledgment e-mail, the
 * 15–45-day renewal reminder and one-click cancel come from the W1 billing path.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useAuth } from "@/hooks/use-auth";

type Availability =
  | { available: true; offer: { tier: string; planName: string; priceYearlyCents: number; currency: string; interval: "year"; termsText: string } }
  | { available: false; reason: string; message: string };

export default function FoundingMemberPage() {
  const { user } = useAuth();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery<Availability>({
    queryKey: ["founding-member-offer"],
    queryFn: async () => {
      const res = await fetch("/api/public/offers/founding-member");
      if (!res.ok) throw new Error(`Couldn't load the offer (${res.status})`);
      return res.json();
    },
  });
  const open = q.data?.available === true ? q.data.offer : null;
  usePageMeta("Founding-member yearly plan", "AcreOS founding-member yearly plan.");
  // Never indexed: the offer is temporary and may be closed.
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex";
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/offers/founding-member/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: ack }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.url !== "string") throw new Error(typeof body?.message === "string" ? body.message : "Checkout could not start.");
      window.location.assign(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout could not start.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background pb-24 lg:pb-0">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Pricing
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        {q.isLoading && <Skeleton className="h-48 w-full rounded-lg" />}
        {q.isError && (
          <QueryErrorState error={q.error instanceof Error ? q.error : null} onRetry={() => q.refetch()} isRetrying={q.isFetching} testId="founding-error" />
        )}
        {q.data && !q.data.available && (
          <EmptyState
            icon={Lock}
            headline="The founding-member offer is not open"
            subtitle={q.data.message}
            cta={{ label: "See current plans", href: "/pricing", "data-testid": "founding-closed-cta" }}
            actionIcon={null}
            testId="founding-closed"
          />
        )}
        {open && (
          <section className="space-y-5 rounded-lg border border-border bg-card p-5" data-testid="founding-open">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Founding member · billed yearly</p>
              <h1 className="mt-1 text-2xl font-bold text-foreground">{open.planName}</h1>
              <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
                {(open.priceYearlyCents / 100).toLocaleString("en-US", { style: "currency", currency: open.currency.toUpperCase() })}
                <span className="text-base font-medium text-muted-foreground"> / year</span>
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-foreground" data-testid="founding-terms">
              {open.termsText}
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="founding-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} />
              <Label htmlFor="founding-ack" className="text-sm leading-snug">
                I have read the automatic-renewal terms above: this plan renews every year until I cancel, and I can cancel
                online in Settings → Billing at any time.
              </Label>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {user ? (
              <Button onClick={checkout} disabled={!ack || busy} data-testid="founding-checkout">
                Continue to secure checkout
              </Button>
            ) : (
              <Button asChild>
                <Link href="/auth?mode=register&utm_source=founding-member&utm_medium=internal&utm_campaign=founding_member_yearly">
                  Create your account to continue
                </Link>
              </Button>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
