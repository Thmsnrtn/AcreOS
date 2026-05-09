/**
 * /founder/compliance-ops — consolidated compliance + ops dashboard.
 *
 * Tabs: DSAR / Fair-Lending / Vendor Telemetry / Disclosure-Timing /
 * Reconciliation / Pricing-A/B. Each tab consumes an existing endpoint
 * shipped earlier in the panel-300 wave.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, RefreshCw, Beaker, Coins, Server, FileText } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function fmtUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function FounderComplianceOpsPage() {
  useDocumentTitle("Compliance & Ops — AcreOS");
  const { toast } = useToast();
  const [tab, setTab] = useState("dsar");

  // ── DSAR ────────────────────────────────────────────────────────
  const dsar = useQuery<{
    rows: Array<any>;
    summary: { total: number; overdueCount: number; withinSlaCount: number; fulfilledCount: number; overdue: any[] };
  }>({
    queryKey: ["/api/founder/dsar/recent"],
    queryFn: async () => {
      const r = await fetch("/api/founder/dsar/recent", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  const selfTestDsar = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/founder/dsar/self-test", {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Self-test DSAR fired" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/dsar/recent"] });
    },
  });

  // ── Fair-Lending ────────────────────────────────────────────────
  const fairLending = useQuery<{
    rows: Array<any>;
    summary: { total: number; divergent: number; ok: number; insufficient: number };
  }>({
    queryKey: ["/api/founder/compliance/fair-lending"],
    queryFn: async () => {
      const r = await fetch("/api/founder/compliance/fair-lending", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  const runFairLending = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/founder/compliance/fair-lending/run", {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: `Fair-lending audit: ${data.outcomes?.length ?? 0} orgs evaluated` });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/compliance/fair-lending"] });
    },
  });

  // ── Vendor Telemetry ────────────────────────────────────────────
  const vendorTelemetry = useQuery<{ metrics: any[]; referralFees: any[] }>({
    queryKey: ["/api/founder/compliance/vendor-telemetry"],
    queryFn: async () => {
      const r = await fetch("/api/founder/compliance/vendor-telemetry", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  // ── Disclosure-Timing ───────────────────────────────────────────
  const runDisclosure = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/founder/compliance/disclosure-timing/run", {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Disclosure-timing dispatch ran",
        description: `${data.sent} sent · ${data.skipped} skipped · ${data.failed} failed (of ${data.total})`,
      });
    },
  });

  // ── Reconciliation ──────────────────────────────────────────────
  const runReconciliation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/founder/compliance/reconciliation/run", {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
    onSuccess: (data: any) => {
      const ok = data.results?.filter((r: any) => r.status === "ok").length ?? 0;
      const div = data.results?.filter((r: any) => r.status === "divergent").length ?? 0;
      const fail = data.results?.filter((r: any) => r.status === "failing").length ?? 0;
      toast({
        title: "Reconciliation ran",
        description: `${ok} ok · ${div} divergent · ${fail} failing`,
      });
    },
  });

  // ── Pricing experiments ─────────────────────────────────────────
  const pricing = useQuery<{ rows: Array<any> }>({
    queryKey: ["/api/founder/pricing-experiments"],
    queryFn: async () => {
      const r = await fetch("/api/founder/pricing-experiments", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  return (
    <PageShell label="Compliance & Ops">
      <div className="mb-6 flex items-start gap-3">
        <ShieldCheck className="w-7 h-7 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance & Ops</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            DSAR SLA, fair-lending audit, vendor adoption, disclosure timing,
            reconciliation runs, pricing-experiment summaries — everything that
            reads as "is this audit-ready?"
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-3 lg:grid-cols-6 mb-4">
          <TabsTrigger value="dsar"><FileText className="w-3.5 h-3.5 mr-1" /> DSAR</TabsTrigger>
          <TabsTrigger value="fair-lending"><AlertTriangle className="w-3.5 h-3.5 mr-1" /> Fair-Lending</TabsTrigger>
          <TabsTrigger value="vendor"><Server className="w-3.5 h-3.5 mr-1" /> Vendors</TabsTrigger>
          <TabsTrigger value="disclosure"><RefreshCw className="w-3.5 h-3.5 mr-1" /> Disclosures</TabsTrigger>
          <TabsTrigger value="recon"><Coins className="w-3.5 h-3.5 mr-1" /> Reconcile</TabsTrigger>
          <TabsTrigger value="pricing"><Beaker className="w-3.5 h-3.5 mr-1" /> Pricing-A/B</TabsTrigger>
        </TabsList>

        {/* DSAR */}
        <TabsContent value="dsar">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">DSAR — 24h SLA</CardTitle>
                <CardDescription>Data subject access requests. Overdue rows must be fulfilled before the next audit.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => selfTestDsar.mutate()} disabled={selfTestDsar.isPending}>
                Fire self-test
              </Button>
            </CardHeader>
            <CardContent>
              {dsar.isLoading ? <Skeleton className="h-32" /> : dsar.data ? (
                <>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <Stat label="Total" value={dsar.data.summary.total} tone="neutral" />
                    <Stat label="Overdue" value={dsar.data.summary.overdueCount} tone={dsar.data.summary.overdueCount > 0 ? "warn" : "pos"} />
                    <Stat label="Within SLA" value={dsar.data.summary.withinSlaCount} tone="neutral" />
                    <Stat label="Fulfilled" value={dsar.data.summary.fulfilledCount} tone="pos" />
                  </div>
                  {dsar.data.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No DSARs yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border">
                          <th className="text-left p-2">Type</th>
                          <th className="text-left p-2">Email</th>
                          <th className="text-left p-2">Received</th>
                          <th className="text-left p-2">SLA deadline</th>
                          <th className="text-left p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dsar.data.rows.slice(0, 50).map((r: any) => {
                          const overdue = !r.fulfilledAt && new Date(r.slaDeadlineAt).getTime() < Date.now();
                          return (
                            <tr key={r.id} className="border-b border-border/40">
                              <td className="p-2 text-xs">{r.requestType}</td>
                              <td className="p-2 text-xs">{r.requesterEmail}{r.isSelfTest && <Badge variant="outline" className="ml-1 text-[10px]">test</Badge>}</td>
                              <td className="p-2 text-xs">{fmtTime(r.receivedAt)}</td>
                              <td className="p-2 text-xs">{fmtTime(r.slaDeadlineAt)}</td>
                              <td className="p-2">
                                {r.fulfilledAt ? (
                                  <Badge variant="default" className="text-xs">Fulfilled</Badge>
                                ) : overdue ? (
                                  <Badge variant="destructive" className="text-xs">Overdue</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">Within SLA</Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fair-Lending */}
        <TabsContent value="fair-lending">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Fair-Lending audit</CardTitle>
                <CardDescription>Monthly disparate-impact analysis (zip-prefix proxy). ≥5% divergence flags.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => runFairLending.mutate()} disabled={runFairLending.isPending}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${runFairLending.isPending ? "animate-spin" : ""}`} /> Run audit
              </Button>
            </CardHeader>
            <CardContent>
              {fairLending.isLoading ? <Skeleton className="h-32" /> : fairLending.data ? (
                <>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <Stat label="Runs" value={fairLending.data.summary.total} tone="neutral" />
                    <Stat label="OK" value={fairLending.data.summary.ok} tone="pos" />
                    <Stat label="Divergent" value={fairLending.data.summary.divergent} tone={fairLending.data.summary.divergent > 0 ? "warn" : "pos"} />
                    <Stat label="Insufficient" value={fairLending.data.summary.insufficient} tone="neutral" />
                  </div>
                  {fairLending.data.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No audit runs yet. Click "Run audit" to start.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border">
                          <th className="text-left p-2">Org</th>
                          <th className="text-left p-2">Period</th>
                          <th className="text-right p-2">Sample</th>
                          <th className="text-right p-2">Approval rate</th>
                          <th className="text-right p-2">Max divergence</th>
                          <th className="text-left p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fairLending.data.rows.slice(0, 50).map((r: any) => (
                          <tr key={r.id} className="border-b border-border/40">
                            <td className="p-2 text-xs">#{r.organizationId}</td>
                            <td className="p-2 text-xs">{r.periodKey}</td>
                            <td className="p-2 text-xs text-right">{r.sampleSize}</td>
                            <td className="p-2 text-xs text-right">{r.approvalRateOverall ? (Number(r.approvalRateOverall) * 100).toFixed(1) + "%" : "—"}</td>
                            <td className="p-2 text-xs text-right">{r.maxDivergencePct ? Number(r.maxDivergencePct).toFixed(1) + "%" : "—"}</td>
                            <td className="p-2">
                              {r.status === "ok" ? (
                                <Badge variant="default" className="text-xs">OK</Badge>
                              ) : r.status === "divergent" ? (
                                <Badge variant="destructive" className="text-xs">Divergent</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">Insufficient sample</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vendor Telemetry */}
        <TabsContent value="vendor">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vendor adoption + referral-fee transparency</CardTitle>
              <CardDescription>5 vendors instrumented. Referral fees feed the public /transparency/vendor-partnerships page.</CardDescription>
            </CardHeader>
            <CardContent>
              <VendorMetricForm onSubmit={() => queryClient.invalidateQueries({ queryKey: ["/api/founder/compliance/vendor-telemetry"] })} />
              {vendorTelemetry.isLoading ? <Skeleton className="h-32" /> : vendorTelemetry.data ? (
                <>
                  <h3 className="text-sm font-medium mb-2">Adoption metrics</h3>
                  {vendorTelemetry.data.metrics.length === 0 ? (
                    <p className="text-sm text-muted-foreground mb-4">No metrics recorded yet — capture via cron or POST.</p>
                  ) : (
                    <table className="w-full text-sm mb-4">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border">
                          <th className="text-left p-2">Vendor</th>
                          <th className="text-left p-2">Metric</th>
                          <th className="text-left p-2">Period</th>
                          <th className="text-right p-2">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorTelemetry.data.metrics.slice(0, 30).map((m: any) => (
                          <tr key={m.id} className="border-b border-border/40">
                            <td className="p-2 text-xs">{m.vendor}</td>
                            <td className="p-2 text-xs">{m.metricKey}</td>
                            <td className="p-2 text-xs">{m.periodKey}</td>
                            <td className="p-2 text-xs text-right font-mono">{m.value} {m.unit ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <h3 className="text-sm font-medium mb-2">Referral fees ({vendorTelemetry.data.referralFees.length})</h3>
                  {vendorTelemetry.data.referralFees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No referral relationships recorded.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border">
                          <th className="text-left p-2">Vendor</th>
                          <th className="text-left p-2">Kind</th>
                          <th className="text-left p-2">Structure</th>
                          <th className="text-left p-2">Disclosed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorTelemetry.data.referralFees.map((f: any) => (
                          <tr key={f.id} className="border-b border-border/40">
                            <td className="p-2 text-xs">{f.vendor}</td>
                            <td className="p-2 text-xs">{f.relationshipKind}</td>
                            <td className="p-2 text-xs">{f.feeStructure}</td>
                            <td className="p-2">{f.publicDisclosed ? <Badge variant="default" className="text-xs">Public</Badge> : <Badge variant="outline" className="text-xs">Private</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Disclosure-Timing */}
        <TabsContent value="disclosure">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Disclosure-timing dispatcher</CardTitle>
              <CardDescription>
                Cron fires every hour. Manual trigger flushes the scheduled queue immediately.
                Skipped rows = statutory_form not yet attorney-reviewed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => runDisclosure.mutate()} disabled={runDisclosure.isPending}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${runDisclosure.isPending ? "animate-spin" : ""}`} /> Run dispatcher now
              </Button>
              <p className="mt-4 text-xs text-muted-foreground">
                Dispatcher sends scheduled disclosure emails. closing_date - 3 days = send_date by construction.
                TILA timing violations become impossible from manual workflow.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reconciliation */}
        <TabsContent value="recon">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reconciliation cron</CardTitle>
              <CardDescription>
                Stripe / wire / 1099 / SendGrid sources vs AcreOS DB totals. Divergence &gt; tolerance flags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => runReconciliation.mutate()} disabled={runReconciliation.isPending}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${runReconciliation.isPending ? "animate-spin" : ""}`} /> Run reconciliation now
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pricing-A/B */}
        <TabsContent value="pricing">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pricing-elasticity experiments</CardTitle>
              <CardDescription>Aggregate by (experiment, variant). $199 vs $249 Solo before Series-A pitch.</CardDescription>
            </CardHeader>
            <CardContent>
              {pricing.isLoading ? <Skeleton className="h-32" /> : pricing.data && pricing.data.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No experiments running yet. Wire assignments via the pricing page.</p>
              ) : pricing.data ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-left p-2">Experiment</th>
                      <th className="text-left p-2">Variant</th>
                      <th className="text-right p-2">Assignments</th>
                      <th className="text-right p-2">Conversions</th>
                      <th className="text-right p-2">Conv. rate</th>
                      <th className="text-right p-2">Avg revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricing.data.rows.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="p-2 text-xs">{r.experimentKey}</td>
                        <td className="p-2 text-xs">{r.variantKey}</td>
                        <td className="p-2 text-xs text-right">{r.assignments}</td>
                        <td className="p-2 text-xs text-right">{r.conversions}</td>
                        <td className="p-2 text-xs text-right">{r.conversionRate}%</td>
                        <td className="p-2 text-xs text-right">{fmtUsdCents(r.avgRevenuePerAssignmentCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function VendorMetricForm({ onSubmit }: { onSubmit: () => void }) {
  const { toast } = useToast();
  const [vendor, setVendor] = useState("");
  const [metricKey, setMetricKey] = useState("");
  const [periodKey, setPeriodKey] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    try {
      const r = await fetch("/api/founder/compliance/vendor-telemetry", {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({
          vendor, metricKey, periodKey, value: Number(value), unit: unit || undefined,
        }),
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${r.status})`);
      }
      toast({ title: "Vendor metric recorded" });
      setVendor(""); setMetricKey(""); setPeriodKey(""); setValue(""); setUnit("");
      onSubmit();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <details className="mb-4 border border-border rounded-md p-3">
      <summary className="text-sm font-medium cursor-pointer">Add vendor metric</summary>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-3">
        <input className="border border-border rounded-md px-2 py-1 text-sm bg-background" placeholder="vendor (e.g., stripe)" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <input className="border border-border rounded-md px-2 py-1 text-sm bg-background" placeholder="metric_key (e.g., adoption_pct)" value={metricKey} onChange={(e) => setMetricKey(e.target.value)} />
        <input className="border border-border rounded-md px-2 py-1 text-sm bg-background" placeholder="period (YYYY-MM)" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
        <input type="number" className="border border-border rounded-md px-2 py-1 text-sm bg-background" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <input className="border border-border rounded-md px-2 py-1 text-sm bg-background" placeholder="unit (pct/count/sec)" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <Button size="sm" className="mt-2" onClick={submit} disabled={pending || !vendor || !metricKey || !periodKey || !value}>
        {pending ? "Recording…" : "Record metric"}
      </Button>
    </details>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "pos" | "neg" | "warn" | "neutral" }) {
  const toneClass =
    tone === "pos" ? "text-acr-pos" :
    tone === "neg" ? "text-acr-neg" :
    tone === "warn" ? "text-acr-warn" :
    "text-foreground";
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${toneClass}`}>{value}</div>
    </Card>
  );
}
