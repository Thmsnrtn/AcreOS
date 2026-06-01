/**
 * Phase 3 Week 14 — Founder activation funnel UI (Yuna §8, Konstantin §2).
 *
 * Surfaces the % of orgs hitting each canonical activation event in their
 * first 7 / 30 / 90 days. Reads from /api/founder/activation/funnel and
 * /api/founder/activation/recent.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, TrendingUp, Clock } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

type WindowDays = 7 | 30 | 90;

interface FunnelEvent {
  eventName: string;
  orgsHit: number;
  totalOrgs: number;
  pct: number;
}

interface FunnelResponse {
  windowDays: WindowDays;
  totalOrgs: number;
  events: FunnelEvent[];
}

interface ActivationEventRow {
  id: string;
  organizationId: number;
  userId: string | null;
  eventName: string;
  eventValue: Record<string, any> | null;
  occurredAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  org_created: "Org created",
  first_lead_added: "First lead added",
  first_property_added: "First property added",
  first_letter_sent: "First letter sent",
  first_offer_made: "First offer made",
  first_deal_closed: "First deal closed",
  first_payment_processed: "First payment processed",
  first_borrower_payment_received: "First borrower payment received",
  first_1099_generated: "First 1099 generated",
  first_team_member_invited: "First team member invited",
};

function labelFor(eventName: string): string {
  useDocumentTitle("Activation telemetry");

  if (EVENT_LABELS[eventName]) return EVENT_LABELS[eventName];
  const m = eventName.match(/^onboarding_step_(\d+)_completed$/);
  if (m) return `Onboarding step ${m[1]} completed`;
  return eventName;
}

function FunnelBar({ event }: { event: FunnelEvent }) {
  const widthPct = Math.max(0, Math.min(100, event.pct));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{labelFor(event.eventName)}</span>
        <span className="tabular-nums text-muted-foreground">
          {event.orgsHit} / {event.totalOrgs} ({event.pct}%)
        </span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-500"
          style={{ width: `${widthPct}%` }}
          aria-label={`${event.pct}% of orgs hit ${event.eventName}`}
        />
      </div>
    </div>
  );
}

function FunnelSection({ windowDays }: { windowDays: WindowDays }) {
  const { data, isLoading, error } = useQuery<FunnelResponse>({
    queryKey: ["/api/founder/activation/funnel", windowDays],
    queryFn: async () => {
      const r = await fetch(`/api/founder/activation/funnel?window=${windowDays}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load funnel");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-destructive">Failed to load funnel.</p>;
  }

  if (data.totalOrgs === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No organisations on file yet — funnel will populate as orgs are created.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.events.map((e) => (
        <FunnelBar key={e.eventName} event={e} />
      ))}
    </div>
  );
}

function RecentEventsSection() {
  const { data, isLoading } = useQuery<{ events: ActivationEventRow[] }>({
    queryKey: ["/api/founder/activation/recent"],
    queryFn: async () => {
      const r = await fetch("/api/founder/activation/recent", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load recent events");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.events?.length) {
    return <p className="text-sm text-muted-foreground">No activation events yet.</p>;
  }

  return (
    <ul className="divide-y">
      {data.events.map((e) => (
        <li key={e.id} className="flex items-center justify-between py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline">org #{e.organizationId}</Badge>
            <span className="font-medium">{labelFor(e.eventName)}</span>
          </div>
          <span className="tabular-nums text-muted-foreground">
            {new Date(e.occurredAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function FounderActivationPage() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="w-7 h-7" aria-hidden="true" />
            Activation funnel
          </h1>
          <p className="text-muted-foreground mt-1">
            % of organisations hitting each canonical event in their first 7 / 30 / 90 days.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Funnel
                </CardTitle>
                <CardDescription>
                  First-occurrence event per organisation. The bar shows the
                  percentage of orgs that hit the event within the selected
                  window from org creation.
                </CardDescription>
              </div>
              <div className="flex gap-1" role="group" aria-label="Window selection">
                {([7, 30, 90] as const).map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    variant={windowDays === w ? "default" : "outline"}
                    onClick={() => setWindowDays(w)}
                    aria-pressed={windowDays === w}
                  >
                    {w}d
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <FunnelSection windowDays={windowDays} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent events
            </CardTitle>
            <CardDescription>
              Last 50 activation events across all organisations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecentEventsSection />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Wiring status
            </CardTitle>
            <CardDescription>
              Where recordActivationEvent() is currently called from. Missing
              sites surface as 0% in the funnel above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              <li>org_created — getOrCreateOrg middleware + storage.createOrganization</li>
              <li>first_lead_added — POST /api/leads</li>
              <li>first_property_added — POST /api/properties</li>
              <li>first_letter_sent — campaigns send (per-piece)</li>
              <li>first_offer_made — POST /api/deals</li>
              <li>first_deal_closed — PATCH /api/deals (status &rarr; closed)</li>
              <li>first_payment_processed — Stripe checkout.session.completed webhook</li>
              <li>first_borrower_payment_received — POST /api/borrower/verify-payment</li>
              <li>first_1099_generated — GET /api/bookkeeping/1099 (when forms returned)</li>
              <li>first_team_member_invited — POST /api/organization/invitations</li>
              <li>onboarding_step_X_completed — PATCH /api/onboarding/progress</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              TODO: re-fire first_offer_made on the dedicated offers table once
              the offer-letter creation path lands; today it&rsquo;s emitted from
              the deal-creation path.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
