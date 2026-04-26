/**
 * Agent Debate Panel — Sovereign Company Protocol v8
 * Structured disagreement. Agents argue. CEO decides.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS, AGENT_ROLES } from "@/lib/trust-language";
import { Swords, ThumbsUp, ThumbsDown, Gavel, Loader2, Send } from "lucide-react";

interface Debate {
  id: number; proposition: string; status: string; category: string;
  forAgents: string[]; againstAgents: string[];
  arguments: Array<{ agentCodename: string; position: string; round: number; argument: string; confidence: number }>;
  votes: Array<{ agentCodename: string; vote: string; confidence: number; reasoning: string }>;
  ceoDecision: string | null; ceoReasoning: string | null; createdAt: string;
}

function DebateCard({ debate }: { debate: Debate }) {
  const queryClient = useQueryClient();
  const [reasoning, setReasoning] = useState("");
  const decideMutation = useMutation({
    mutationFn: ({ decision, reasoning }: { decision: string; reasoning?: string }) =>
      apiRequest("POST", `/api/founder/v8/debates/${debate.id}/decide`, { decision, reasoning }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v8/debates"] }),
  });

  const args = debate.arguments || [];
  const votes = debate.votes || [];
  const forVotes = votes.filter(v => v.vote === "for").length;
  const againstVotes = votes.filter(v => v.vote === "against").length;

  return (
    <li className="border rounded-xl p-4 space-y-3 list-none">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold m-0">{debate.proposition}</p>
          <p className="text-[10px] text-muted-foreground m-0">{debate.category} &middot; <time dateTime={debate.createdAt} className="tabular-nums">{new Date(debate.createdAt).toLocaleString()}</time></p>
        </div>
        <Badge
          variant="outline"
          aria-label={`Status: ${debate.status.replace(/_/g, " ")}`}
          className={
            debate.status === "awaiting_decision" ? "bg-amber-100 text-amber-800 animate-pulse" :
            debate.status === "decided" ? "bg-emerald-100 text-emerald-800" :
            debate.status === "in_progress" ? "bg-blue-100 text-blue-800" : ""
          }
        >
          {debate.status === "in_progress" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" aria-hidden="true" />}{debate.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Arguments — Round 1 */}
      {args.filter(a => a.round === 1).length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <section aria-labelledby={`for-heading-${debate.id}`}>
            <p id={`for-heading-${debate.id}`} className="text-[10px] font-medium text-emerald-600 mb-1">For</p>
            <ul aria-labelledby={`for-heading-${debate.id}`} className="list-none p-0 m-0">
              {args.filter(a => a.position === "for" && a.round === 1).map((a, i) => (
                <li key={i} className="text-xs p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 mb-1">
                  <p className="font-medium m-0"><span aria-hidden="true">{AGENT_AVATARS[a.agentCodename]}</span> {AGENT_ROLES[a.agentCodename]}</p>
                  <p className="text-muted-foreground mt-0.5 m-0">{a.argument}</p>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby={`against-heading-${debate.id}`}>
            <p id={`against-heading-${debate.id}`} className="text-[10px] font-medium text-red-600 mb-1">Against</p>
            <ul aria-labelledby={`against-heading-${debate.id}`} className="list-none p-0 m-0">
              {args.filter(a => a.position === "against" && a.round === 1).map((a, i) => (
                <li key={i} className="text-xs p-2 rounded bg-red-50 dark:bg-red-950/20 border border-red-100 mb-1">
                  <p className="font-medium m-0"><span aria-hidden="true">{AGENT_AVATARS[a.agentCodename]}</span> {AGENT_ROLES[a.agentCodename]}</p>
                  <p className="text-muted-foreground mt-0.5 m-0">{a.argument}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Round 2 Rebuttals */}
      {args.filter(a => a.round === 2).length > 0 && (
        <section aria-labelledby={`rebuttals-heading-${debate.id}`} className="space-y-1">
          <p id={`rebuttals-heading-${debate.id}`} className="text-[10px] font-medium text-muted-foreground">Rebuttals</p>
          <ul aria-labelledby={`rebuttals-heading-${debate.id}`} className="space-y-1 list-none p-0 m-0">
            {args.filter(a => a.round === 2).map((a, i) => (
              <li key={i} className={`text-xs p-2 rounded border ${a.position === "for" ? "border-emerald-100" : "border-red-100"}`}>
                <span className="font-medium"><span aria-hidden="true">{AGENT_AVATARS[a.agentCodename]}</span> {AGENT_ROLES[a.agentCodename]}</span>
                <span className="text-muted-foreground ml-1">{a.argument}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Votes */}
      {votes.length > 0 && (
        <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50" aria-label={`Votes: ${forVotes} for, ${againstVotes} against`}>
          <div className="flex items-center gap-1 text-xs">
            <ThumbsUp className="h-3 w-3 text-emerald-600" aria-hidden="true" /> <span className="font-medium tabular-nums">{forVotes}</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <ThumbsDown className="h-3 w-3 text-red-600" aria-hidden="true" /> <span className="font-medium tabular-nums">{againstVotes}</span>
          </div>
          <ul aria-label="Vote details" className="flex-1 flex flex-wrap gap-1 list-none p-0 m-0">
            {votes.map((v, i) => (
              <li key={i}>
                <Badge variant="outline" className={`text-[10px] h-4 ${v.vote === "for" ? "text-emerald-700" : v.vote === "against" ? "text-red-700" : "text-muted-foreground"}`} aria-label={`${AGENT_ROLES[v.agentCodename]}: ${v.vote}`}>
                  <span aria-hidden="true">{AGENT_AVATARS[v.agentCodename]}</span> {v.vote}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CEO Decision */}
      {debate.status === "awaiting_decision" && (
        <div className="space-y-2 border-t pt-2">
          <Textarea
            value={reasoning}
            onChange={e => setReasoning(e.target.value)}
            placeholder="Your reasoning (optional)…"
            className="text-sm h-16"
            autoCapitalize="sentences"
            aria-label="CEO decision reasoning"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" onClick={() => decideMutation.mutate({ decision: "approved", reasoning })} disabled={decideMutation.isPending} aria-busy={decideMutation.isPending}><ThumbsUp className="h-3 w-3 mr-1" aria-hidden="true" /> Approve</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => decideMutation.mutate({ decision: "rejected", reasoning })} disabled={decideMutation.isPending} aria-busy={decideMutation.isPending}><ThumbsDown className="h-3 w-3 mr-1" aria-hidden="true" /> Reject</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => decideMutation.mutate({ decision: "deferred", reasoning })} disabled={decideMutation.isPending} aria-busy={decideMutation.isPending}>Defer</Button>
          </div>
        </div>
      )}

      {debate.ceoDecision && (
        <div className="text-xs border-t pt-2">
          <span className="font-medium">CEO decision:</span> <Badge variant="outline" className="text-[10px] capitalize">{debate.ceoDecision}</Badge>
          {debate.ceoReasoning && <p className="text-muted-foreground mt-0.5 italic">{debate.ceoReasoning}</p>}
        </div>
      )}
    </li>
  );
}

export function AgentDebatePanel() {
  const queryClient = useQueryClient();
  const [proposition, setProposition] = useState("");

  const { data: debates, isLoading } = useQuery({
    queryKey: ["/api/founder/v8/debates"],
    queryFn: () => apiRequest("GET", "/api/founder/v8/debates").then(r => r.json()),
    refetchInterval: 5000,
  });

  const initiateMutation = useMutation({
    mutationFn: (p: string) => apiRequest("POST", "/api/founder/v8/debates/initiate", { proposition: p }),
    onSuccess: () => { setProposition(""); queryClient.invalidateQueries({ queryKey: ["/api/founder/v8/debates"] }); },
  });

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading agent debates">
        <Skeleton className="h-48 w-full rounded-xl" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  const debateList = (debates || []) as Debate[];
  const pending = debateList.filter(d => d.status === "awaiting_decision").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Swords className="h-4 w-4" aria-hidden="true" /> Agent debates
            {pending > 0 && <Badge variant="outline" className="bg-amber-100 text-amber-800 tabular-nums" aria-label={`${pending} awaiting decision`}>{pending} awaiting</Badge>}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (proposition.trim() && !initiateMutation.isPending) initiateMutation.mutate(proposition.trim());
          }}
        >
          <Input
            value={proposition}
            onChange={e => setProposition(e.target.value)}
            placeholder="Should we build a mobile app? Should we raise prices?"
            className="text-sm h-8"
            aria-label="Debate proposition"
            autoCapitalize="sentences"
          />
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={!proposition.trim() || initiateMutation.isPending} aria-busy={initiateMutation.isPending}>
            <Swords className="h-3 w-3 mr-1" aria-hidden="true" /> {initiateMutation.isPending ? "Initiating…" : "Debate"}
          </Button>
        </form>
        {debateList.length > 0 ? (
          <ul aria-label="Debates" className="space-y-4 list-none p-0 m-0">
            {debateList.map(d => <DebateCard key={d.id} debate={d} />)}
          </ul>
        ) : (
          <p className="text-center py-4 text-xs text-muted-foreground">No debates yet. Ask a strategic question above.</p>
        )}
      </CardContent>
    </Card>
  );
}
