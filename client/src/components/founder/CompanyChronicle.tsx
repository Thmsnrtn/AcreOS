/**
 * Company Chronicle — Sovereign Company Protocol v8
 * The story of your company. AI-generated narrative history.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS } from "@/lib/trust-language";
import { BookText, Star, AlertCircle, Lightbulb, Trophy, RefreshCw, Search, Calendar } from "lucide-react";

interface ChronicleEntry {
  id: number; periodType: string; periodLabel: string; narrative: string;
  highlights: Array<{ type: string; description: string; impact?: string; agents?: string[] }>;
  metrics: Record<string, any>; keyLearnings: string[]; createdAt: string;
}

const HIGHLIGHT_ICONS: Record<string, any> = { win: Trophy, challenge: AlertCircle, learning: Lightbulb, milestone: Star, decision: Star };
const HIGHLIGHT_COLORS: Record<string, string> = {
  win: "text-emerald-600", challenge: "text-amber-600", learning: "text-blue-600", milestone: "text-purple-600", decision: "text-indigo-600",
};

function ChronicleCard({ entry }: { entry: ChronicleEntry }) {
  const [expanded, setExpanded] = useState(false);
  const highlights = entry.highlights || [];
  const learnings = entry.keyLearnings || [];
  const m = entry.metrics || {};

  return (
    <div className="border rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div>
          <div className="text-sm font-semibold">{entry.periodLabel}</div>
          <Badge variant="outline" className="text-[10px] h-4">{entry.periodType}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {m.agentActions && <span>{m.agentActions} actions</span>}
          {m.warRooms > 0 && <span>{m.warRooms} war rooms</span>}
          {m.topAgent && <span>{AGENT_AVATARS[m.topAgent]} {m.topAgentGrade}</span>}
          <span className="text-muted-foreground">{expanded ? "▼" : "▶"}</span>
        </div>
      </div>

      {/* Always show narrative preview */}
      <p className={`text-sm leading-relaxed ${expanded ? "" : "line-clamp-3"}`}>{entry.narrative}</p>

      {expanded && (
        <>
          {highlights.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Highlights</div>
              {highlights.map((h, i) => {
                const Icon = HIGHLIGHT_ICONS[h.type] || Star;
                const color = HIGHLIGHT_COLORS[h.type] || "";
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${color}`} />
                    <div>
                      <span>{h.description}</span>
                      {h.impact && <span className="text-muted-foreground ml-1">— {h.impact}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {learnings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Key Learnings</div>
              {learnings.map((l, i) => (
                <div key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Lightbulb className="h-2.5 w-2.5 mt-0.5 text-amber-500 shrink-0" /> {l}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CompanyChronicle() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: entries, isLoading } = useQuery({
    queryKey: ["/api/founder/v8/chronicle", searchQuery],
    queryFn: () => {
      const url = searchQuery ? `/api/founder/v8/chronicle/search?q=${encodeURIComponent(searchQuery)}` : "/api/founder/v8/chronicle";
      return apiRequest("GET", url).then(r => r.json());
    },
    refetchInterval: 60000,
  });

  const generateMutation = useMutation({
    mutationFn: (periodType: string) => apiRequest("POST", "/api/founder/v8/chronicle/generate", { periodType }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v8/chronicle"] }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  const list = (entries || []) as ChronicleEntry[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><BookText className="h-4 w-4" /> Company Chronicle</CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => generateMutation.mutate("week")} disabled={generateMutation.isPending}>
              <Calendar className="h-2.5 w-2.5 mr-0.5" /> Week
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => generateMutation.mutate("month")} disabled={generateMutation.isPending}>Month</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search the chronicle…" className="text-sm h-8 pl-8" />
        </div>
        {list.map(e => <ChronicleCard key={e.id} entry={e} />)}
        {list.length === 0 && <div className="text-center py-4 text-xs text-muted-foreground">No chronicle entries yet. Generate one above.</div>}
      </CardContent>
    </Card>
  );
}
