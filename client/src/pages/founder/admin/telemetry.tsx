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
import { useLocation, useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { AiObservatoryContent } from "@/pages/founder-ai-observatory";
import { TelemetryContent } from "@/pages/founder/telemetry";
import { AgentTracesContent } from "@/pages/founder-traces";
import { PaxTracesContent } from "@/pages/founder/pax-traces";
import { PaxCalibrationContent } from "@/pages/founder/pax-calibration";
import { EventLogContent } from "@/pages/founder/event-log";
// X-A slice 2 — trust/abuse evidence is an INSTRUMENT (read-only observation of
// orgs), so it joins this hub as a tab rather than claiming a route. It adds no
// /founder/* path: the founder route count only shrinks.
import { TrustSignalsContent } from "@/pages/founder/admin/trust-signals";

const TABS = [
  { value: "observatory", label: "AI observatory" },
  { value: "api", label: "API telemetry" },
  { value: "traces", label: "Agent traces" },
  { value: "pax-traces", label: "Pax traces" },
  { value: "calibration", label: "Pax calibration" },
  { value: "events", label: "Event log" },
  { value: "trust", label: "Trust & abuse" },
] as const;

export default function FounderAdminTelemetryPage() {
  useDocumentTitle("Telemetry & traces — AcreOS");
  const search = useSearch();
  const [, navigate] = useLocation();
  const requested = new URLSearchParams(search).get("tab");
  // URL-controlled for the same reason as the Controls hub: tab-pinned links
  // to this SAME pathname (palette, pax-controls) must switch the visible tab
  // even when the hub is already mounted (fleet-6 verifier catch).
  const tab = TABS.some((t) => t.value === requested) ? requested! : "observatory";

  return (
    <PageShell label="Telemetry & traces">
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate(v === "observatory" ? "/founder/admin/telemetry" : `/founder/admin/telemetry?tab=${v}`, {
            replace: true,
          })
        }
        className="w-full"
      >
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
        <TabsContent value="trust"><TrustSignalsContent /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
