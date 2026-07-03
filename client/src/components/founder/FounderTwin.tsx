/**
 * Founder Twin — Sovereign Company Protocol v7
 *
 * Draft investor updates, board reports, customer responses
 * in the founder's voice. AI trained on YOUR patterns.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserCircle2,
  PenTool,
  Send,
  CheckCircle2,
  Copy,
  Sparkles,
  FileText,
} from "lucide-react";
import { Verbs } from "@/lib/labels";

interface Draft {
  id: number;
  draftType: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
}

const DRAFT_TYPES = [
  { value: "investor_update", label: "Investor update" },
  { value: "board_report", label: "Board report" },
  { value: "customer_response", label: "Customer response" },
  { value: "team_announcement", label: "Team announcement" },
];

function DraftCard({ draft }: { draft: Draft }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(draft.content);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/founder/v7/twin/drafts/${draft.id}/edit`, { content: editContent }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/twin/drafts"] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/founder/v7/twin/drafts/${draft.id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/twin/drafts"] }),
  });

  const typeLabel = DRAFT_TYPES.find(t => t.value === draft.draftType)?.label || draft.draftType;

  return (
    <li className="border rounded-xl p-4 space-y-2 list-none">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold m-0">{draft.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge variant="outline" className="text-micro h-4">{typeLabel}</Badge>
            <time dateTime={draft.createdAt} className="text-micro text-muted-foreground tabular-nums">{new Date(draft.createdAt).toLocaleString()}</time>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`capitalize ${draft.status === "approved" ? "bg-acr-pos-soft text-acr-pos" : "bg-muted"}`}
          aria-label={`Status: ${draft.status}`}
        >
          {draft.status}
        </Badge>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="text-sm min-h-[200px]"
            aria-label={`Edit ${draft.title}`}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} aria-busy={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              {Verbs.CANCEL}
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap p-3 rounded-card bg-muted/50 border max-h-60 overflow-y-auto leading-relaxed">
          {draft.content}
        </div>
      )}

      {!editing && draft.status === "draft" && (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)} aria-label={`Edit ${draft.title}`}>
            <PenTool className="h-3 w-3 mr-1" aria-hidden="true" /> {Verbs.EDIT}
          </Button>
          <Button type="button" size="sm" variant="default" className="h-7 text-xs" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} aria-busy={approveMutation.isPending} aria-label={`Approve ${draft.title}`}>
            <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" /> {approveMutation.isPending ? "Approving…" : "Approve"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => navigator.clipboard.writeText(draft.content)}
            aria-label={`Copy ${draft.title} to clipboard`}
          >
            <Copy className="h-3 w-3 mr-1" aria-hidden="true" /> {Verbs.COPY}
          </Button>
        </div>
      )}
    </li>
  );
}

export function FounderTwin() {
  const queryClient = useQueryClient();
  const [draftType, setDraftType] = useState("investor_update");
  const [topic, setTopic] = useState("");

  const { data: drafts, isLoading } = useQuery({
    queryKey: ["/api/founder/v7/twin/drafts"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/twin/drafts").then(r => r.json()),
    refetchInterval: 10000,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/founder/v7/twin/generate", { draftType, topic: topic || undefined }),
    onSuccess: () => {
      setTopic("");
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/twin/drafts"] });
    },
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading drafts" className="h-48 w-full rounded-xl" />;

  const draftList = (drafts || []) as Draft[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCircle2 className="h-4 w-4" aria-hidden="true" /> Your digital twin
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Draft communications in your voice. The more you use the system, the better it matches your style.
        </p>

        {/* Generate new draft */}
        <div className="flex items-center gap-2">
          <Select value={draftType} onValueChange={setDraftType}>
            <SelectTrigger className="w-44 h-8 text-xs" aria-label="Draft type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRAFT_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic or focus (optional)"
            className="text-sm h-8 flex-1"
            aria-label="Topic or focus (optional)"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 px-3"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            aria-busy={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <><Sparkles className="h-3 w-3 mr-1 animate-pulse" aria-hidden="true" /> Drafting…</>
            ) : (
              <><PenTool className="h-3 w-3 mr-1" aria-hidden="true" /> Draft</>
            )}
          </Button>
        </div>

        {/* Drafts */}
        {draftList.length > 0 ? (
          <ul aria-label="Drafts" className="space-y-3 list-none p-0 m-0">
            {draftList.map(d => (
              <DraftCard key={d.id} draft={d} />
            ))}
          </ul>
        ) : (
          <p className="text-center py-4 text-xs text-muted-foreground">
            No drafts yet. Generate one above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
