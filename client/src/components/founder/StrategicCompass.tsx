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
  growth: { icon: Rocket, color: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200", label: "Growth" },
  efficiency: { icon: PiggyBank, color: "text-blue-700", bg: "bg-blue-50 dark:bg-blue-950/20 border-blue-200", label: "Efficiency" },
  crisis: { icon: AlertTriangle, color: "text-red-700", bg: "bg-red-50 dark:bg-red-950/20 border-red-200", label: "Crisis" },
  exploration: { icon: Telescope, color: "text-purple-700", bg: "bg-purple-50 dark:bg-purple-950/20 border-purple-200", label: "Exploration" },
  balanced: { icon: Scale, color: "text-slate-700", bg: "bg-slate-50 dark:bg-slate-950/20 border-slate-200", label: "Balanced" },
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

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

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
            <Compass className="h-4 w-4" /> Strategic Compass
          </CardTitle>
          <Badge className={`${modeStyle.bg} ${modeStyle.color} border`}>
            <ModeIcon className="h-3 w-3 mr-1" /> {modeStyle.label} Mode
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* North Star */}
        {editingNorthStar ? (
          <div className="flex gap-2">
            <Input value={northStarDraft} onChange={e => setNorthStarDraft(e.target.value)} className="text-sm h-8" />
            <Button size="sm" className="h-8 text-xs" onClick={() => updateNorthStar.mutate(northStarDraft)}>Save</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingNorthStar(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-start gap-2 cursor-pointer group" onClick={() => { setNorthStarDraft(data?.northStar || ""); setEditingNorthStar(true); }}>
            <p className="text-sm font-medium leading-relaxed flex-1">{data?.northStar || "No north star set."}</p>
            <PenLine className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 mt-1 shrink-0" />
          </div>
        )}

        {/* Priorities */}
        <div className="flex flex-wrap gap-1.5">
          {priorities.slice(0, 5).map((p: any, i: number) => (
            <Badge key={i} variant="outline" className="text-[10px]">
              #{p.rank} {p.priority}
              <span className="ml-1 opacity-50">{"★".repeat(Math.min(Math.ceil(p.weight / 2), 5))}</span>
            </Badge>
          ))}
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground mr-1">Switch:</span>
          {Object.entries(MODE_CONFIG).map(([mode, config]) => {
            const Icon = config.icon;
            return (
              <Button
                key={mode}
                size="sm"
                variant={mode === currentMode ? "default" : "ghost"}
                className="h-6 text-[10px] px-2"
                onClick={() => switchMode.mutate(mode)}
                disabled={switchMode.isPending}
              >
                <Icon className="h-2.5 w-2.5 mr-0.5" /> {config.label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
