/**
 * Synergy Map — Sovereign Company Protocol v8
 * Which agent pairs work best together.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS, AGENT_ROLES } from "@/lib/trust-language";
import { Network, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface Synergy {
  id: number; agentA: string; agentB: string;
  totalCollaborations: number; successCount: number; failureCount: number;
  synergyScore: string | null; bestAt: string[]; worstAt: string[];
  recommendation: string | null;
}

function SynergyRow({ synergy }: { synergy: Synergy }) {
  const score = Math.round(Number(synergy.synergyScore || 0) * 100);
  const isStrong = score >= 75;
  const isWeak = score < 50;
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border">
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-base">{AGENT_AVATARS[synergy.agentA]}</span>
        <span className="text-[10px] text-muted-foreground">+</span>
        <span className="text-base">{AGENT_AVATARS[synergy.agentB]}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium">{AGENT_ROLES[synergy.agentA]}</span>
          <span className="text-muted-foreground">+</span>
          <span className="font-medium">{AGENT_ROLES[synergy.agentB]}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Progress value={score} className="h-1.5 flex-1" />
          <span className={`text-[10px] font-medium ${isStrong ? "text-emerald-600" : isWeak ? "text-red-600" : "text-amber-600"}`}>{score}%</span>
        </div>
        {synergy.recommendation && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{synergy.recommendation}</div>}
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] text-muted-foreground">{synergy.totalCollaborations} collabs</div>
        {synergy.bestAt?.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 text-emerald-600"><ArrowUpRight className="h-2 w-2 mr-0.5" />{synergy.bestAt[0]}</Badge>
        )}
      </div>
    </div>
  );
}

export function SynergyMap() {
  const { data: synergies, isLoading } = useQuery({
    queryKey: ["/api/founder/v8/synergy"],
    queryFn: () => apiRequest("GET", "/api/founder/v8/synergy").then(r => r.json()),
    refetchInterval: 60000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  const list = (synergies || []) as Synergy[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Network className="h-4 w-4" /> Agent Synergy Map</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <div className="text-center py-4 text-xs text-muted-foreground">Synergy data builds as agents collaborate. Run workflows and war rooms to generate pair data.</div>
        ) : list.slice(0, 8).map(s => <SynergyRow key={s.id} synergy={s} />)}
      </CardContent>
    </Card>
  );
}
