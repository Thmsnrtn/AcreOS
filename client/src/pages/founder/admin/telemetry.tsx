/**
 * /founder/admin/telemetry — the unified observability instrument.
 *
 * Founder-nav consolidation (F1 slice 2): six separate observability routes
 * (/founder/ai-observatory, /founder/telemetry, /founder/traces,
 * /founder/pax-traces, /founder/pax-calibration, /founder/event-log)
 * collapsed into one tabbed hub under the /founder/admin/* deliberate-
 * instrument namespace, mirroring /founder/admin/costs. Each tab renders the
 * original page's shell-less *Content component verbatim — zero behavior
 * change, one PageShell, one nav entry instead of six.
 *
 * Deep-link a tab with ?tab=<value> (e.g. ?tab=pax-traces) so the command
 * palette and bookmarks can land directly on a sub-view; the retired paths
 * redirect here with the right tab via FOUNDER_LEGACY_REDIRECTS.
 */
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { AiObservatoryContent } from "@/pages/founder-ai-observatory";
import { TelemetryContent } from "@/pages/founder/telemetry";
import { AgentTracesContent } from "@/pages/founder-traces";
import { PaxTracesContent } from "@/pages/founder/pax-traces";
import { PaxCalibrationContent } from "@/pages/founder/pax-calibration";
import { EventLogContent } from "@/pages/founder/event-log";

const TABS = [
  { value: "observatory", label: "AI observatory" },
  { value: "api", label: "API telemetry" },
  { value: "traces", label: "Agent traces" },
  { value: "pax-traces", label: "Pax traces" },
  { value: "calibration", label: "Pax calibration" },
  { value: "events", label: "Event log" },
] as const;

export default function FounderAdminTelemetryPage() {
  useDocumentTitle("Telemetry & traces — AcreOS");
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const initial = TABS.some((t) => t.value === requested) ? requested! : "observatory";

  return (
    <PageShell label="Telemetry & traces">
      <Tabs defaultValue={initial} className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="observatory"><AiObservatoryContent /></TabsContent>
        <TabsContent value="api"><TelemetryContent /></TabsContent>
        <TabsContent value="traces"><AgentTracesContent /></TabsContent>
        <TabsContent value="pax-traces"><PaxTracesContent /></TabsContent>
        <TabsContent value="calibration"><PaxCalibrationContent /></TabsContent>
        <TabsContent value="events"><EventLogContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
