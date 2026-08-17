import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { clientLogger } from "@/lib/clientLogger";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, RotateCcw, Compass, Zap, Cog } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Autonomy matrix UI — design-system §7.
 *
 * Per-agent × per-action × thresholds permissions, with progressive
 * disclosure: top-level 4-step scale per agent (Observe / Draft /
 * Execute / Autonomous), expand-to-reveal per-action overrides, time
 * guardrails section.
 *
 * Phase D will gate this surface behind `feature.autonomy-matrix:
 * founder-only` (design-system §8.4) until UX polish complete. For
 * now the route is reachable but the matrix exists as a preference,
 * not yet enforcement (agents read at action time progressively as
 * Phase E touches their action paths).
 */

const AUTONOMY_ENDPOINT = "/api/me/autonomy";
const PATCH_DEBOUNCE_MS = 300;

type Level = 0 | 1 | 2 | 3;

const LEVELS: { n: Level; label: string; description: string }[] = [
  { n: 0, label: "Observe", description: "Suggest only — nothing acts without you." },
  { n: 1, label: "Draft", description: "Drafts replies, offers, mailers. You review each." },
  { n: 2, label: "Execute", description: "Acts on routine tasks. Asks above threshold." },
  { n: 3, label: "Autonomous", description: "Runs the function. Daily briefing only." },
];

interface ActionDef {
  id: string;
  label: string;
  description: string;
  thresholdLabel?: string;
  thresholdHint?: string;
}

interface AgentDef {
  id: "atlas" | "pax" | "sophie";
  name: string;
  role: string;
  icon: React.ComponentType<{ className?: string }>;
  actions: ActionDef[];
}

const AGENTS: AgentDef[] = [
  {
    id: "atlas",
    name: "Atlas",
    role: "Analysis",
    icon: Compass,
    actions: [
      { id: "comps", label: "Comps", description: "Pull and weight comparable parcels" },
      { id: "valuations", label: "Valuations", description: "Suggest offer prices and ranges" },
      { id: "parcels", label: "Parcel research", description: "Title, ownership, encumbrances" },
      { id: "market", label: "Market analysis", description: "County trends and signals" },
    ],
  },
  {
    id: "pax",
    name: "Pax",
    role: "Communication",
    icon: Zap,
    actions: [
      { id: "replies", label: "Replies", description: "Draft and send inbound replies" },
      { id: "mailerDraft", label: "Mailer drafting", description: "Compose direct-mail copy" },
      {
        id: "mailerSend",
        label: "Mailer sending",
        description: "Trigger outbound mail batches",
        thresholdLabel: "Auto-send under",
        thresholdHint: "Mailers above this cost pause for approval",
      },
      { id: "outreach", label: "Cold outreach", description: "Initiate first contact" },
    ],
  },
  {
    id: "sophie",
    name: "Sophie",
    role: "Servicing",
    icon: Cog,
    actions: [
      { id: "servicing", label: "Loan servicing", description: "Note schedule + escrow ops" },
      { id: "documents", label: "Document handling", description: "Generate, route, file" },
      {
        id: "paymentFlag",
        label: "Payment flagging",
        description: "Flag late or short payments",
        thresholdLabel: "Auto-flag under",
        thresholdHint: "Larger discrepancies escalate to you",
      },
    ],
  },
];

interface AgentAutonomy {
  level?: Level;
  perAction?: Record<string, Level>;
  thresholdsCents?: Record<string, number>;
}

interface AutonomyConfig {
  atlas?: AgentAutonomy;
  pax?: AgentAutonomy;
  sophie?: AgentAutonomy;
  timeGuards?: {
    pauseStartHour?: number;
    pauseEndHour?: number;
    dailyActionLimit?: number;
  };
}

const DEFAULTS: Required<AutonomyConfig> = {
  atlas: { level: 2, perAction: {}, thresholdsCents: {} },
  pax: { level: 1, perAction: {}, thresholdsCents: { mailerSend: 50000 } }, // $500
  sophie: { level: 1, perAction: {}, thresholdsCents: { paymentFlag: 1000000 } }, // $10K
  timeGuards: { pauseStartHour: 19, pauseEndHour: 8, dailyActionLimit: 200 },
};

