/**
 * Banner pointing the founder at the two canonical surfaces:
 *   - /founder/now      — daily (what needs you today)
 *   - /founder/cockpit  — monthly (what happened, decide one thing)
 *
 * Rendered on legacy founder surfaces (founder-home, agent-queue,
 * decisions, daily-digest, feed, letter, notifications) so the founder
 * is gently routed to the canonical inbox instead of cross-checking
 * 7+ pages.
 */
import { Link } from "wouter";
import { ArrowRight, Inbox, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function CanonicalSurfacesBanner({
  variant = "default",
}: {
  variant?: "default" | "compact";
}) {
  if (variant === "compact") {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap py-2">
        <span>Filtered view.</span>
        <Link href="/founder/now" className="inline-flex items-center gap-1 underline hover:no-underline">
          <Inbox className="w-3 h-3" aria-hidden="true" />
          Daily inbox: /founder/now
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/founder/cockpit" className="inline-flex items-center gap-1 underline hover:no-underline">
          <Calendar className="w-3 h-3" aria-hidden="true" />
          Monthly check-in: /founder/cockpit
        </Link>
      </div>
    );
  }

  return (
    <Card className="border-acr-brand/30 bg-acr-brand-soft/30">
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <div className="font-semibold">Two surfaces, one rhythm.</div>
          <div className="text-muted-foreground">
            Daily: <code className="text-foreground">/founder/now</code> · Monthly:{" "}
            <code className="text-foreground">/founder/cockpit</code>. Everything else is a filtered drill-in.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/founder/now">
              <Inbox className="w-3 h-3 mr-1" aria-hidden="true" />
              Now <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/founder/cockpit">
              <Calendar className="w-3 h-3 mr-1" aria-hidden="true" />
              Cockpit <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
