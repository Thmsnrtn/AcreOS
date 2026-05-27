/**
 * /founder/cmo — the single surface the founder uses to review and ship ads.
 *
 * Responsive parity: single-column stack on phones, two-column (preview /
 * manifest) on desktop. Identical information architecture. Keyboard
 * shortcuts on desktop, tap-and-confirm on phone.
 *
 * Three panels:
 *   1. Awaiting review (pending decisionsInboxItems where itemType='cmo_ad_review')
 *   2. Live ads (renders with status='live', last 7 days, with perf summary)
 *   3. Archetype intelligence (rolling CTR/ROAS by hook archetype)
 *
 * No multi-step wizard. Tap a bundle to expand inline preview + manifest.
 * Approve = two-step confirm. Reject = tag picker + freeform note.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  PlayCircle,
  Tag,
  ChevronDown,
  ChevronUp,
  Send,
  Wallet,
  Radio,
  AlertCircle,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";

interface RenderShape {
  id: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  storagePath: string;
  status: string;
  trackingId: string;
  bundleId: string | null;
  costBreakdown: { totalCents: number; voiceCents: number; renderCents: number; scriptCents: number; scoringCents: number };
  durationSec: number;
  broadcastAt?: string;
}

interface InboxItem {
  id: number;
  sophieAnalysis: string;
  sophieConfidenceScore: number;
  recommendedActionLabel: string;
  contextBundle: {
    scriptHook: string;
    scriptBody: string;
    scriptCta: string;
    hookArchetype: string;
    funnelStage: string;
    intent: string;
    renders: RenderShape[];
    costBreakdown: { totalCents: number };
  };
  createdAt: string;
}

interface Pending {
  inboxItem: InboxItem;
  renders: RenderShape[];
}

interface Archetype {
  id: number;
  slug: string;
  displayName: string;
  rollingCtrPpm: number | null;
  rollingRoasBps: number | null;
  spendCentsLast30d: number;
  rendersLast30d: number;
  generationWeight: number;
}

interface Budget {
  id: number;
  dailyCapCents: number;
  weeklyCapCents: number;
  monthlyCapCents: number;
  spendTodayCents: number;
  spendWeekCents: number;
  spendMonthCents: number;
}

interface DashboardResponse {
  brandProfile: { id: number; displayName: string } | null;
  pending: Pending[];
  live: RenderShape[];
  archetypes: Archetype[];
  budget: Budget | null;
}

const REJECT_TAGS = [
  { id: "tone_off", label: "Tone off" },
  { id: "hook_weak", label: "Hook weak" },
  { id: "footage_mismatch", label: "Footage doesn't match" },
  { id: "banlist_violation", label: "Brand voice / ban-list" },
] as const;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function FounderCmoPage() {
  useDocumentTitle("CMO — Ad engine");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/founder/cmo/dashboard"],
    refetchInterval: 30 * 1000,
  });

  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [approveTarget, setApproveTarget] = useState<InboxItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<InboxItem | null>(null);
  const [approveMeta, setApproveMeta] = useState(true);
  const [approveTiktok, setApproveTiktok] = useState(true);
  const [rejectTags, setRejectTags] = useState<string[]>([]);
  const [rejectNote, setRejectNote] = useState("");

  const approve = useMutation({
    mutationFn: async (args: { inboxItemId: number; platforms: string[] }) => {
      return apiRequest("POST", "/api/founder/cmo/approve", args);
    },
    onSuccess: () => {
      toast({ title: "Approved", description: "Broadcast queued. Live within minutes." });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/cmo/dashboard"] });
      setApproveTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  const reject = useMutation({
    mutationFn: async (args: { inboxItemId: number; tags: string[]; note: string }) => {
      return apiRequest("POST", "/api/founder/cmo/reject", args);
    },
    onSuccess: () => {
      toast({ title: "Rejected", description: "Note saved. Agent will use it on the next batch." });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/cmo/dashboard"] });
      setRejectTarget(null);
      setRejectTags([]);
      setRejectNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Reject failed", description: err.message, variant: "destructive" });
    },
  });

  // Keyboard shortcuts (desktop). j/k to navigate, a to approve, r to reject.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!data || data.pending.length === 0) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const current = expandedItemId
        ? data.pending.findIndex((p) => p.inboxItem.id === expandedItemId)
        : -1;

      if (e.key === "j") {
        const next = Math.min(data.pending.length - 1, current + 1);
        setExpandedItemId(data.pending[next].inboxItem.id);
      } else if (e.key === "k") {
        const prev = Math.max(0, current - 1);
        setExpandedItemId(data.pending[prev].inboxItem.id);
      } else if (e.key === "a" && expandedItemId) {
        const item = data.pending.find((p) => p.inboxItem.id === expandedItemId);
        if (item) setApproveTarget(item.inboxItem);
      } else if (e.key === "r" && expandedItemId) {
        const item = data.pending.find((p) => p.inboxItem.id === expandedItemId);
        if (item) setRejectTarget(item.inboxItem);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, expandedItemId]);

  return (
    <PageShell label="CMO ad engine">
      <div className="space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">CMO ad engine</h1>
            <p className="text-sm text-muted-foreground">
              Native ad generation, founder approval, multi-platform broadcast.
            </p>
          </div>
          {data?.budget && (
            <div className="flex items-center gap-3 text-sm">
              <Wallet className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">Today:</span>
              <span className="font-semibold tabular-nums">
                {dollars(data.budget.spendTodayCents)} / {dollars(data.budget.dailyCapCents)}
              </span>
            </div>
          )}
        </header>

        {/* AWAITING REVIEW */}
        <section aria-labelledby="cmo-pending-h">
          <h2 id="cmo-pending-h" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Awaiting review
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : !data || data.pending.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing to review"
              description="No ad bundles waiting for approval. New variants surface here as the CMO agent generates them."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {data.pending.map(({ inboxItem, renders }) => (
                <PendingBundleCard
                  key={inboxItem.id}
                  item={inboxItem}
                  renders={renders}
                  expanded={expandedItemId === inboxItem.id}
                  onToggle={() => setExpandedItemId((prev) => (prev === inboxItem.id ? null : inboxItem.id))}
                  onApprove={() => setApproveTarget(inboxItem)}
                  onReject={() => setRejectTarget(inboxItem)}
                />
              ))}
            </div>
          )}
        </section>

        {/* RECENT LIVE */}
        {data && data.live.length > 0 && (
          <section aria-labelledby="cmo-live-h">
            <h2 id="cmo-live-h" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Live ads — last 7 days
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.live.map((render) => (
                <Card key={render.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{render.aspectRatio}</Badge>
                      <Badge variant="secondary" className="text-xs">
                        <Radio className="w-3 h-3 mr-1" aria-hidden="true" />
                        Live
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono break-all">
                      {render.trackingId}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* ARCHETYPE INTELLIGENCE */}
        {data && data.archetypes.length > 0 && (
          <section aria-labelledby="cmo-archetypes-h">
            <h2 id="cmo-archetypes-h" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Hook archetype intelligence
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.archetypes.slice(0, 9).map((a) => (
                <Card key={a.id}>
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm">{a.displayName}</div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        weight {a.generationWeight}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>
                        CTR 30d: {a.rollingCtrPpm !== null ? `${(a.rollingCtrPpm / 10000).toFixed(2)}%` : "—"}
                      </div>
                      <div>
                        ROAS 30d: {a.rollingRoasBps !== null ? `${(a.rollingRoasBps / 100).toFixed(2)}x` : "—"}
                      </div>
                      <div>Spend 30d: {dollars(a.spendCentsLast30d)}</div>
                      <div>{a.rendersLast30d} renders</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* APPROVE CONFIRMATION */}
      <Dialog open={approveTarget !== null} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Broadcast this bundle?</DialogTitle>
            <DialogDescription>
              Pick the platforms. The bundle's 9:16 / 1:1 / 16:9 renders will be uploaded and the ad will go live within minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="flex items-center gap-3 p-3 rounded-card border cursor-pointer">
              <Checkbox checked={approveMeta} onCheckedChange={(v) => setApproveMeta(!!v)} />
              <div>
                <div className="font-medium text-sm">Meta (Facebook + Instagram)</div>
                <div className="text-xs text-muted-foreground">Uses 1:1 + 9:16 + 16:9</div>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-card border cursor-pointer">
              <Checkbox checked={approveTiktok} onCheckedChange={(v) => setApproveTiktok(!!v)} />
              <div>
                <div className="font-medium text-sm">TikTok</div>
                <div className="text-xs text-muted-foreground">Uses 9:16</div>
              </div>
            </label>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approve.isPending}>
              {Verbs.CANCEL}
            </Button>
            <Button
              onClick={() => {
                if (!approveTarget) return;
                const platforms: string[] = [];
                if (approveMeta) platforms.push("meta");
                if (approveTiktok) platforms.push("tiktok");
                if (platforms.length === 0) {
                  toast({ title: "Pick at least one platform", variant: "destructive" });
                  return;
                }
                approve.mutate({ inboxItemId: approveTarget.id, platforms });
              }}
              disabled={approve.isPending}
              className="gap-2"
            >
              {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Confirm broadcast
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REJECT */}
      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this bundle</DialogTitle>
            <DialogDescription>
              Pick what's off + leave a note. The agent reads tags for fast-path
              corrections and the note for nuance — both feed into next-batch context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap gap-2">
              {REJECT_TAGS.map((t) => {
                const active = rejectTags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setRejectTags((tags) =>
                        active ? tags.filter((x) => x !== t.id) : [...tags, t.id],
                      )
                    }
                    className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border min-h-[40px] transition-colors ${
                      active ? "bg-primary text-primary-foreground border-primary" : "bg-background"
                    }`}
                  >
                    <Tag className="w-3 h-3" aria-hidden="true" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Optional — what specifically should the next batch do differently?"
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={reject.isPending}>
              {Verbs.CANCEL}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!rejectTarget) return;
                reject.mutate({
                  inboxItemId: rejectTarget.id,
                  tags: rejectTags,
                  note: rejectNote,
                });
              }}
              disabled={reject.isPending}
              className="gap-2"
            >
              {reject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function PendingBundleCard({
  item,
  renders,
  expanded,
  onToggle,
  onApprove,
  onReject,
}: {
  item: InboxItem;
  renders: RenderShape[];
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const ctx = item.contextBundle;
  const headline = renders.find((r) => r.aspectRatio === "9:16") ?? renders[0];

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left p-4 flex items-start gap-4 hover:bg-muted/30 transition-colors min-h-[88px]"
        >
          <div className="shrink-0 w-12 h-12 rounded-card bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">{ctx.hookArchetype}</Badge>
              <Badge variant="secondary" className="text-xs">{ctx.funnelStage}</Badge>
              <Badge variant="outline" className="text-xs">{renders.length} renders</Badge>
              <span className="text-xs text-muted-foreground font-mono">
                {dollars(ctx.costBreakdown.totalCents)}
              </span>
            </div>
            <p className="font-semibold text-base line-clamp-2 mb-1">{ctx.scriptHook}</p>
            <p className="text-xs text-muted-foreground line-clamp-1">{item.sophieAnalysis}</p>
          </div>
          <div className="shrink-0 self-center text-muted-foreground">
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        {expanded && (
          <div className="border-t bg-muted/20 p-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-4">
              {/* preview column */}
              <div className="space-y-3">
                {headline ? (
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full rounded-card bg-black aspect-[9/16] md:aspect-video lg:aspect-[9/16] max-h-[60vh] object-contain"
                    src={`/api/founder/cmo/asset?key=${encodeURIComponent(headline.storagePath.replace(/^local:/, ""))}`}
                  />
                ) : (
                  <div className="aspect-video rounded-card border bg-muted flex items-center justify-center text-muted-foreground text-sm">
                    No render available
                  </div>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  {renders.map((r) => (
                    <Badge key={r.id} variant="outline" className="font-mono">
                      <PlayCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                      {r.aspectRatio} · {r.durationSec}s
                    </Badge>
                  ))}
                </div>
              </div>

              {/* manifest column */}
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">Hook</div>
                  <p className="leading-snug">{ctx.scriptHook}</p>
                </div>
                <div>
                  <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">Body</div>
                  <p className="leading-snug">{ctx.scriptBody}</p>
                </div>
                <div>
                  <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">CTA</div>
                  <p className="leading-snug">{ctx.scriptCta}</p>
                </div>
                <div>
                  <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">Cost</div>
                  <p className="font-mono">{dollars(ctx.costBreakdown.totalCents)}</p>
                </div>
                <div>
                  <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">Confidence</div>
                  <p className="font-mono">{item.sophieConfidenceScore}/100</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
              <Button variant="outline" onClick={onReject} className="gap-2">
                <XCircle className="w-4 h-4" aria-hidden="true" />
                Reject
              </Button>
              <Button onClick={onApprove} className="gap-2">
                <Send className="w-4 h-4" aria-hidden="true" />
                Approve &amp; broadcast
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
