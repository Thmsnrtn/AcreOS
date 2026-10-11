/**
 * Decisions door → Giving (W5a). $1 per paying member per month, AcreOS's own
 * money, to a food bank serving each member's area (founder decision
 * 2026-10-09).
 *
 * Everything here is the founder's: the monthly cap (unset ⇒ nothing can be
 * approved), the county → food bank mapping (entered by hand — no food-bank
 * directory we checked licenses reuse of its data), each month's approval,
 * and the receipt for money paid outside AcreOS. Only receipts reach members.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";

interface PledgeLine { state: string; county: string; members: number; cents: number; foodBankId: number | null; foodBankName: string | null }
interface GivingMonth {
  id: number;
  month: string;
  computedAt: string;
  payingMembers: number;
  membersWithoutCounty: number;
  lines: PledgeLine[];
  pledgeCents: number;
  status: "awaiting_founder" | "approved" | "declined";
  approvedCents: number | null;
}
interface FoodBank { id: number; state: string; county: string; name: string; website: string | null }
interface Receipt { id: number; month: string; foodBankId: number; amountCents: number; reference: string; paidOn: string }
interface GivingView { capCents: number | null; months: GivingMonth[]; foodBanks: FoodBank[]; receipts: Receipt[] }

const KEY = ["/api/founder/giving"];
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function GivingSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery<GivingView>({ queryKey: KEY, staleTime: 30_000 });
  const [cap, setCap] = useState("");
  const [bank, setBank] = useState({ state: "", county: "", name: "", website: "" });
  const [receipt, setReceipt] = useState({ month: "", foodBankId: "", amount: "", reference: "", paidOn: "" });

  const failed = (err: unknown) => toast({ title: "Not saved", description: err instanceof Error ? err.message : String(err), variant: "destructive" });

  const saveCap = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/founder/giving/cap", { capCents: Math.round(Number(cap) * 100) })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Monthly cap saved" });
    },
    onError: failed,
  });
  const saveBank = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/founder/giving/food-banks", { ...bank, website: bank.website.trim() || null })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Food bank saved" });
    },
    onError: failed,
  });
  const approve = useMutation({
    mutationFn: async (m: GivingMonth) => (await apiRequest("POST", `/api/founder/giving/months/${m.id}/approve`, { amountCents: m.pledgeCents })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Approved — pay it outside AcreOS, then add the receipt" });
    },
    onError: failed,
  });
  const decline = useMutation({
    mutationFn: async (m: GivingMonth) => (await apiRequest("POST", `/api/founder/giving/months/${m.id}/decline`)).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Declined" });
    },
    onError: failed,
  });
  const saveReceipt = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/founder/giving/receipts", {
          month: receipt.month,
          foodBankId: Number(receipt.foodBankId),
          amountCents: Math.round(Number(receipt.amount) * 100),
          reference: receipt.reference,
          paidOn: receipt.paidOn,
        })
      ).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Receipt recorded" });
    },
    onError: failed,
  });

  if (isError) return <QueryErrorState error={new Error("Giving could not be loaded")} title="Giving" onRetry={() => void refetch()} isRetrying={isRefetching} />;
  if (isLoading || !data) {
    return (
      <Card aria-hidden="true">
        <CardContent className="space-y-2 pt-6">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  const awaiting = data.months.filter((m) => m.status === "awaiting_founder");
  const given = data.receipts.reduce((s, r) => s + r.amountCents, 0);

  return (
    <Card data-testid="decisions-giving">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Giving — $1 per paying member a month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <section aria-labelledby="giving-waiting" className="space-y-1">
          <h3 id="giving-waiting" className="font-medium text-foreground">Waiting on you</h3>
          <ul className="list-disc pl-5 text-muted-foreground">
            {data.capCents == null ? <li>Set a monthly cap. Nothing can be approved until you do.</li> : null}
            {data.foodBanks.length === 0 ? <li>Enter the food bank for each county your members are in (by hand — see below).</li> : null}
            {awaiting.length > 0 ? <li>{awaiting.length} month(s) to approve or decline.</li> : null}
            {data.months.some((m) => m.status === "approved" && !data.receipts.some((r) => r.month === m.month)) ? (
              <li>Approved months with no receipt yet. Nothing counts as given until a receipt is recorded.</li>
            ) : null}
          </ul>
          <p className="text-muted-foreground">Given so far, with receipts: {usd(given)}.</p>
        </section>

        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); saveCap.mutate(); }}>
          <div className="space-y-1">
            <Label htmlFor="giving-cap">Monthly cap (USD)</Label>
            <Input id="giving-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder={data.capCents == null ? "not set" : (data.capCents / 100).toFixed(2)} className="w-32" />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={saveCap.isPending || !(Number(cap) >= 0) || cap.trim() === ""}>Save cap</Button>
          <span className="text-xs text-muted-foreground">Current: {data.capCents == null ? "not set" : usd(data.capCents)}</span>
        </form>

        {data.months.map((m) => (
          <div key={m.id} className="space-y-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">
                {m.month}: {usd(m.pledgeCents)} pledged · {m.payingMembers} paying member(s) counted {m.computedAt.slice(0, 10)}
              </p>
              <Badge variant={m.status === "approved" ? "default" : m.status === "declined" ? "outline" : "secondary"}>
                {m.status === "awaiting_founder" ? "awaiting you" : m.status === "approved" ? `approved ${usd(m.approvedCents ?? 0)}` : "declined"}
              </Badge>
            </div>
            <ul className="text-muted-foreground">
              {m.lines.map((l) => (
                <li key={`${l.state}-${l.county}`}>
                  {l.county}, {l.state}: {l.members} member(s) → {l.foodBankName ? `${l.foodBankName}, ${usd(l.cents)}` : "no food bank entered — not pledged"}
                </li>
              ))}
              {m.membersWithoutCounty > 0 ? <li>{m.membersWithoutCounty} member(s) with no county on file — not pledged.</li> : null}
            </ul>
            {m.status === "awaiting_founder" ? (
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => approve.mutate(m)} disabled={approve.isPending || m.pledgeCents <= 0}>Approve {usd(m.pledgeCents)}</Button>
                <Button size="sm" variant="outline" onClick={() => decline.mutate(m)} disabled={decline.isPending}>Decline</Button>
              </div>
            ) : null}
          </div>
        ))}

        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveBank.mutate(); }}>
          <p className="font-medium text-foreground">County → food bank</p>
          <p className="text-xs text-muted-foreground">
            Entered by you. We found no food-bank directory whose terms allow reusing its data, so AcreOS does not look these up.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label htmlFor="fb-state">State</Label><Input id="fb-state" maxLength={2} className="w-16" value={bank.state} onChange={(e) => setBank({ ...bank, state: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="fb-county">County</Label><Input id="fb-county" className="w-40" value={bank.county} onChange={(e) => setBank({ ...bank, county: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="fb-name">Food bank</Label><Input id="fb-name" className="w-56" value={bank.name} onChange={(e) => setBank({ ...bank, name: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="fb-web">Website (optional)</Label><Input id="fb-web" className="w-56" value={bank.website} onChange={(e) => setBank({ ...bank, website: e.target.value })} /></div>
            <Button type="submit" size="sm" variant="outline" disabled={saveBank.isPending}>{Verbs.SAVE}</Button>
          </div>
          {data.foodBanks.length > 0 ? (
            <ul className="text-muted-foreground">
              {data.foodBanks.map((f) => <li key={f.id}>{f.county}, {f.state} → {f.name}</li>)}
            </ul>
          ) : null}
        </form>

        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveReceipt.mutate(); }}>
          <p className="font-medium text-foreground">Record a receipt (money you paid outside AcreOS)</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label htmlFor="rc-month">Month</Label><Input id="rc-month" placeholder="2026-10" className="w-24" value={receipt.month} onChange={(e) => setReceipt({ ...receipt, month: e.target.value })} /></div>
            <div className="space-y-1">
              <Label htmlFor="rc-bank">Food bank</Label>
              <select id="rc-bank" className="h-9 rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={receipt.foodBankId} onChange={(e) => setReceipt({ ...receipt, foodBankId: e.target.value })}>
                <option value="">Choose…</option>
                {data.foodBanks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="rc-amount">Amount (USD)</Label><Input id="rc-amount" inputMode="decimal" className="w-24" value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="rc-ref">Receipt reference</Label><Input id="rc-ref" className="w-48" value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="rc-date">Paid on</Label><Input id="rc-date" type="date" className="w-40" value={receipt.paidOn} onChange={(e) => setReceipt({ ...receipt, paidOn: e.target.value })} /></div>
            <Button type="submit" size="sm" variant="outline" disabled={saveReceipt.isPending}>Record</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
