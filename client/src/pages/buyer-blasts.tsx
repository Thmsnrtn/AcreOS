// 2026-05-11 — index route /buyer-blasts now redirects to
// /campaigns?channel=buyer-blasts. This component still mounts on
// /buyer-blasts/:id for deep-linked blast detail views.
/**
 * /buyer-blasts — Push-to-buyer-list one-click outreach (W-4).
 *
 * Trey: "Hit a button, AcreOS pulls matched cash buyers from
 * buyer_property_matches, sends an email + SMS with property card and
 * photos, tracks who opens, who replies, who books a walkthrough."
 *
 * This is the dashboard. Composer dialog: pick property → subject + body
 * → minMatchScore + financingType filters → dry-run preview → send.
 * Detail view shows per-recipient status with response-logging buttons.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { ArrowLeft, Send, Plus, Eye, Check, X as XIcon } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Blast {
  id: string;
  propertyId: number;
  subject: string;
  bodySnapshot: string | null;
  channel: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  repliedCount: number;
  completedAt: string | null;
  createdAt: string;
}

interface Recipient {
  id: string;
  buyerProfileId: number;
  email: string | null;
  matchScore: number | null;
  status:
    | "queued" | "sent" | "delivered" | "opened"
    | "replied_interested" | "replied_not_interested"
    | "bounced" | "failed";
  sentAt: string | null;
  respondedAt: string | null;
  responseNotes: string | null;
  failureReason: string | null;
  buyerName: string;
}

const STATUS_TONE: Record<Recipient["status"], string> = {
  queued:                 "bg-muted text-muted-foreground",
  sent:                   "bg-acr-pos/10 text-acr-pos",
  delivered:              "bg-acr-pos/10 text-acr-pos",
  opened:                 "bg-primary/10 text-primary",
  replied_interested:     "bg-acr-pos/20 text-acr-pos font-semibold",
  replied_not_interested: "bg-muted text-muted-foreground",
  bounced:                "bg-acr-warning/10 text-acr-warning",
  failed:                 "bg-acr-neg/10 text-acr-neg",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function BuyerBlastsPage() {
  const [matchDetail, params] = useRoute<{ id: string }>("/buyer-blasts/:id");
  if (matchDetail && params?.id) return <BlastDetail blastId={params.id} />;
  return <BlastIndex />;
}

function BlastIndex() {
  useDocumentTitle("Buyer blasts — AcreOS");
  const [, navigate] = useLocation();
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, isLoading } = useQuery<{ blasts: Blast[] }>({
    queryKey: ["/api/buyer-blasts"],
    queryFn: async () => {
      const res = await fetch("/api/buyer-blasts", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const blasts = data?.blasts ?? [];

  return (
    <PageShell label="Buyer blasts">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Send className="w-6 h-6 text-primary" aria-hidden="true" />
            Buyer blasts
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            One-click outreach to matched cash buyers per property. Dry-run preview
            before send so you confirm who's receiving. Per-recipient response
            tracking inline.
          </p>
        </div>
        <Button onClick={() => setComposerOpen(true)} data-testid="new-blast-button">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Blast a property
        </Button>
      </div>

      {isLoading ? (
        <Card><div className="p-5"><Skeleton className="h-32" /></div></Card>
      ) : blasts.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No buyer blasts yet"
          description="When you lock up a subject property, blast your matched cash buyers in one click. AcreOS sends the emails + tracks each recipient's status."
          actionLabel="Blast a property"
          actionIcon={Plus}
          onAction={() => setComposerOpen(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2.5 text-left font-medium">Subject</th>
                  <th className="px-3 py-2.5 text-left font-medium">Property #</th>
                  <th className="px-3 py-2.5 text-right font-medium">Recipients</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Replied</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Sent at</th>
                </tr>
              </thead>
              <tbody>
                {blasts.map((b) => (
                  <tr
                    key={b.id}
                    className="border-t border-border/40 hover:bg-accent/30 cursor-pointer"
                    onClick={() => navigate(`/buyer-blasts/${b.id}`)}
                  >
                    <td className="px-3 py-2.5 font-medium">{b.subject}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{b.propertyId}</td>
                    <td className="px-3 py-2.5 text-right">{b.recipientCount}</td>
                    <td className="px-3 py-2.5 text-right text-acr-pos">{b.sentCount}</td>
                    <td className="px-3 py-2.5 text-right text-primary">{b.repliedCount}</td>
                    <td className="px-3 py-2.5 text-xs capitalize">{b.status}</td>
                    <td className="px-3 py-2.5 text-xs">{fmtDate(b.completedAt ?? b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ComposerDialog open={composerOpen} onOpenChange={setComposerOpen} />
    </PageShell>
  );
}

function BlastDetail({ blastId }: { blastId: string }) {
  useDocumentTitle("Buyer blast — AcreOS");

  const { data, isLoading } = useQuery<{ blast: Blast; recipients: Recipient[] }>({
    queryKey: ["/api/buyer-blasts", blastId],
    queryFn: async () => {
      const res = await fetch(`/api/buyer-blasts/${blastId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) {
    return <PageShell><Skeleton className="h-12 w-72 mb-4" /><Skeleton className="h-60" /></PageShell>;
  }
  if (!data) {
    return <PageShell><Card><div className="p-6">Blast not found.</div></Card></PageShell>;
  }
  const { blast, recipients } = data;

  return (
    <PageShell>
      <Link href="/buyer-blasts">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back
        </Button>
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-1">{blast.subject}</h1>
      <p className="text-xs text-muted-foreground mb-6">
        Property #{blast.propertyId} · {blast.recipientCount} recipients · {blast.sentCount} sent · {blast.repliedCount} replied
      </p>

      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-2">Recipients</h2>
          <Separator className="mb-3" />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Buyer</th>
                <th className="px-2 py-2 text-left font-medium">Email</th>
                <th className="px-2 py-2 text-right font-medium">Match</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="px-2 py-2">{r.buyerName}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.email}</td>
                  <td className="px-2 py-2 text-right text-xs font-mono">{r.matchScore ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {(r.status === "sent" || r.status === "delivered" || r.status === "opened") && (
                      <RecipientResponseButtons recipientId={r.id} blastId={blastId} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {blast.bodySnapshot && (
        <Card>
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">What we sent</h2>
            <Separator className="mb-3" />
            <div className="text-sm text-muted-foreground whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: blast.bodySnapshot }} />
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function RecipientResponseButtons({ recipientId, blastId }: { recipientId: string; blastId: string }) {
  const { toast } = useToast();
  const set = useMutation({
    mutationFn: async (status: "replied_interested" | "replied_not_interested") => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/buyer-blasts/recipients/${recipientId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-blasts", blastId] });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-blasts"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" className="h-7 text-xs text-acr-pos" onClick={() => set.mutate("replied_interested")} disabled={set.isPending}>
        <Check className="w-3 h-3 mr-1" /> Interested
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => set.mutate("replied_not_interested")} disabled={set.isPending}>
        <XIcon className="w-3 h-3 mr-1" /> Not
      </Button>
    </div>
  );
}

function ComposerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [propertyId, setPropertyId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [minScore, setMinScore] = useState("70");
  const [financingType, setFinancingType] = useState<"cash" | "any">("cash");
  const [preview, setPreview] = useState<{
    count: number;
    recipients: any[];
    suppressedCount?: number;
    suppressionReason?: string | null;
    suppressed?: any[];
  } | null>(null);

  const reset = () => {
    setPropertyId(""); setSubject(""); setBody(""); setMinScore("70");
    setFinancingType("cash"); setPreview(null);
  };

  const dryRun = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/properties/${propertyId}/blast-buyers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({
          subject: subject || "(preview)",
          body: body || "(preview)",
          minMatchScore: parseInt(minScore, 10),
          financingType,
          dryRun: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Preview failed");
      }
      return res.json();
    },
    onSuccess: (d) => setPreview({
      count: d.recipientCount,
      recipients: d.recipients,
      suppressedCount: d.suppressedCount,
      suppressionReason: d.suppressionReason,
      suppressed: d.suppressed,
    }),
    onError: (err: any) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/properties/${propertyId}/blast-buyers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({
          subject,
          body,
          minMatchScore: parseInt(minScore, 10),
          financingType,
          dryRun: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Send failed");
      }
      return res.json() as Promise<{ blast: Blast; recipientCount: number }>;
    },
    onSuccess: ({ blast, recipientCount }) => {
      toast({ title: "Blast sent", description: `${recipientCount} recipient${recipientCount === 1 ? "" : "s"}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/buyer-blasts"] });
      reset();
      onOpenChange(false);
      navigate(`/buyer-blasts/${blast.id}`);
    },
    onError: (err: any) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Blast a property to matched cash buyers</DialogTitle>
          <DialogDescription>
            Pulls matched buyers ≥ score threshold. Dry-run shows who would be
            reached without sending. Send only after confirming recipients.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bb-property" className="text-xs">Property ID *</Label>
              <Input id="bb-property" inputMode="numeric" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} placeholder="123" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bb-finance" className="text-xs">Financing filter</Label>
              <Select value={financingType} onValueChange={(v) => setFinancingType(v as "cash" | "any")}>
                <SelectTrigger id="bb-finance"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash buyers only</SelectItem>
                  <SelectItem value="any">Any financing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bb-subject" className="text-xs">Subject *</Label>
            <Input id="bb-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="New deal in 85016 — $185K assignment, ARV $310K" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bb-body" className="text-xs">Body (HTML allowed)</Label>
            <Textarea id="bb-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="3-bed/2-bath in Maryvale, repairs ~$45K. Reply YES if you want to walk it." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bb-score" className="text-xs">Minimum match score (0–100)</Label>
            <Input id="bb-score" inputMode="numeric" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </div>

          {preview && (
            <div className="space-y-2">
              <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-xs">
                <div className="font-semibold mb-1">{preview.count} eligible recipient{preview.count === 1 ? "" : "s"}.</div>
                {preview.recipients.slice(0, 5).map((r: any) => (
                  <div key={r.buyerProfileId} className="flex justify-between">
                    <span>{r.name}</span>
                    <span className="text-muted-foreground">{r.email} · {r.matchScore}</span>
                  </div>
                ))}
                {preview.count > 5 && <div className="text-muted-foreground italic mt-1">…and {preview.count - 5} more</div>}
              </div>
              {(preview.suppressedCount ?? 0) > 0 && (
                <div className="p-3 rounded-md bg-acr-warning/10 border border-acr-warning/30 text-xs">
                  <div className="font-semibold mb-1 text-acr-warning">
                    {preview.suppressedCount} suppressed by cadence guardrail
                  </div>
                  <div className="text-muted-foreground">
                    {preview.suppressionReason ??
                      "Buyers with >2 blasts in the last 7 days are skipped to avoid blast fatigue."}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => dryRun.mutate()} disabled={!propertyId || dryRun.isPending}>
            <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {dryRun.isPending ? "Previewing…" : "Preview"}
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={!propertyId || !subject || !body || send.isPending || !preview}
            data-testid="confirm-send-blast"
          >
            <Send className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {send.isPending ? "Sending…" : `Send to ${preview?.count ?? "?"} buyers`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
