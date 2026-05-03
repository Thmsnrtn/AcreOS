/**
 * Strategic Compass — Sovereign Company Protocol v8
 * Living strategy. Switch modes. Everything cascades.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Compass, Rocket, PiggyBank, AlertTriangle, Telescope, Scale, PenLine } from "lucide-react";

const MODE_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  growth: { icon: Rocket, color: "text-acr-pos", bg: "bg-acr-pos-soft dark:bg-acr-pos-soft/20 border-acr-pos-soft", label: "Growth" },
  efficiency: { icon: PiggyBank, color: "text-acr-accent", bg: "bg-acr-accent dark:bg-acr-accent/20 border-acr-accent", label: "Efficiency" },
  crisis: { icon: AlertTriangle, color: "text-acr-neg", bg: "bg-acr-neg-soft dark:bg-acr-neg-soft/20 border-acr-neg-soft", label: "Crisis" },
  exploration: { icon: Telescope, color: "text-acr-brand", bg: "bg-acr-brand-soft dark:bg-acr-brand-soft/20 border-acr-brand-soft", label: "Exploration" },
  balanced: { icon: Scale, color: "text-foreground", bg: "bg-muted dark:bg-acr-bg-sunken/20 border-border", label: "Balanced" },
};

export function StrategicCompass() {
  const queryClient = useQueryClient();
  const [editingNorthStar, setEditingNorthStar] = useState(false);
  const [northStarDraft, setNorthStarDraft] = useState("");

  const { data: compass, isLoading } = useQuery({
    queryKey: ["/api/founder/v8/compass"],
    queryFn: () => apiRequest("GET", "/api/founder/v8/compass").then(r => r.json()),
    refetchInterval: 30000,
  });

  const switchMode = useMutation({
    mutationFn: (mode: string) => apiRequest("POST", "/api/founder/v8/compass/mode", { mode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v8/compass"] }),
  });

  const updateNorthStar = useMutation({
    mutationFn: (ns: string) => apiRequest("POST", "/api/founder/v8/compass/north-star", { northStar: ns }),
    onSuccess: () => { setEditingNorthStar(false); queryClient.invalidateQueries({ queryKey: ["/api/founder/v8/compass"] }); },
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading strategic compass" className="h-40 w-full rounded-xl" />;

  const data = compass as any;
  const currentMode = data?.mode || "balanced";
  const modeStyle = MODE_CONFIG[currentMode] || MODE_CONFIG.balanced;
  const ModeIcon = modeStyle.icon;
  const priorities = (data?.priorities || []) as any[];

  return (
    <Card className={`border ${modeStyle.bg}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={`text-base flex items-center gap-2 ${modeStyle.color}`}>
            <Compass className="h-4 w-4" aria-hidden="true" /> Strategic compass
          </CardTitle>
          <Badge className={`${modeStyle.bg} ${modeStyle.color} border`} aria-label={`Current mode: ${modeStyle.label}`}>
            <ModeIcon className="h-3 w-3 mr-1" aria-hidden="true" /> {modeStyle.label} mode
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* North Star */}
        {editingNorthStar ? (
          <div className="flex gap-2">
            <Input value={northStarDraft} onChange={e => setNorthStarDraft(e.target.value)} className="text-sm h-8" aria-label="North star statement" autoCapitalize="sentences" autoFocus />
            <Button type="button" size="sm" className="h-8 text-xs" onClick={() => updateNorthStar.mutate(northStarDraft)} disabled={updateNorthStar.isPending} aria-busy={updateNorthStar.isPending}>{updateNorthStar.isPending ? "Saving…" : "Save"}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingNorthStar(false)}>Cancel</Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setNorthStarDraft(data?.northStar || ""); setEditingNorthStar(true); }}
            aria-label="Edit north star statement"
            className="flex items-start gap-2 cursor-pointer group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <p className="text-sm font-medium leading-relaxed flex-1 m-0">{data?.northStar || "No north star set."}</p>
            <PenLine className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 mt-1 shrink-0" aria-hidden="true" />
          </button>
        )}

        {/* Priorities */}
        {priorities.length > 0 && (
          <ul aria-label="Strategic priorities" className="flex flex-wrap gap-1.5 list-none p-0 m-0">
            {priorities.slice(0, 5).map((p: any, i: number) => {
              const stars = Math.min(Math.ceil(p.weight / 2), 5);
              return (
                <li key={i}>
                  <Badge variant="outline" className="text-[10px]" aria-label={`Priority ${p.rank}: ${p.priority}, weight ${stars} of 5`}>
                    <span className="tabular-nums">#{p.rank}</span> {p.priority}
                    <span aria-hidden="true" className="ml-1 opacity-50">{"★".repeat(stars)}</span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}

        {/* Mode Switcher */}
        <div role="radiogroup" aria-label="Strategic mode" className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground mr-1" id="mode-switcher-label">Switch:</span>
          {Object.entries(MODE_CONFIG).map(([mode, config]) => {
            const Icon = config.icon;
            return (
              <Button
                key={mode}
                type="button"
                role="radio"
                aria-checked={mode === currentMode}
                size="sm"
                variant={mode === currentMode ? "default" : "ghost"}
                className="h-6 text-[10px] px-2"
                onClick={() => switchMode.mutate(mode)}
                disabled={switchMode.isPending}
                aria-busy={switchMode.isPending}
              >
                <Icon className="h-2.5 w-2.5 mr-0.5" aria-hidden="true" /> {config.label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
