/**
 * Pool / fractional ownership card for the acquired-note detail page.
 *
 * Linnea: "Three of my LP investors share a $180K commercial note 50/30/20.
 * Without [pool ownership tracking] I'm back in the spreadsheet for those
 * four pool notes immediately."
 *
 * Renders the per-investor split + previews how each cash-flow dollar
 * splits across investors. Add/remove rows; percentages are validated
 * server-side (≤100% total).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";

interface Split {
  id: string;
  noteId: string;
  investorLeadId: number | null;
  investorName: string;
  investorEmail: string | null;
  role: "org" | "lp";
  percentageBps: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
}

interface SplitsResponse {
  splits: Split[];
  totalBps: number;
  unallocatedBps: number;
}

function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function NoteSplitsCard({ noteId, currentBalanceCents }: {
  noteId: string;
  currentBalanceCents: number;
}) {
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery<SplitsResponse>({
    queryKey: ["/api/notes", noteId, "splits"],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/splits`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load splits (${res.status})`);
      return res.json();
    },
  });

  const splits = data?.splits ?? [];
  const totalBps = data?.totalBps ?? 0;
  const unallocatedBps = data?.unallocatedBps ?? 10_000;

  return (
    <Card className="mb-6">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Ownership splits</h2>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddOpen(true)}
            disabled={unallocatedBps <= 0}
            data-testid="add-split-button"
          >
            <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Add investor
          </Button>
        </div>
        <Separator className="mb-3" />

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : splits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No splits configured. By default, the org holds 100% of this note. Add
            an investor to track LP shares for cash-flow distribution and
            per-investor 1099-INT.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {splits.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {s.investorName}
                      {s.role === "org" && <span className="text-xs text-muted-foreground ml-1.5">(org)</span>}
                    </div>
                    {s.investorEmail && (
                      <div className="text-xs text-muted-foreground truncate">{s.investorEmail}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-medium">{fmtPct(s.percentageBps)}</div>
                    <div className="text-micro text-muted-foreground">
                      ≈ {fmtUsdRound((currentBalanceCents * s.percentageBps) / 10_000)} of balance
                    </div>
                  </div>
                  <DeleteSplitButton splitId={s.id} noteId={noteId} />
                </li>
              ))}
            </ul>

            {unallocatedBps !== 0 && (
              <p className={`text-xs mt-3 ${unallocatedBps > 0 ? "text-acr-warning" : "text-acr-neg"}`}>
                {unallocatedBps > 0
                  ? `${fmtPct(unallocatedBps)} unallocated (${fmtPct(totalBps)} of 100%).`
                  : `${fmtPct(-unallocatedBps)} over-allocated — adjust before recording the next payment.`}
              </p>
            )}
          </>
        )}
      </div>

      <AddSplitDialog open={addOpen} onOpenChange={setAddOpen} noteId={noteId} maxBps={unallocatedBps} />
    </Card>
  );
}

function fmtUsdRound(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function DeleteSplitButton({ splitId, noteId }: { splitId: string; noteId: string }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/note-splits/${splitId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": decodeURIComponent(csrfToken) },
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "splits"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't delete", description: err.message, variant: "destructive" });
    },
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label="Remove investor"
      data-testid={`delete-split-${splitId}`}
    >
      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}

function AddSplitDialog({ open, onOpenChange, noteId, maxBps }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  noteId: string;
  maxBps: number;
}) {
  const { toast } = useToast();
  const [investorName, setInvestorName] = useState("");
  const [investorEmail, setInvestorEmail] = useState("");
  const [percentage, setPercentage] = useState("");
  const [role, setRole] = useState<"lp" | "org">("lp");

  const reset = () => {
    setInvestorName("");
    setInvestorEmail("");
    setPercentage("");
    setRole("lp");
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const pct = parseFloat(percentage);
      if (!isFinite(pct) || pct <= 0) throw new Error("Percentage must be positive");
      const res = await fetch(`/api/notes/${noteId}/splits`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({
          investorName: investorName.trim(),
          investorEmail: investorEmail.trim() || undefined,
          role,
          percentageBps: Math.round(pct * 100),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Add failed" }));
        throw new Error(err.message || "Add failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Investor added", description: `${investorName} added to the split.` });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId, "splits"] });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't add", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add investor split</DialogTitle>
          <DialogDescription>
            {fmtPct(maxBps)} available for allocation. Per-investor 1099-INT
            generation reads these splits in PR-3 / PR-5.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="investor-name">Investor name *</Label>
            <Input id="investor-name" value={investorName} onChange={(e) => setInvestorName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="investor-email">Email</Label>
            <Input id="investor-email" type="email" value={investorEmail} onChange={(e) => setInvestorEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "lp" | "org")}>
                <SelectTrigger id="role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lp">LP investor</SelectItem>
                  <SelectItem value="org">Org (self-funded)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="percentage">Percentage *</Label>
              <Input
                id="percentage"
                inputMode="decimal"
                placeholder={`Max ${(maxBps / 100).toFixed(2)}%`}
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>{Verbs.CANCEL}</Button>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!investorName || !percentage || submitMutation.isPending}
            data-testid="confirm-add-split"
          >
            {submitMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
