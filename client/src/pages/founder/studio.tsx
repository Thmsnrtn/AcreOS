/**
 * /founder/studio — every dial in one place.
 *
 * This page is the top-level shell that hosts seven peer tabs:
 *   • Dials       — the generic founder_settings catalog (extracted to
 *                   pages/founder/studio/dials.tsx so the new shaped
 *                   surfaces below can live as siblings).
 *   • Allocation  — the 5-bucket dollar-split policy.
 *   • Credits     — per-action credit weight tuner.
 *   • Triggers    — MRR-keyed revenue ladder editor.
 *   • Routing     — mail/comms/data/ai provider rules.
 *   • BYOK        — per-channel min-tier defaults.
 *   • Infra       — read-only infrastructure dashboard with manual override.
 *
 * Every mutation writes through `setSetting()` so the legacy "Dials" tab
 * reflects the change immediately — there's only one source of truth.
 *
 * Tabs are sticky across navigation via the `tab` URL search-param so the
 * mobile bottom nav can deep-link to /founder/studio?tab=allocation
 * directly.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import {
  Sliders,
  PieChart,
  Coins,
  TrendingUp,
  Network,
  KeyRound,
  Server,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { useDocumentTitle } from "@/hooks/use-document-title";

const DialsTab = lazy(() => import("@/pages/founder/studio/dials"));
const AllocationTab = lazy(() => import("@/pages/founder/studio/allocation"));
const CreditsTab = lazy(() => import("@/pages/founder/studio/credits"));
const TriggersTab = lazy(() => import("@/pages/founder/studio/triggers"));
const RoutingTab = lazy(() => import("@/pages/founder/studio/routing"));
const ByokTab = lazy(() => import("@/pages/founder/studio/byok"));
const InfraTab = lazy(() => import("@/pages/founder/studio/infra"));

const TAB_KEYS = [
  "dials",
  "allocation",
  "credits",
  "triggers",
  "routing",
  "byok",
  "infra",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: Array<{ key: TabKey; label: string; Icon: typeof Sliders }> = [
  { key: "dials", label: "Dials", Icon: Sliders },
  { key: "allocation", label: "Allocation", Icon: PieChart },
  { key: "credits", label: "Credits", Icon: Coins },
  { key: "triggers", label: "Triggers", Icon: TrendingUp },
  { key: "routing", label: "Routing", Icon: Network },
  { key: "byok", label: "BYOK", Icon: KeyRound },
  { key: "infra", label: "Infra", Icon: Server },
];

function readTabFromUrl(): TabKey {
  if (typeof window === "undefined") return "dials";
  const param = new URLSearchParams(window.location.search).get("tab");
  if (param && (TAB_KEYS as readonly string[]).includes(param)) return param as TabKey;
  return "dials";
}

export default function FounderStudioPage() {
  useDocumentTitle("Studio — Founder");
  const [activeTab, setActiveTab] = useState<TabKey>(readTabFromUrl());

  // Keep the URL in sync so reload / share-link preserves the tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (activeTab === "dials") url.searchParams.delete("tab");
    else url.searchParams.set("tab", activeTab);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab]);

  return (
    <PageShell label="Studio">
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Studio</h1>
          <p className="text-sm text-muted-foreground">
            Every dial that controls how the platform runs. Changes take effect on the next
            agent decision without a restart.
          </p>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList className="flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
            {TABS.map(({ key, label, Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map(({ key }) => (
            <TabsContent key={key} value={key} className="mt-4">
              {/* Per-tab boundary: a render crash in one tab must not replace the
                  whole Studio shell (tab strip included) with a full-page 500.
                  resetKey=activeTab clears the error when the founder switches tabs. */}
              <ErrorBoundary
                resetKey={activeTab}
                fallback={
                  <div className="rounded-card border border-acr-warn/40 bg-acr-warn/5 p-6 text-center" role="alert">
                    <p className="text-sm font-medium">This tab hit a snag loading.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The rest of Studio still works — switch tabs and back, or reload the page. We've logged it.
                    </p>
                  </div>
                }
              >
                <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                  {key === "dials" && <DialsTab />}
                  {key === "allocation" && <AllocationTab />}
                  {key === "credits" && <CreditsTab />}
                  {key === "triggers" && <TriggersTab />}
                  {key === "routing" && <RoutingTab />}
                  {key === "byok" && <ByokTab />}
                  {key === "infra" && <InfraTab />}
                </Suspense>
              </ErrorBoundary>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </PageShell>
  );
}
