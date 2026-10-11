/**
 * Creator revenue share + the open W3 pricing decisions — a section of the
 * Controls door (/founder/autopilot/control). Not a new founder route.
 *
 * Shows what the server computed and nothing else: attributed signups, paid
 * conversions, and what is owed — which is null, and said so, while the
 * founder has not set the commission rate. Payouts are approved here and paid
 * by the founder outside AcreOS; the founder records the payment reference.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";

interface Decision {
  key: string;
  question: string;
  status: "pending" | "set";
  value: string | null;
  whereToSet: string;
}

interface CreatorRow {
  id: number;
  code: string;
  displayName: string;
  status: string;
  attributedSignups: number;
  paidConversions: number;
  paidRevenueCents: number;
  owedCents: number | null;
  approvedCents: number;
  paidOutCents: number;
  awaitingRate: number;
  approvedBatches: Array<{ batch: string; amountCents: number }>;
}

interface LedgerResponse {
  commissionBps: number | null;
  refusal: string | null;
  creators: CreatorRow[];
  decisions: Decision[];
}

const KEY = ["founder", "creators"] as const;

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.message === "string" ? json.message : `Request failed (${res.status})`);
  return json;
}

export function CreatorProgramSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");

  const q = useQuery<LedgerResponse>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch("/api/founder/creators", { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the creator program (${res.status})`);
      return res.json();
    },
  });

  const add = useMutation({
    mutationFn: () => post("/api/founder/creators", { code, displayName: name, contact: contact || undefined }),
    onSuccess: () => {
      setCode("");
      setName("");
      setContact("");
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Creator added" });
    },
    onError: (e: Error) => toast({ title: "Not added", description: e.message, variant: "destructive" }),
  });

  const [refs, setRefs] = useState<Record<string, string>>({});
  const markPaid = useMutation({
    mutationFn: (batch: string) => post(`/api/founder/creators/payouts/${encodeURIComponent(batch)}/paid`, { reference: refs[batch] ?? "" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Payment recorded" });
    },
    onError: (e: Error) => toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (id: number) => post(`/api/founder/creators/${id}/approve`, {}),
    onSuccess: (r: { batch: string; amountCents: number }) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast({ title: "Payout approved", description: `${dollars(r.amountCents)} in batch ${r.batch}. Pay it from AcreOS's account, then record the reference.` });
    },
    onError: (e: Error) => toast({ title: "Not approved", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3" data-testid="creator-program">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Creators and open pricing decisions</h2>
        <span className="text-xs text-muted-foreground">— revenue share, paid only on paid conversions</span>
      </div>

      {q.isLoading && <Skeleton className="h-40 w-full rounded-lg" />}
      {q.isError && (
        <QueryErrorState error={q.error instanceof Error ? q.error : null} onRetry={() => q.refetch()} isRetrying={q.isFetching} testId="creator-program-error" />
      )}

      {q.data && (
        <Card>
          <CardContent className="space-y-5 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Waiting on you</h3>
              <ul className="mt-2 space-y-2">
                {q.data.decisions.map((d) => (
                  <li key={d.key} className="text-sm" data-testid={`decision-${d.key}`}>
                    <Badge variant={d.status === "pending" ? "outline" : "secondary"} className="mr-2">
                      {d.status === "pending" ? "Not set" : "Set"}
                    </Badge>
                    {d.question}
                    {d.value && <span className="text-muted-foreground"> — {d.value}</span>}
                    <span className="block text-xs text-muted-foreground">Set in {d.whereToSet}</span>
                  </li>
                ))}
              </ul>
            </div>

            {q.data.refusal && (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="creator-rate-unset">
                {q.data.refusal}
              </p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-foreground">Creators</h3>
              {q.data.creators.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No creators yet. Add one below; they share links ending in ?ref=CODE.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60">
                  {q.data.creators.map((c) => (
                    <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`creator-${c.code}`}>
                      <div className="text-sm">
                        <span className="font-medium text-foreground">{c.displayName}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.attributedSignups} signups · {c.paidConversions} paid conversions ({dollars(c.paidRevenueCents)} collected) · owed{" "}
                          {c.owedCents === null ? "not computed (rate not set)" : dollars(c.owedCents)} · approved {dollars(c.approvedCents)} · paid {dollars(c.paidOutCents)}
                        </span>
                      </div>
                      {c.approvedBatches.map((b) => (
                        <form
                          key={b.batch}
                          className="flex flex-wrap items-end gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            markPaid.mutate(b.batch);
                          }}
                        >
                          <div className="space-y-1">
                            <Label htmlFor={`ref-${b.batch}`} className="text-xs">
                              Paid {dollars(b.amountCents)} ({b.batch}) — your payment reference
                            </Label>
                            <Input
                              id={`ref-${b.batch}`}
                              value={refs[b.batch] ?? ""}
                              onChange={(e) => setRefs((r) => ({ ...r, [b.batch]: e.target.value }))}
                              required
                            />
                          </div>
                          <Button type="submit" size="sm" variant="secondary" disabled={markPaid.isPending}>
                            Record payment
                          </Button>
                        </form>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={c.owedCents === null || c.owedCents === 0 || approve.isPending}
                        onClick={() => approve.mutate(c.id)}
                        aria-label={`Approve payout for ${c.displayName}`}
                      >
                        {approve.isPending && approve.variables === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        Approve payout
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form
              className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="creator-code">Code</Label>
                <Input id="creator-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="creator-name">Name</Label>
                <Input id="creator-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="creator-contact">How to pay them (internal)</Label>
                <Input id="creator-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <Button type="submit" disabled={add.isPending}>
                Add creator
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
