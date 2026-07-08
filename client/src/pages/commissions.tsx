import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge as CanonicalStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import {
  DollarSign,
  Download,
  Trophy,
  Users,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Verbs } from "@/lib/labels";

interface CommissionTier {
  minDeals: number;
  ratePercent: number;
  label: string;
}

interface CommissionConfig {
  tiers: CommissionTier[];
  baseFlatAmount?: number;
  trackingPeriod: "monthly" | "quarterly" | "annual";
}

interface CommissionRecord {
  id: string;
  teamMemberId: number;
  dealId: number;
  dealClosedAt: string;
  salePrice: number;
  commissionRatePercent: number;
  commissionAmountCents: number;
  flatBonusCents: number;
  totalOwedCents: number;
  paidCents: number;
  status: "owed" | "partial" | "paid";
}

interface AgentSummary {
  teamMemberId: number;
  displayName: string;
  email: string;
  ytdDeals: number;
  ytdSaleVolumeCents: number;
  ytdOwedCents: number;
  ytdPaidCents: number;
  ytdOutstandingCents: number;
  currentTier: CommissionTier | null;
  records: CommissionRecord[];
}

// Money helpers — commission records preserve cents (individual
// commission amounts can be partial-dollar values like $1,234.56);
// KPI cards round to whole dollars for compact display.
function money(cents: number) {
  return usd(cents / 100);
}
function moneyKpi(cents: number) {
  return usd(cents / 100, { noCents: true });
}

const reassurance = "The commission record is unchanged — try again.";

function StatusBadge({ status }: { status: CommissionRecord["status"] }) {
  if (status === "paid") return <CanonicalStatusBadge status="success" label="Paid" />;
  if (status === "partial") return <CanonicalStatusBadge status="pending" label="Partial" />;
  return <CanonicalStatusBadge status="error" label="Owed" />;
}

