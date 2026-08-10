/**
 * /founder/admin/agents — the unified agent instrument.
 *
 * Founder-nav consolidation (F1 slice 4): five separate routes that all
 * inspect the AGENTS THEMSELVES (/founder/agent-queue, /founder/governance,
 * /founder/trust-graduation, /founder/memory, /founder/scenarios) collapsed
 * into one tabbed hub under the /founder/admin/* deliberate-instrument
 * namespace, mirroring /founder/admin/costs and /founder/admin/telemetry.
 * Each tab renders the original page's shell-less *Content component
 * verbatim — zero behavior change, one PageShell, one nav entry instead of
 * five.
 *
 * These are instruments, not doors: you come here on purpose to look at what
 * the agents proposed, negotiated, earned in autonomy, remember, and
 * rehearse. The daily surface stays The Letter; the four doors are unchanged.
 *
 * Deep-link a tab with ?tab=<value> (e.g. ?tab=scenarios) so the command
 * palette and bookmarks can land directly on a sub-view; the retired paths
 * redirect here with the right tab via FOUNDER_LEGACY_REDIRECTS, preserving
 * any query they carried.
 *
 * /founder/dispatches is deliberately NOT folded in yet: server-side
 * step-away readiness emits it as an href, and that file is outside this
 * change's file set. Folding it in is a one-line follow-up once that href
 * can move with it.
 */
import { useLocation, useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { AgentQueueContent } from "@/pages/founder/agent-queue";
import { GovernanceContent } from "@/pages/founder/governance";
import { TrustGraduationContent } from "@/pages/founder/trust-graduation";
import { MemoryContent } from "@/pages/founder/memory";
import { ScenariosContent } from "@/pages/founder/scenarios";

const TABS = [
  { value: "queue", label: "Proposal queue" },
  { value: "governance", label: "Governance" },
  { value: "trust", label: "Trust graduation" },
  { value: "memory", label: "Memory" },
  { value: "scenarios", label: "Scenarios" },
] as const;

const DEFAULT_TAB = "queue";

export default function FounderAdminAgentsPage() {
  useDocumentTitle("Agents — AcreOS");
  const search = useSearch();
  const [, navigate] = useLocation();
  const requested = new URLSearchParams(search).get("tab");
  // URL-controlled for the same reason as the costs/telemetry/Controls hubs:
  // a tab-pinned link to this SAME pathname (palette, sidebar, a legacy
  // redirect) must switch the visible tab even when the hub is already
  // mounted. An uncontrolled <Tabs defaultValue> reads the URL only at mount,
  // so the address bar and the visible tab silently disagree.
  const tab = TABS.some((t) => t.value === requested) ? requested! : DEFAULT_TAB;

  // Tab switches keep whatever other params the URL carries, so switching
  // tabs never silently drops a filter or an id the founder arrived with.
  function hrefForTab(value: string): string {
    const params = new URLSearchParams(search);
    if (value === DEFAULT_TAB) params.delete("tab");
    else params.set("tab", value);
    const query = params.toString();
    return query ? `/founder/admin/agents?${query}` : "/founder/admin/agents";
  }

  return (
    <PageShell label="Agents">
      <Tabs
        value={tab}
        onValueChange={(v) => navigate(hrefForTab(v), { replace: true })}
        className="w-full"
      >
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="queue"><AgentQueueContent /></TabsContent>
        <TabsContent value="governance"><GovernanceContent /></TabsContent>
        <TabsContent value="trust"><TrustGraduationContent /></TabsContent>
        <TabsContent value="memory"><MemoryContent /></TabsContent>
        <TabsContent value="scenarios"><ScenariosContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
