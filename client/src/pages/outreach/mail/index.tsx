/**
 * /outreach/mail — Pillar 3 customer-facing mail surface.
 *
 * Five tabs: Compose, In-Flight, Results, EDDM map, Mail Credits.
 * Hash-driven state so deep links survive reload + share.
 */

import { useEffect, useState } from "react";
import { BarChart3, Coins, Mail, MapPinned, Send, Truck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";
import ComposeTab from "./compose";
import InFlightTab from "./in-flight";
import EddmTab from "./eddm";
import ResultsTab from "./results";
import CreditsTab from "./credits";

type TabValue = "compose" | "in-flight" | "results" | "eddm" | "credits";

const TABS: TabValue[] = ["compose", "in-flight", "results", "eddm", "credits"];

function readHashTab(): TabValue {
  if (typeof window === "undefined") return "compose";
  const hash = window.location.hash.replace("#", "");
  return (TABS as string[]).includes(hash) ? (hash as TabValue) : "compose";
}

export default function OutreachMailPage() {
  useDocumentTitle("Mail");
  const [tab, setTab] = useState<TabValue>(readHashTab);

  useEffect(() => {
    const onHash = () => setTab(readHashTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const onChange = (next: string) => {
    const v: TabValue = (TABS as string[]).includes(next) ? (next as TabValue) : "compose";
    setTab(v);
    const path = window.location.pathname;
    if (v === "compose") {
      window.history.replaceState(null, "", path);
    } else {
      window.history.replaceState(null, "", `${path}#${v}`);
    }
  };

  return (
    <main
      className="flex-1 flex flex-col overflow-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0"
      data-testid="outreach-mail-page"
    >
      <div className="max-w-7xl mx-auto w-full space-y-6 p-4 md:p-6 flex-1">
        <header className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-card bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground"
            aria-hidden="true"
          >
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Outreach</div>
            <h1 className="text-2xl font-semibold leading-tight" data-testid="text-outreach-mail-title">
              Direct mail
            </h1>
          </div>
        </header>

        <Tabs value={tab} onValueChange={onChange} className="w-full">
          <TabsList
            className="w-full md:w-auto overflow-x-auto flex"
            data-testid="outreach-mail-tabs"
            aria-label="Mail workflow tabs"
          >
            <TabsTrigger value="compose" data-testid="tab-compose" className="flex items-center gap-2">
              <Send className="w-4 h-4" aria-hidden="true" />
              Compose
            </TabsTrigger>
            <TabsTrigger value="in-flight" data-testid="tab-in-flight" className="flex items-center gap-2">
              <Truck className="w-4 h-4" aria-hidden="true" />
              In flight
            </TabsTrigger>
            <TabsTrigger value="results" data-testid="tab-results" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              Results
            </TabsTrigger>
            <TabsTrigger value="eddm" data-testid="tab-eddm" className="flex items-center gap-2">
              <MapPinned className="w-4 h-4" aria-hidden="true" />
              EDDM map
            </TabsTrigger>
            <TabsTrigger value="credits" data-testid="tab-credits" className="flex items-center gap-2">
              <Coins className="w-4 h-4" aria-hidden="true" />
              Mail credits
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="mt-6">
            <ComposeTab />
          </TabsContent>
          <TabsContent value="in-flight" className="mt-6">
            <InFlightTab />
          </TabsContent>
          <TabsContent value="results" className="mt-6">
            <ResultsTab />
          </TabsContent>
          <TabsContent value="eddm" className="mt-6">
            <EddmTab />
          </TabsContent>
          <TabsContent value="credits" className="mt-6">
            <CreditsTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
