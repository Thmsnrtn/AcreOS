/**
 * /founder/bridge — Bridge dashboard.
 *
 * The fused chat-first + modular-telemetry surface that will replace
 * /founder once dogfooded. Gated by founder_settings key
 * `atlas.bridge_enabled` (default OFF). When the flag is off this page
 * renders a one-line "not enabled" notice with a link to flip it from
 * /founder/settings — no redirect, so the URL stays bookmarkable while
 * the redesign is in flight.
 *
 * Layout (filled out across phases):
 *   - Desktop ≥md: 60/40 split — telemetry pane left, fixed Atlas pane right.
 *   - Mobile <md:  single column tiles + peeking Atlas sheet above bottom nav.
 *
 * Apple-design contract:
 *   - Hairline borders, no drop shadows.
 *   - Single amber accent (`#FFB547`) for live indicators + primary CTAs.
 *   - Fraunces for hero numerics; tabular-mono for telemetry; Inter for chat.
 *   - 20pt tile radius (16pt mobile); 24pt internal padding (16pt mobile).
 *   - Reduced motion: all transitions collapse to opacity.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BridgeHeader } from "@/components/founder-bridge/BridgeHeader";
import { HeroMetricTile } from "@/components/founder-bridge/HeroMetricTile";
import { TelemetryTile } from "@/components/founder-bridge/TelemetryTile";
import { ActionQueueTile } from "@/components/founder-bridge/ActionQueueTile";
import { AgentRowTile } from "@/components/founder-bridge/AgentRowTile";
import { BridgeAtlasPane } from "@/components/founder-bridge/BridgeAtlasPane";
import { BridgeAtlasSheet } from "@/components/founder-bridge/BridgeAtlasSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { usd, dollarsCompact, count as fmtCount } from "@/lib/format";

interface BridgePayload {
  generatedAt: string;
  hero: {
    label: "MRR";
    valueCents: number;
    deltaPct: number | null;
    deltaLabel: string;
    sparkline: number[];
  };
  telemetry: {
    activeLeads: { count: number; sparkline: number[] };
    pipeline: { valueCents: number | null; activeDealCount: number };
    runway: { months: number | null; cashOnHandCents: number | null };
  };
  agents: Array<{ codename: string; healthPct: number | null; status: "active" | "idle" | "down" }>;
  agentsLastSyncAt: string;
  actionQueue: Array<{
    id: string;
    title: string;
    meta?: string;
    tone: "neutral" | "info" | "warn";
    href?: string;
    discussPrefill?: string;
  }>;
}

interface SettingRow {
  key: string;
  value: string;
}

interface SettingsResponse {
  settings: SettingRow[];
}

function useBridgeFlag(): { enabled: boolean | null; isLoading: boolean } {
  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["/api/founder/intelligence/settings"],
    staleTime: 30_000,
  });
  const enabled = useMemo(() => {
    if (!data) return null;
    const row = data.settings.find((s) => s.key === "atlas.bridge_enabled");
    return row?.value === "true";
  }, [data]);
  return { enabled, isLoading };
}

export default function FounderBridgePage() {
  useDocumentTitle("Bridge — founder cockpit");
  const { enabled, isLoading } = useBridgeFlag();

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-3 p-6" role="status" aria-live="polite">
          <span className="sr-only">Loading bridge…</span>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-background p-6">
        <Card className="max-w-md">
          <CardContent className="space-y-3 p-6 text-sm">
            <div className="font-medium">Bridge isn't enabled yet.</div>
            <p className="text-muted-foreground">
              The Bridge dashboard is a fused chat + telemetry surface still in dogfood.
              Flip{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                atlas.bridge_enabled
              </code>{" "}
              in{" "}
              <Link href="/founder/settings" className="underline hover:no-underline">
                Founder Settings
              </Link>{" "}
              to turn it on for your account, or head to{" "}
              <Link href="/founder" className="underline hover:no-underline">
                /founder
              </Link>{" "}
              for the current cockpit.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <BridgeSurface />;
}

/**
 * BridgeSurface — the actual layout. Tiles + Atlas pane.
 *
 * Wires the four tile primitives to /api/founder/bridge (single shot),
 * with per-tile refetch intervals that match the surface's "feels
 * live" target without paying for what doesn't move.
 */