function fmtDollars(cents: number): string {
  if (cents === 0) return "$0";
  if (cents % 100 === 0) return `$${(cents / 100).toLocaleString()}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function AutonomyPanel() {
  const [config, setConfig] = useState<AutonomyConfig>(DEFAULTS);
  const patchTimerRef = useRef<number | undefined>(undefined);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(AUTONOMY_ENDPOINT, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data !== "object") return;
        setConfig({ ...DEFAULTS, ...data });
      })
      .catch(() => { /* defaults stay */ });
    return () => { cancelled = true; };
  }, []);

  const update = (next: AutonomyConfig) => {
    setConfig(next);
    if (patchTimerRef.current !== undefined) {
      window.clearTimeout(patchTimerRef.current);
    }
    patchTimerRef.current = window.setTimeout(() => {
      patchTimerRef.current = undefined;
      fetch(AUTONOMY_ENDPOINT, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch((err) => {
        // eslint-disable-next-line no-console
        clientLogger.warn("[autonomy] PATCH failed; local state retained", err);
      });
    }, PATCH_DEBOUNCE_MS);
  };

  const setAgentLevel = (agent: AgentDef["id"], level: Level) => {
    update({ ...config, [agent]: { ...config[agent], level } });
  };

  const setActionLevel = (agent: AgentDef["id"], actionId: string, level: Level) => {
    const current = config[agent] ?? {};
    update({
      ...config,
      [agent]: {
        ...current,
        perAction: { ...current.perAction, [actionId]: level },
      },
    });
  };

  const setThreshold = (agent: AgentDef["id"], actionId: string, cents: number) => {
    const current = config[agent] ?? {};
    update({
      ...config,
      [agent]: {
        ...current,
        thresholdsCents: { ...current.thresholdsCents, [actionId]: cents },
      },
    });
  };

  const setTimeGuards = (next: NonNullable<AutonomyConfig["timeGuards"]>) => {
    update({ ...config, timeGuards: { ...config.timeGuards, ...next } });
  };

  const reset = () => update(DEFAULTS);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Autonomy</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            How much each coworker does on its own. Founder override is always
            available — anything an agent did is in the audit log, and any
            action can be paused, edited, or reversed in one click.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          className="gap-2 text-muted-foreground"
          data-testid="button-reset-autonomy"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Recommended defaults
        </Button>
      </div>

      {AGENTS.map((agent) => {
        const Icon = agent.icon;
        const agentCfg = config[agent.id] ?? {};
        const level: Level = (agentCfg.level ?? DEFAULTS[agent.id].level ?? 1) as Level;
        const isExpanded = !!expanded[agent.id];

        return (
          <Card key={agent.id}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-muted p-2">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">
                    {agent.name} <span className="text-muted-foreground font-normal">· {agent.role}</span>
                  </CardTitle>
                  <CardDescription>
                    {LEVELS[level].description}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 4-step scale */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {LEVELS.map((l) => (
                  <button
                    key={l.n}
                    type="button"
                    onClick={() => setAgentLevel(agent.id, l.n)}
                    aria-pressed={level === l.n}
                    data-testid={`autonomy-${agent.id}-level-${l.n}`}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-card border p-3 text-left transition-colors",
                      level === l.n
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{l.n}</span>
                    <span className="text-sm font-semibold">{l.label}</span>
                  </button>
                ))}
              </div>

              {/* Per-action overrides */}
              <Collapsible
                open={isExpanded}
                onOpenChange={(o) => setExpanded((e) => ({ ...e, [agent.id]: o }))}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between text-muted-foreground"
                    data-testid={`autonomy-${agent.id}-expand`}
                  >
                    Per-action overrides
                    <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-2">
                  {agent.actions.map((action) => {
                    const actLevel: Level = (agentCfg.perAction?.[action.id] ?? level) as Level;
                    const threshold = agentCfg.thresholdsCents?.[action.id] ??
                      DEFAULTS[agent.id].thresholdsCents?.[action.id];
                    return (
                      <div
                        key={action.id}
                        className="rounded-card border border-border p-3 space-y-3"
                        data-testid={`autonomy-action-${agent.id}-${action.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{action.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {action.description}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {LEVELS.map((l) => (
                              <button
                                key={l.n}
                                type="button"
                                onClick={() => setActionLevel(agent.id, action.id, l.n)}
                                aria-label={`Set ${action.label} to ${l.label}`}
                                aria-pressed={actLevel === l.n}
                                className={cn(
                                  "w-8 h-8 rounded-md border text-xs font-mono transition-colors",
                                  actLevel === l.n
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:border-primary/40",
                                )}
                                data-testid={`autonomy-${agent.id}-${action.id}-level-${l.n}`}
                              >
                                {l.n}
                              </button>
                            ))}
                          </div>
                        </div>
                        {action.thresholdLabel && (
                          <div className="flex items-center gap-3 pl-3 border-l-2 border-border/60">
                            <Label
                              htmlFor={`threshold-${agent.id}-${action.id}`}
                              className="text-xs text-muted-foreground whitespace-nowrap"
                            >
                              {action.thresholdLabel}
                            </Label>
                            <Input
                              id={`threshold-${agent.id}-${action.id}`}
                              type="text"
                              inputMode="decimal"
                              defaultValue={threshold != null ? fmtDollars(threshold) : ""}
                              onBlur={(e) => {
                                const cents = parseDollars(e.currentTarget.value);
                                if (cents !== null) setThreshold(agent.id, action.id, cents);
                              }}
                              className="h-8 max-w-[140px] tabular-nums"
                              data-testid={`autonomy-threshold-${agent.id}-${action.id}`}
                            />
                            {action.thresholdHint && (
                              <span className="text-xs text-muted-foreground">
                                {action.thresholdHint}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        );
      })}

      {/* Time guards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time guardrails</CardTitle>
          <CardDescription>
            Apply to all agents. Pause window stops outbound communications;
            daily limit caps how many actions any agent can take in a calendar day.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Label htmlFor="pause-toggle" className="text-sm font-medium">
                Pause outbound communications overnight
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Agents won't send mailers, emails, or SMS during the window.
              </p>
            </div>
            <Switch
              id="pause-toggle"
              checked={config.timeGuards?.pauseStartHour != null && config.timeGuards?.pauseEndHour != null}
              onCheckedChange={(on) =>
                setTimeGuards(on
                  ? { pauseStartHour: 19, pauseEndHour: 8 }
                  : { pauseStartHour: undefined, pauseEndHour: undefined })
              }
              data-testid="switch-time-pause"
            />
          </div>

          {config.timeGuards?.pauseStartHour != null && (
            <div className="grid grid-cols-2 gap-4 max-w-sm">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="autonomy-pause-from">Pause from</Label>
                <Input
                  id="autonomy-pause-from"
                  type="number"
                  min={0}
                  max={23}
                  value={config.timeGuards.pauseStartHour}
                  onChange={(e) => setTimeGuards({ pauseStartHour: Math.max(0, Math.min(23, Number(e.target.value))) })}
                  data-testid="input-pause-start"
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="autonomy-pause-until">Pause until</Label>
                <Input
                  id="autonomy-pause-until"
                  type="number"
                  min={0}
                  max={23}
                  value={config.timeGuards.pauseEndHour}
                  onChange={(e) => setTimeGuards({ pauseEndHour: Math.max(0, Math.min(23, Number(e.target.value))) })}
                  data-testid="input-pause-end"
                  className="tabular-nums"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5 max-w-sm">
            <Label className="text-xs text-muted-foreground" htmlFor="autonomy-daily-limit">Daily action limit per agent</Label>
            <Input
              id="autonomy-daily-limit"
              type="number"
              min={0}
              max={10000}
              value={config.timeGuards?.dailyActionLimit ?? DEFAULTS.timeGuards.dailyActionLimit}
              onChange={(e) => setTimeGuards({ dailyActionLimit: Math.max(0, Math.min(10000, Number(e.target.value))) })}
              data-testid="input-daily-limit"
              className="tabular-nums"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
