/**
 * DemoPage — /demo, the public read-only demo workspace entry (G1.2).
 *
 * Honesty contract (pinned by tests/unit/demoOrg.test.ts on the server side):
 *   - The demo is a READ-ONLY window onto a designated demo organization
 *     seeded with the SAME labeled sample fixtures onboarding uses
 *     (sampleSeeder.ts — every row is sample-marked). Nothing here is
 *     presented as real activity.
 *   - When no demo org is provisioned (DEMO_ORG_ID unset, or the org row
 *     missing), the page says so plainly — it NEVER renders a fake
 *     workspace. Refuse-not-fabricate.
 *   - Every mutating request from a demo session is refused server-side
 *     (403); this page offers no mutation affordances either.
 *   - The signup CTA exits the demo session first (POST /api/demo/exit)
 *     so the read-only block can never bleed into a real signup.
 *
 * This is a public marketing surface, not a customer door — the five-door
 * customer nav is untouched.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-document-title";
import { emitMarketingTouch } from "@/lib/marketing-touch";

interface DemoStatus {
  provisioned: boolean;
  reason?: string;
  vertical?: string;
  verticalLabel?: string;
}

interface DemoWorkspace {
  org: { name: string; vertical: string; verticalLabel: string; simulated: boolean };
  role: "viewer";
  readOnly: true;
  counts: { leads: number; properties: number; deals: number; notes: number };
  leads: Array<{ id: number; name: string; status: string; city: string; state: string }>;
  properties: Array<{ id: number; apn: string; county: string; state: string; status: string; sizeAcres: string }>;
  deals: Array<{ id: number; type: string; status: string; offerAmount: string }>;
  notes: Array<{ id: number; status: string; currentBalance: string; monthlyPayment: string }>;
}

function DemoShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main id="main-content" className="max-w-4xl mx-auto px-4 py-10">
        <nav aria-label="Breadcrumb" className="mb-6">
          <Button asChild variant="ghost" size="sm" data-testid="button-demo-back">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back to AcreOS
            </Link>
          </Button>
        </nav>
        {children}
      </main>
    </div>
  );
}

function NotProvisioned() {
  return (
    <div className="max-w-md mx-auto text-center space-y-4 py-16" data-testid="demo-not-provisioned">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Live demo</p>
      <h1 className="text-2xl font-semibold">The demo isn&apos;t provisioned right now</h1>
      <p className="text-muted-foreground">
        No demo workspace is configured on this deployment, and AcreOS never
        shows an invented one. You can still watch the product run on real
        government data — no signup — or start your own free workspace.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button asChild data-testid="button-demo-fallback-parcel-check">
          <Link href="/tools/parcel-check">Run a free parcel check</Link>
        </Button>
        <Button asChild variant="outline" data-testid="button-demo-fallback-signup">
          <Link href="/auth?mode=register">Start free trial</Link>
        </Button>
      </div>
    </div>
  );
}

export default function DemoPage() {
  usePageMeta(
    "Live demo — read-only, sample data",
    "Browse a read-only AcreOS workspace seeded with labeled sample data. No email, no card — every send is simulated, nothing is real activity.",
  );

  const [entered, setEntered] = useState(false);
  const queryClient = useQueryClient();

  const statusQuery = useQuery<DemoStatus>({
    queryKey: ["/api/demo/status"],
    staleTime: 60_000,
  });

  const enterMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`demo session failed (${res.status})`);
      return (await res.json()) as DemoStatus;
    },
    onSuccess: (data) => {
      if (data.provisioned) {
        void queryClient.invalidateQueries({ queryKey: ["/api/demo/workspace"] });
        setEntered(true);
        emitMarketingTouch({
          surface: "demo:entry",
          eventType: "cta_click",
          payload: { ctaId: "demo_enter" },
        });
      }
    },
  });

  const workspaceQuery = useQuery<DemoWorkspace>({
    queryKey: ["/api/demo/workspace"],
    enabled: entered,
    staleTime: 60_000,
  });

  // Exit the demo session BEFORE navigating to signup so the server-side
  // read-only block on demo sessions can never interfere with a real signup.
  const exitToSignup = async () => {
    try {
      await fetch("/api/demo/exit", { method: "POST", credentials: "include" });
    } catch {
      /* non-fatal — cookie is short-lived anyway */
    }
    window.location.href = "/auth?mode=register";
  };

  if (statusQuery.isLoading) {
    return (
      <DemoShell>
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-40 w-full" />
        </div>
      </DemoShell>
    );
  }

  const status = statusQuery.data;
  if (!status || !status.provisioned) {
    return (
      <DemoShell>
        <NotProvisioned />
      </DemoShell>
    );
  }

  if (!entered) {
    return (
      <DemoShell>
        <div className="max-w-xl mx-auto text-center space-y-5 py-12">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Live demo</p>
          <h1 className="text-3xl font-semibold">
            Browse a working AcreOS workspace
          </h1>
          <p className="text-muted-foreground">
            Read-only, seeded with the same labeled sample data onboarding
            uses{status.verticalLabel ? ` — set up as a ${status.verticalLabel} book` : ""}.
            No email, no card. Every send in this workspace is simulated;
            nothing you see is real customer activity.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              onClick={() => enterMutation.mutate()}
              disabled={enterMutation.isPending}
              data-testid="button-demo-enter"
            >
              <Eye className="w-4 h-4 mr-2" aria-hidden="true" />
              {enterMutation.isPending ? "Opening…" : "Open the demo"}
            </Button>
            <Button variant="outline" size="lg" onClick={exitToSignup} data-testid="button-demo-signup">
              Start your own workspace
            </Button>
          </div>
          {enterMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              Couldn&apos;t open the demo just now — try again, or run a{" "}
              <Link href="/tools/parcel-check" className="underline">free parcel check</Link>{" "}
              instead.
            </p>
          )}
        </div>
      </DemoShell>
    );
  }

  return (
    <DemoShell>
      <div
        className="mb-6 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        data-testid="demo-readonly-banner"
      >
        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          Read-only demo · sample data · sends are simulated. Nothing here is
          real activity.
        </span>
      </div>

      {workspaceQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {workspaceQuery.isError && (
        <p className="text-sm text-destructive" role="alert" data-testid="demo-workspace-error">
          The demo workspace didn&apos;t load. Refresh to retry.
        </p>
      )}

      {workspaceQuery.data && (
        <div className="space-y-8">
          <header>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {workspaceQuery.data.org.verticalLabel} · viewer
            </p>
            <h1 className="text-2xl font-semibold mt-1">
              {workspaceQuery.data.org.name}
            </h1>
          </header>

          <section data-testid="demo-section-counts">
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="list">
              {(
                [
                  ["Leads", workspaceQuery.data.counts.leads],
                  ["Properties", workspaceQuery.data.counts.properties],
                  ["Deals", workspaceQuery.data.counts.deals],
                  ["Notes", workspaceQuery.data.counts.notes],
                ] as const
              ).map(([label, n]) => (
                <li key={label}>
                  <Card className="border-border/50">
                    <CardContent className="p-4">
                      <div className="text-2xl font-semibold">{n}</div>
                      <div className="text-xs text-muted-foreground">{label} (sample)</div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          {workspaceQuery.data.leads.length > 0 && (
            <section data-testid="demo-section-leads">
              <h2 className="text-lg font-semibold mb-3">Pipeline</h2>
              <div className="overflow-x-auto rounded-md border border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/50">
                      <th className="px-3 py-2 font-medium">Lead</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceQuery.data.leads.map((l) => (
                      <tr key={l.id} className="border-b border-border/30 last:border-0">
                        <td className="px-3 py-2">{l.name}</td>
                        <td className="px-3 py-2">{l.status}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {l.city}, {l.state}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {workspaceQuery.data.properties.length > 0 && (
            <section data-testid="demo-section-properties">
              <h2 className="text-lg font-semibold mb-3">Inventory</h2>
              <div className="overflow-x-auto rounded-md border border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/50">
                      <th className="px-3 py-2 font-medium">APN</th>
                      <th className="px-3 py-2 font-medium">County</th>
                      <th className="px-3 py-2 font-medium">Acres</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceQuery.data.properties.map((p) => (
                      <tr key={p.id} className="border-b border-border/30 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{p.apn}</td>
                        <td className="px-3 py-2">
                          {p.county}, {p.state}
                        </td>
                        <td className="px-3 py-2">{p.sizeAcres}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section data-testid="demo-section-cta">
            <Card className="border-border/50">
              <CardContent className="p-6 text-center space-y-3">
                <h2 className="text-xl font-semibold">Ready to run your own book?</h2>
                <p className="text-sm text-muted-foreground">
                  Your workspace starts empty and real — 14 days free, no card.
                </p>
                <Button size="lg" onClick={exitToSignup} data-testid="button-demo-workspace-signup">
                  Start free trial
                </Button>
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </DemoShell>
  );
}
