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
  win: "text-acr-pos", challenge: "text-acr-warn", learning: "text-acr-accent", milestone: "text-acr-brand", decision: "text-acr-accent",
};

function ChronicleCard({ entry }: { entry: ChronicleEntry }) {
  const [expanded, setExpanded] = useState(false);
  const highlights = entry.highlights || [];
  const learnings = entry.keyLearnings || [];
  const m = entry.metrics || {};

  const entryId = `chronicle-${entry.id}`;
  return (
    <li className="border rounded-xl p-4 space-y-2 list-none">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`${entryId}-body`}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.periodLabel} chronicle entry`}
        className="w-full flex items-center justify-between text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <div>
          <p className="text-sm font-semibold m-0">{entry.periodLabel}</p>
          <Badge variant="outline" className="text-[10px] h-4 capitalize">{entry.periodType}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {m.agentActions && <span><span className="tabular-nums">{m.agentActions}</span> actions</span>}
          {m.warRooms > 0 && <span><span className="tabular-nums">{m.warRooms}</span> war rooms</span>}
          {m.topAgent && <span aria-label={`Top agent: ${m.topAgent}, ${m.topAgentGrade}`}><span aria-hidden="true">{AGENT_AVATARS[m.topAgent]}</span> {m.topAgentGrade}</span>}
          <span aria-hidden="true" className="text-muted-foreground">{expanded ? "▼" : "▶"}</span>
        </div>
      </button>

      {/* Always show narrative preview */}
      <p id={`${entryId}-body`} className={`text-sm leading-relaxed ${expanded ? "" : "line-clamp-3"}`}>{entry.narrative}</p>

      {expanded && (
        <>
          {highlights.length > 0 && (
            <section aria-labelledby={`${entryId}-highlights`} className="space-y-1">
              <p id={`${entryId}-highlights`} className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Highlights</p>
              <ul aria-labelledby={`${entryId}-highlights`} className="list-none p-0 m-0 space-y-1">
                {highlights.map((h, i) => {
                  const Icon = HIGHLIGHT_ICONS[h.type] || Star;
                  const color = HIGHLIGHT_COLORS[h.type] || "";
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
                      <div>
                        <span><span className="sr-only">{h.type}: </span>{h.description}</span>
                        {h.impact && <span className="text-muted-foreground ml-1">— {h.impact}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {learnings.length > 0 && (
            <section aria-labelledby={`${entryId}-learnings`} className="space-y-1">
              <p id={`${entryId}-learnings`} className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Key learnings</p>
              <ul aria-labelledby={`${entryId}-learnings`} className="list-none p-0 m-0 space-y-1">
                {learnings.map((l, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Lightbulb className="h-2.5 w-2.5 mt-0.5 text-acr-warn shrink-0" aria-hidden="true" /> {l}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </li>
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

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading company chronicle" className="h-48 w-full rounded-xl" />;
  const list = (entries || []) as ChronicleEntry[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><BookText className="h-4 w-4" aria-hidden="true" /> Company chronicle</CardTitle>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => generateMutation.mutate("week")} disabled={generateMutation.isPending} aria-busy={generateMutation.isPending} aria-label="Generate weekly chronicle">
              <Calendar className="h-2.5 w-2.5 mr-0.5" aria-hidden="true" /> Week
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => generateMutation.mutate("month")} disabled={generateMutation.isPending} aria-busy={generateMutation.isPending} aria-label="Generate monthly chronicle">Month</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search the chronicle…" className="text-sm h-8 pl-8" aria-label="Search the chronicle" />
        </div>
        {list.length > 0 ? (
          <ul aria-label="Chronicle entries" className="space-y-3 list-none p-0 m-0">
            {list.map(e => <ChronicleCard key={e.id} entry={e} />)}
          </ul>
        ) : (
          <p className="text-center py-4 text-xs text-muted-foreground">No chronicle entries yet. Generate one above.</p>
        )}
      </CardContent>
    </Card>
  );
}