function BridgeSurface() {
  const [location] = useLocation();
  const [prefill, setPrefill] = useState<string | undefined>();
  const [streamActive, setStreamActive] = useState(false);
  const { isMobile } = useIsMobile();

  const { data, isLoading } = useQuery<BridgePayload>({
    queryKey: ["/api/founder/bridge"],
    // 30s feels live without paying for what doesn't move. The
    // agent tile's "last sync · Ns" counter advances every second
    // off the local clock so the user perceives sub-second freshness
    // even though the actual fetch is throttled.
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  /**
   * Tile→chat handoff. Each tile exposes either `onDiscuss` (tile-level)
   * or per-row `onDiscussItem` (action queue). Both funnel into the
   * Composer via `prefill`.
   */
  const discuss = (text: string) => setPrefill(text);

  const hero = data?.hero;
  const tele = data?.telemetry;

  const runwayLabel = tele?.runway.months == null ? "—" : String(tele.runway.months);
  const runwayTone: "neutral" | "warn" | "alert" =
    tele?.runway.months == null
      ? "neutral"
      : tele.runway.months < 6
        ? "alert"
        : tele.runway.months < 12
          ? "warn"
          : "neutral";

  const pipelineLabel = tele?.pipeline.valueCents != null
    ? dollarsCompact(tele.pipeline.valueCents)
    : tele?.pipeline.activeDealCount != null
      ? `${tele.pipeline.activeDealCount}`
      : "—";
  const pipelineSuffix = tele?.pipeline.valueCents != null
    ? undefined
    : tele?.pipeline.activeDealCount != null
      ? "deals"
      : undefined;

  return (
    <div
      // Bridge always renders against a deep canvas regardless of the
      // user's site-wide theme. The cockpit metaphor only works on dark
      // — warm-amber accents and hairline borders depend on it. We scope
      // the `dark` class so flipping the system theme doesn't bleed in.
      className="dark flex h-[100dvh] w-full flex-col bg-[#0A0B0D] text-foreground pb-16 md:pb-0"
      data-testid="founder-bridge-surface"
    >
      <BridgeHeader streamActive={streamActive} />
      <div className="grid flex-1 min-h-0 md:grid-cols-[6fr_4fr]">
        {/* ── Telemetry pane (60%) ─────────────────────────────────── */}
        <motion.section
          aria-label="Telemetry"
          // pb-24 on mobile reserves room for the peeking sheet (96pt)
          // so the bottom tile isn't visually covered when scrolled to end.
          className="flex h-full flex-col gap-3 overflow-y-auto p-4 pb-28 md:gap-4 md:p-6 md:pb-6"
          data-testid="bridge-telemetry-pane"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <HeroMetricTile
              label="MRR"
              value={hero ? usd(hero.valueCents / 100, { noCents: true }) : "—"}
              numericValue={hero ? Math.round(hero.valueCents / 100) : undefined}
              deltaPct={hero?.deltaPct ?? undefined}
              deltaLabel={hero?.deltaLabel}
              sparkline={hero?.sparkline}
              isLoading={isLoading}
              onDiscuss={() => discuss("about MRR: ")}
            />
          </motion.div>
          <motion.div
            variants={staggerItem}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4"
          >
            <TelemetryTile
              label="Active leads"
              value={tele ? fmtCount(tele.activeLeads.count) : "—"}
              sparkline={tele?.activeLeads.sparkline}
              isLoading={isLoading}
              onDiscuss={() => discuss("about Active leads: ")}
            />
            <TelemetryTile
              label="Pipeline"
              value={pipelineLabel}
              suffix={pipelineSuffix}
              isLoading={isLoading}
              onDiscuss={() => discuss("about Pipeline: ")}
            />
            <TelemetryTile
              label="Runway"
              value={runwayLabel}
              suffix={tele?.runway.months != null ? "months" : undefined}
              tone={runwayTone}
              isLoading={isLoading}
              onDiscuss={() => discuss("about Runway: ")}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <ActionQueueTile
              items={data?.actionQueue ?? []}
              isLoading={isLoading}
              onDiscussItem={discuss}
              onDiscuss={() => discuss("about my action queue: ")}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <AgentRowTile
              agents={data?.agents ?? []}
              lastSyncAt={data?.agentsLastSyncAt}
              isLoading={isLoading}
              onDiscuss={() => discuss("about agent health: ")}
            />
          </motion.div>
        </motion.section>

        {/* ── Atlas pane (40%, desktop) ─────────────────────────────── */}
        <aside
          aria-label="Atlas"
          className="hidden h-full min-h-0 md:block border-l border-white/[0.06]"
          data-testid="bridge-atlas-pane"
        >
          <BridgeAtlasPane
            prefillMessage={prefill}
            onPrefillConsumed={() => setPrefill(undefined)}
            pageContext={{ currentPath: location }}
            onStreamingChange={setStreamActive}
          />
        </aside>
      </div>

      {/* ── Mobile peeking sheet (only mounts when isMobile) ─────────── */}
      {isMobile && (
        <BridgeAtlasSheet
          prefillMessage={prefill}
          onPrefillConsumed={() => setPrefill(undefined)}
          pageContext={{ currentPath: location }}
          onStreamingChange={setStreamActive}
        />
      )}
    </div>
  );
}
