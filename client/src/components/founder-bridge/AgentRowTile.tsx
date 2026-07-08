/**
 * AgentRowTile — horizontal row of agent health pills.
 *
 * One pill per agent; each shows codename + health %. Below the row,
 * a small mono "last sync · Ns" line ticks every second from a single
 * shared timer (cheap), and a breathing amber LiveDot indicates the
 * stream is active.
 *
 * Apple-grade move: the "last sync" line is the proof that the
 * dashboard is honest — users trust glance-data when they can see it's
 * fresh.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BridgeTile } from "./BridgeTile";
import { LiveDot } from "./LiveDot";

export interface AgentHealth {
  /** Display name, e.g. "Pax". */
  codename: string;
  /** 0-100 — null when the agent hasn't reported recently. */
  healthPct: number | null;
  /** Lowercase status: "active" | "idle" | "down". */
  status: "active" | "idle" | "down";
}

export interface AgentRowTileProps {
  agents: AgentHealth[];
  /** ISO timestamp of the last successful poll. */
  lastSyncAt?: string | Date | null;
  isLoading?: boolean;
  onDiscuss?: () => void;
}

export function AgentRowTile({ agents, lastSyncAt, isLoading, onDiscuss }: AgentRowTileProps) {
  return (
    <BridgeTile label="Agent system status" onDiscuss={onDiscuss} testId="bridge-tile-agents">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-center justify-between">
          <span className="text-caption uppercase tracking-[0.08em] text-muted-foreground">
            Agents
          </span>
          <div className="flex items-center gap-1.5">
            <LiveDot label="Polling agent health" />
            <LastSync at={lastSyncAt} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-muted/30" />
              ))
            : agents.map((a) => <AgentPill key={a.codename} agent={a} />)}
        </div>
      </div>
    </BridgeTile>
  );
}

function AgentPill({ agent }: { agent: AgentHealth }) {
  const isDown = agent.status === "down";
  const isIdle = agent.status === "idle";
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-full border px-3 text-xs tabular-nums",
        "border-acr-line bg-white/[0.02]",
        isDown && "border-acr-bridge-accent/40",
      )}
      data-testid={`bridge-agent-pill-${agent.codename.toLowerCase()}`}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          agent.status === "active" && "bg-acr-pos",
          isIdle && "bg-muted-foreground/60",
          isDown && "bg-acr-bridge-accent",
        )}
      />
      <span className="font-medium text-foreground/90">{agent.codename}</span>
      <span className="font-mono text-muted-foreground">
        {agent.healthPct == null ? "—" : `${agent.healthPct}%`}
      </span>
    </div>
  );
}

/**
 * LastSync — "Ns ago" ticker. Uses a single 1s interval and computes
 * the relative string on each render. Cheap.
 */
function LastSync({ at }: { at?: string | Date | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  if (!at) return <span className="font-mono text-micro text-muted-foreground/60">—</span>;
  const stamp = typeof at === "string" ? new Date(at) : at;
  const ageSec = Math.max(0, Math.round((Date.now() - stamp.getTime()) / 1000));
  const label = ageSec < 60
    ? `${ageSec}s`
    : ageSec < 3_600
      ? `${Math.round(ageSec / 60)}m`
      : `${Math.round(ageSec / 3_600)}h`;
  return (
    <span className="font-mono text-micro text-muted-foreground/80" aria-label={`Last sync ${label} ago`}>
      sync · {label}
    </span>
  );
}