function AgentCard({
  summary,
  year,
  onPayClick,
}: {
  summary: AgentSummary;
  year: number;
  onPayClick: (summary: AgentSummary) => void;
}) {
  const initials = summary.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-full bg-acr-brand flex items-center justify-center text-acr-brand-ink text-sm font-bold shrink-0"
              aria-hidden="true"
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{summary.displayName}</p>
              <p className="text-sm text-muted-foreground truncate">{summary.email}</p>
            </div>
          </div>
          {summary.currentTier && (
            <Badge
              variant="outline"
              className="text-xs shrink-0"
              aria-label={`Current commission tier: ${summary.currentTier.label}, ${summary.currentTier.ratePercent} percent rate`}
            >
              <Trophy className="w-3 h-3 mr-1" aria-hidden="true" />
              {summary.currentTier.label} (<span className="tabular-nums">{summary.currentTier.ratePercent}%</span>)
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <dt className="text-xs text-muted-foreground">Deals closed (YTD)</dt>
            <dd className="text-xl font-bold tabular-nums">{summary.ytdDeals}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Sale volume</dt>
            <dd className="text-xl font-bold tabular-nums">
              {moneyKpi(summary.ytdSaleVolumeCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Commission owed</dt>
            <dd className="text-xl font-bold text-acr-warn tabular-nums">
              {moneyKpi(summary.ytdOwedCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Outstanding</dt>
            <dd
              className={`text-xl font-bold tabular-nums ${
                summary.ytdOutstandingCents > 0
                  ? "text-acr-neg"
                  : "text-acr-pos"
              }`}
            >
              {moneyKpi(summary.ytdOutstandingCents)}
            </dd>
          </div>
        </dl>
        <div className="flex gap-2">
          {summary.ytdOutstandingCents > 0 && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onPayClick(summary)}
              aria-label={`Record commission payment for ${summary.displayName}`}
            >
              <DollarSign className="w-3 h-3 mr-1" aria-hidden="true" />
              Record payment
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.open(
                `/api/commissions/statement/${summary.teamMemberId}?year=${year}`,
                "_blank"
              );
            }}
            aria-label={`Download ${year} commission statement for ${summary.displayName} (opens in new tab)`}
          >
            <Download className="w-3 h-3 mr-1" aria-hidden="true" />
            Statement
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentDialog({
  summary,
  onClose,
  onPay,
}: {
  summary: AgentSummary | null;
  onClose: () => void;
  onPay: (commissionId: string, cents: number) => void;
}) {
  const [selectedRecord, setSelectedRecord] = useState<string>("");
  const [amount, setAmount] = useState("");
  const recordSelectId = useId();
  const amountInputId = useId();

  if (!summary) return null;

  const unpaid = summary.records.filter((r) => r.status !== "paid");
  const dollars = parseFloat(amount);
  const canSubmit = !!selectedRecord && Number.isFinite(dollars) && dollars > 0;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    onPay(selectedRecord, Math.round(dollars * 100));
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record commission payment — {summary.displayName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor={recordSelectId}>Commission record</Label>
              <Select value={selectedRecord} onValueChange={setSelectedRecord}>
                <SelectTrigger id={recordSelectId}>
                  <SelectValue placeholder="Select commission record…" />
                </SelectTrigger>
                <SelectContent>
                  {unpaid.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Deal #{r.dealId} — outstanding:{" "}
                      {money(r.totalOwedCents - r.paidCents)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={amountInputId}>Payment amount ($)</Label>
              <Input
                id={amountInputId}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {Verbs.CANCEL}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CommissionsPage() {
  useDocumentTitle("Commissions");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [payTarget, setPayTarget] = useState<AgentSummary | null>(null);
  const yearSelectId = useId();

  const { data: summaries = [], isLoading } = useQuery<AgentSummary[]>({
    queryKey: ["/api/commissions/summaries", year],
    queryFn: () =>
      apiRequest("GET", `/api/commissions/summaries?year=${year}`).then((r) =>
        r.json()
      ),
  });

  const { data: config } = useQuery<CommissionConfig>({
    queryKey: ["/api/commissions/config"],
    queryFn: () =>
      apiRequest("GET", "/api/commissions/config").then((r) => r.json()),
  });

  const payMutation = useMutation({
    mutationFn: ({
      commissionId,
      paidCents,
    }: {
      commissionId: string;
      paidCents: number;
    }) =>
      apiRequest("POST", `/api/commissions/${commissionId}/pay`, {
        paidCents,
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commissions/summaries"] });
      toast({ title: "Payment recorded" });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't record payment",
        description: `${err.message ?? "Network error"}. ${reassurance}`,
        variant: "destructive",
      });
    },
  });

  // Defensive: API response shape can drift (records missing, numeric fields
  // returned as strings or null). Reduce + map on summaries.records previously
  // threw a synchronous TypeError when any field was undefined, blowing up
  // the page into the Server-Error boundary even on legit data with one
  // edge-case row. Coerce to safe defaults at the boundary.
  const safeSummaries = Array.isArray(summaries) ? summaries : [];
  const totalOwed = safeSummaries.reduce((s, a) => s + (a.ytdOwedCents ?? 0), 0);
  const totalOutstanding = safeSummaries.reduce(
    (s, a) => s + (a.ytdOutstandingCents ?? 0),
    0
  );
  const totalDeals = safeSummaries.reduce((s, a) => s + (a.ytdDeals ?? 0), 0);

  const availableYears = [
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() - 2,
  ];

  return (
    <PageShell label="Commissions">
      <div className="space-y-6">
        {/* Year selector */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor={yearSelectId} className="sr-only">Commission year</Label>
            <Select
              value={String(year)}
              onValueChange={(v) => setYear(parseInt(v))}
            >
              <SelectTrigger id={yearSelectId} className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary stats */}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-acr-accent" aria-hidden="true" />
                <div>
                  <dd className="text-2xl font-bold tabular-nums">{safeSummaries.length}</dd>
                  <dt className="text-sm text-muted-foreground">Agents</dt>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-acr-pos" aria-hidden="true" />
                <div>
                  <dd className="text-2xl font-bold tabular-nums">{totalDeals}</dd>
                  <dt className="text-sm text-muted-foreground">Deals closed</dt>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <DollarSign className="w-8 h-8 text-acr-warn" aria-hidden="true" />
                <div>
                  <dd className="text-2xl font-bold tabular-nums">{moneyKpi(totalOwed)}</dd>
                  <dt className="text-sm text-muted-foreground">Total commissions</dt>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertCircle
                  className={`w-8 h-8 ${
                    totalOutstanding > 0 ? "text-acr-neg" : "text-acr-pos"
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <dd className="text-2xl font-bold tabular-nums">{moneyKpi(totalOutstanding)}</dd>
                  <dt className="text-sm text-muted-foreground">Outstanding</dt>
                </div>
              </div>
            </CardContent>
          </Card>
        </dl>

        <Tabs defaultValue="agents">
          <TabsList>
            <TabsTrigger value="agents">By agent</TabsTrigger>
            <TabsTrigger value="records">All records</TabsTrigger>
            <TabsTrigger value="tiers">Tier config</TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="mt-4">
            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" role="status" aria-busy="true" aria-live="polite">
                <span className="sr-only">Loading agent summaries</span>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <Skeleton announce={false} className="h-5 w-32" />
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Skeleton announce={false} className="h-8 w-24" />
                      <Skeleton announce={false} className="h-4 w-full" />
                      <Skeleton announce={false} className="h-4 w-2/3" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : safeSummaries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No team members found.
              </div>
            ) : (
              <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0" aria-label="Commission summary by agent">
                {safeSummaries.map((s) => (
                  <li key={s.teamMemberId}>
                    <AgentCard
                      summary={s}
                      year={year}
                      onPayClick={setPayTarget}
                    />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="records" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <div role="region" aria-label="All commission records" tabIndex={0}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Agent</TableHead>
                        <TableHead scope="col">Deal #</TableHead>
                        <TableHead scope="col">Closed</TableHead>
                        <TableHead scope="col">Sale price</TableHead>
                        <TableHead scope="col">Rate</TableHead>
                        <TableHead scope="col">Commission</TableHead>
                        <TableHead scope="col">Paid</TableHead>
                        <TableHead scope="col">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {safeSummaries.flatMap((s) =>
                        (s.records ?? []).map((r) => {
                          // Guard date parse — Date(null/invalid) → "Invalid
                          // Date" → format() throws → ErrorBoundary kills the
                          // whole page. Show a dash instead.
                          let closedLabel: ReactNode = "—";
                          if (r.dealClosedAt) {
                            const d = new Date(r.dealClosedAt);
                            if (!Number.isNaN(d.getTime())) {
                              closedLabel = (
                                <time dateTime={r.dealClosedAt}>
                                  {format(d, "MMM d, yyyy")}
                                </time>
                              );
                            }
                          }
                          return (
                            <TableRow key={r.id}>
                              <TableCell scope="row" className="font-medium">
                                {s.displayName}
                              </TableCell>
                              <TableCell className="tabular-nums">#{r.dealId}</TableCell>
                              <TableCell>{closedLabel}</TableCell>
                              <TableCell className="tabular-nums">{money(r.salePrice)}</TableCell>
                              <TableCell className="tabular-nums">{r.commissionRatePercent}%</TableCell>
                              <TableCell className="tabular-nums">{money(r.totalOwedCents)}</TableCell>
                              <TableCell className="tabular-nums">{money(r.paidCents)}</TableCell>
                              <TableCell>
                                <StatusBadge status={r.status} />
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                      {safeSummaries.every((s) => (s.records ?? []).length === 0) && (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="text-center text-muted-foreground py-8"
                          >
                            No commission records for {year}.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tiers" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Commission tiers</CardTitle>
              </CardHeader>
              <CardContent>
                {config ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Tracking period:{" "}
                      <span className="font-medium capitalize">
                        {config.trackingPeriod}
                      </span>
                    </p>
                    <div role="region" aria-label="Commission tier configuration" tabIndex={0}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead scope="col">Tier</TableHead>
                            <TableHead scope="col">Min deals</TableHead>
                            <TableHead scope="col">Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {config.tiers.map((t, i) => (
                            <TableRow key={i}>
                              <TableCell scope="row" className="font-medium">
                                {t.label}
                              </TableCell>
                              <TableCell className="tabular-nums">{t.minDeals}+</TableCell>
                              <TableCell className="tabular-nums">{t.ratePercent}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {config.baseFlatAmount && config.baseFlatAmount > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Flat bonus per deal:{" "}
                        <span className="font-medium tabular-nums">
                          {money(config.baseFlatAmount)}
                        </span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
                    <span className="sr-only">Loading tier configuration</span>
                    <Skeleton announce={false} className="h-4 w-48" />
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <Skeleton announce={false} className="h-4 w-32" />
                        <Skeleton announce={false} className="h-4 w-20" />
                        <Skeleton announce={false} className="h-4 w-16" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {payTarget && (
        <PaymentDialog
          summary={payTarget}
          onClose={() => setPayTarget(null)}
          onPay={(id, cents) => payMutation.mutate({ commissionId: id, paidCents: cents })}
        />
      )}
    </PageShell>
  );
}
