/**
 * /double-close — A→B + B→C linked-transaction tracker (W-3).
 *
 * Trey: "I have to buy at 9 AM and sell at 9:01 AM through a transactional
 * funder. AcreOS doesn't have a double-close flow."
 *
 * Renders both contract sides side-by-side with the funder fee + net-to-
 * wholesaler computed from the spread. Index page lists all deals; detail
 * page shows the two-side structure with status pills + edit affordances.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { ArrowLeft, GitBranch, Plus } from "lucide-react";

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
import { formatDate } from "@/lib/format";

type Status =
  | "planned"
  | "a_side_under_contract"
  | "bc_side_under_contract"
  | "a_side_closed"
  | "both_closed"
  | "dead";

type Reason = "state_restriction" | "non_assignable_contract" | "fha_financed" | "operator_choice" | "other";

interface Deal {
  id: string;
  propertyId: number | null;
  reason: Reason;
  aSellerName: string;
  aSidePurchasePriceCents: number;
  aSideContractDate: string | null;
  aSideClosingDate: string | null;
  aSideTitleCompany: string | null;
  bcBuyerName: string | null;
  bcSidePurchasePriceCents: number | null;
  bcSideContractDate: string | null;
  bcSideClosingDate: string | null;
  bcSideTitleCompany: string | null;
  transactionalFunderName: string | null;
  transactionalFunderFeeCents: number | null;
  transactionalFunderRateBps: number | null;
  status: Status;
  state: string | null;
  notes: string | null;
}

const STATUS_LABELS: Record<Status, string> = {
  planned: "Planned",
  a_side_under_contract: "A-side under contract",
  bc_side_under_contract: "B-C side under contract",
  a_side_closed: "A-side closed",
  both_closed: "Both closed",
  dead: "Dead",
};

const REASON_LABELS: Record<Reason, string> = {
  state_restriction: "State restriction (W-1)",
  non_assignable_contract: "Non-assignable contract",
  fha_financed: "FHA-financed seller",
  operator_choice: "Operator choice",
  other: "Other",
};

function fmtUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

export default function DoubleClosePage() {
  const [matchDetail, params] = useRoute<{ id: string }>("/double-close/:id");
  if (matchDetail && params?.id) return <DoubleCloseDetail dealId={params.id} />;
  return <DoubleCloseIndex />;
}

function DoubleCloseIndex() {
  useDocumentTitle("Double-close deals — AcreOS");
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<{ deals: Deal[] }>({
    queryKey: ["/api/double-close"],
    queryFn: async () => {
      const res = await fetch("/api/double-close", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const deals = data?.deals ?? [];

  return (
    <PageShell label="Double-close">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-primary" aria-hidden="true" />
            Double-close deals
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            A→B + B→C linked transactions. Used when assignment isn't legal
            (state restriction or non-assignable contract) or strategic
            (FHA-financed seller). Both sides closed same day, transactional
            funder bridges the gap.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="add-double-close">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          New double-close
        </Button>
      </div>

      {isLoading ? (
        <Card><div className="p-5"><Skeleton className="h-32" /></div></Card>
      ) : deals.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          headline="No double-close deals"
          subtitle="When you can't legally assign, plan a double-close here. Track A→B + B→C contracts side-by-side with the transactional funder fee + net to wholesaler."
          cta={{
            label: "New double-close",
            onClick: () => setCreateOpen(true),
            "data-testid": "double-close-create",
          }}
          actionIcon={null}
        />
      ) : (
        <Card>
          {/* Mobile: stacked deal cards — the 7-column table side-scrolls at
              phone widths. md+ renders the full table below. */}
          <ul className="md:hidden divide-y divide-border/40" data-testid="list-double-close-mobile">
            {deals.map((d) => {
              const net = d.bcSidePurchasePriceCents != null
                ? d.bcSidePurchasePriceCents - d.aSidePurchasePriceCents - (d.transactionalFunderFeeCents ?? 0)
                : null;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/double-close/${d.id}`)}
                    className="w-full text-left px-4 py-3 hover-elevate active:bg-muted/30"
                    data-testid={`card-double-close-${d.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {d.aSellerName} → {d.bcBuyerName ?? "—"}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono tabular-nums mt-0.5">
                          A-B {fmtUsd(d.aSidePurchasePriceCents)} · B-C {fmtUsd(d.bcSidePurchasePriceCents)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-mono font-semibold tabular-nums ${net !== null && net < 0 ? "text-acr-neg" : net !== null ? "text-acr-pos" : ""}`}>
                          {fmtUsd(net)}
                        </div>
                        <div className="text-xs text-muted-foreground">net</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-2 text-xs">
                      <span className="text-muted-foreground font-mono tabular-nums">
                        Funder fee {fmtUsd(d.transactionalFunderFeeCents)}
                      </span>
                      <span>{STATUS_LABELS[d.status]}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Desktop: full table. Hidden on mobile. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2.5 text-left font-medium">Seller (A)</th>
                  <th className="px-3 py-2.5 text-right font-medium">A-B price</th>
                  <th className="px-3 py-2.5 text-left font-medium">Buyer (C)</th>
                  <th className="px-3 py-2.5 text-right font-medium">B-C price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Funder fee</th>
                  <th className="px-3 py-2.5 text-right font-medium">Net</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const net = d.bcSidePurchasePriceCents != null
                    ? d.bcSidePurchasePriceCents - d.aSidePurchasePriceCents - (d.transactionalFunderFeeCents ?? 0)
                    : null;
                  return (
                    <tr
                      key={d.id}
                      className="border-t border-border/40 hover:bg-accent/30 cursor-pointer"
                      onClick={() => navigate(`/double-close/${d.id}`)}
                    >
                      <td className="px-3 py-2.5">{d.aSellerName}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtUsd(d.aSidePurchasePriceCents)}</td>
                      <td className="px-3 py-2.5">{d.bcBuyerName ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtUsd(d.bcSidePurchasePriceCents)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtUsd(d.transactionalFunderFeeCents)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-semibold ${net !== null && net < 0 ? "text-acr-neg" : net !== null ? "text-acr-pos" : ""}`}>
                        {fmtUsd(net)}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{STATUS_LABELS[d.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateDealDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageShell>
  );
}

function DoubleCloseDetail({ dealId }: { dealId: string }) {
  useDocumentTitle("Double-close deal — AcreOS");
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ deal: Deal; netToWholesalerCents: number | null }>({
    queryKey: ["/api/double-close", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/double-close/${dealId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const patch = useMutation({
    mutationFn: async (body: Partial<Deal>) => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/double-close/${dealId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/double-close", dealId] });
      queryClient.invalidateQueries({ queryKey: ["/api/double-close"] });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <PageShell><Skeleton className="h-12 w-72 mb-4" /><Skeleton className="h-64" /></PageShell>;
  }
  if (!data) {
    return <PageShell><Card><div className="p-6">Not found.</div></Card></PageShell>;
  }
  const { deal, netToWholesalerCents } = data;

  return (
    <PageShell>
      <Link href="/double-close">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back
        </Button>
      </Link>

      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{deal.aSellerName} → {deal.bcBuyerName ?? "(buyer TBD)"}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Reason: {REASON_LABELS[deal.reason]}{deal.state ? ` · ${deal.state}` : ""}
          </p>
        </div>
        <Select value={deal.status} onValueChange={(v) => patch.mutate({ status: v as Status })}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Two-side layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <ContractSide
          title="A-side (seller → wholesaler)"
          primary={fmtUsd(deal.aSidePurchasePriceCents)}
          rows={[
            ["Seller", deal.aSellerName],
            ["Contract date", formatDate(deal.aSideContractDate)],
            ["Closing date", formatDate(deal.aSideClosingDate)],
            ["Title company", deal.aSideTitleCompany ?? "—"],
          ]}
        />
        <ContractSide
          title="B-C side (wholesaler → buyer)"
          primary={fmtUsd(deal.bcSidePurchasePriceCents)}
          rows={[
            ["Buyer", deal.bcBuyerName ?? "—"],
            ["Contract date", formatDate(deal.bcSideContractDate)],
            ["Closing date", formatDate(deal.bcSideClosingDate)],
            ["Title company", deal.bcSideTitleCompany ?? "—"],
          ]}
        />
      </div>

      {/* Funder + net */}
      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Transactional funder + net</h2>
          <Separator className="mb-3" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <KV label="Funder" value={deal.transactionalFunderName ?? "—"} />
            <KV label="Fee" value={fmtUsd(deal.transactionalFunderFeeCents)} mono />
            <KV
              label="Rate"
              value={deal.transactionalFunderRateBps != null ? `${(deal.transactionalFunderRateBps / 100).toFixed(2)}%` : "—"}
              mono
            />
            <KV
              label="Net to wholesaler"
              value={fmtUsd(netToWholesalerCents)}
              mono
              tone={netToWholesalerCents != null && netToWholesalerCents < 0 ? "neg" : "pos"}
            />
          </div>
        </div>
      </Card>

      {deal.notes && (
        <Card>
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">Notes</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{deal.notes}</p>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function ContractSide({
  title,
  primary,
  rows,
}: {
  title: string;
  primary: string;
  rows: Array<[string, string]>;
}) {
  return (
    <Card>
      <div className="p-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="text-3xl font-semibold tracking-tight mt-2">{primary}</div>
        <Separator className="my-3" />
        <dl className="space-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground text-xs">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function KV({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "pos" | "neg" }) {
  const toneClass = tone === "pos" ? "text-acr-pos" : tone === "neg" ? "text-acr-neg" : "";
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono" : ""} ${toneClass}`}>{value}</dd>
    </div>
  );
}

function CreateDealDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [aSeller, setASeller] = useState("");
  const [aPrice, setAPrice] = useState("");
  const [bcBuyer, setBcBuyer] = useState("");
  const [bcPrice, setBcPrice] = useState("");
  const [funderName, setFunderName] = useState("");
  const [funderFee, setFunderFee] = useState("");
  const [reason, setReason] = useState<Reason>("operator_choice");
  const [state, setState] = useState("");
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch("/api/double-close", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({
          aSellerName: aSeller.trim(),
          aSidePurchasePriceCents: Math.round(parseFloat(aPrice.replace(/[$,\s]/g, "")) * 100),
          bcBuyerName: bcBuyer.trim() || undefined,
          bcSidePurchasePriceCents: bcPrice ? Math.round(parseFloat(bcPrice.replace(/[$,\s]/g, "")) * 100) : undefined,
          transactionalFunderName: funderName.trim() || undefined,
          transactionalFunderFeeCents: funderFee ? Math.round(parseFloat(funderFee.replace(/[$,\s]/g, "")) * 100) : undefined,
          reason,
          state: state.toUpperCase() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Create failed");
      return res.json() as Promise<{ deal: Deal }>;
    },
    onSuccess: ({ deal }) => {
      toast({ title: "Double-close created" });
      queryClient.invalidateQueries({ queryKey: ["/api/double-close"] });
      onOpenChange(false);
      navigate(`/double-close/${deal.id}`);
    },
    onError: (err: any) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New double-close</DialogTitle>
          <DialogDescription>
            Capture both sides + funder. Status defaults to "planned"; advance
            from the detail page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dc-reason" className="text-xs">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
                <SelectTrigger id="dc-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(REASON_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-state" className="text-xs">State</Label>
              <Input id="dc-state" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dc-aseller" className="text-xs">A seller name *</Label>
              <Input id="dc-aseller" value={aSeller} onChange={(e) => setASeller(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-aprice" className="text-xs">A→B price $ *</Label>
              <Input id="dc-aprice" inputMode="decimal" value={aPrice} onChange={(e) => setAPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-bcbuyer" className="text-xs">B-C buyer name</Label>
              <Input id="dc-bcbuyer" value={bcBuyer} onChange={(e) => setBcBuyer(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-bcprice" className="text-xs">B-C price $</Label>
              <Input id="dc-bcprice" inputMode="decimal" value={bcPrice} onChange={(e) => setBcPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-funder" className="text-xs">Funder name</Label>
              <Input id="dc-funder" value={funderName} onChange={(e) => setFunderName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-fee" className="text-xs">Funder fee $</Label>
              <Input id="dc-fee" inputMode="decimal" value={funderFee} onChange={(e) => setFunderFee(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dc-notes" className="text-xs">Notes</Label>
            <Textarea id="dc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submit.mutate()} disabled={!aSeller || !aPrice || submit.isPending}>
            {submit.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
