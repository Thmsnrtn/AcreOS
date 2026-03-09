import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { apiRequest } from "@/lib/queryClient";
import {
  DollarSign,
  Download,
  Trophy,
  Users,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";

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

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function StatusBadge({ status }: { status: CommissionRecord["status"] }) {
  if (status === "paid")
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Paid
      </Badge>
    );
  if (status === "partial")
    return (
      <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
        <Clock className="w-3 h-3 mr-1" />
        Partial
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
      <AlertCircle className="w-3 h-3 mr-1" />
      Owed
    </Badge>
  );
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
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
              {initials}
            </div>
            <div>
              <p className="font-semibold">{summary.displayName}</p>
              <p className="text-sm text-muted-foreground">{summary.email}</p>
            </div>
          </div>
          {summary.currentTier && (
            <Badge variant="outline" className="text-xs">
              <Trophy className="w-3 h-3 mr-1" />
              {summary.currentTier.label} ({summary.currentTier.ratePercent}%)
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Deals Closed (YTD)</p>
            <p className="text-xl font-bold">{summary.ytdDeals}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sale Volume</p>
            <p className="text-xl font-bold">
              {fmt(summary.ytdSaleVolumeCents)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Commission Owed</p>
            <p className="text-xl font-bold text-amber-600">
              {fmt(summary.ytdOwedCents)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p
              className={`text-xl font-bold ${
                summary.ytdOutstandingCents > 0
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {fmt(summary.ytdOutstandingCents)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {summary.ytdOutstandingCents > 0 && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onPayClick(summary)}
            >
              <DollarSign className="w-3 h-3 mr-1" />
              Record Payment
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
          >
            <Download className="w-3 h-3 mr-1" />
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

  if (!summary) return null;

  const unpaid = summary.records.filter((r) => r.status !== "paid");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Commission Payment — {summary.displayName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Commission Record</Label>
            <Select value={selectedRecord} onValueChange={setSelectedRecord}>
              <SelectTrigger>
                <SelectValue placeholder="Select commission record..." />
              </SelectTrigger>
              <SelectContent>
                {unpaid.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Deal #{r.dealId} — Outstanding:{" "}
                    {fmt(r.totalOwedCents - r.paidCents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Payment Amount ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!selectedRecord || !amount) return;
              onPay(selectedRecord, Math.round(parseFloat(amount) * 100));
              onClose();
            }}
            disabled={!selectedRecord || !amount}
          >
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CommissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [payTarget, setPayTarget] = useState<AgentSummary | null>(null);

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
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const totalOwed = summaries.reduce((s, a) => s + a.ytdOwedCents, 0);
  const totalOutstanding = summaries.reduce(
    (s, a) => s + a.ytdOutstandingCents,
    0
  );
  const totalDeals = summaries.reduce((s, a) => s + a.ytdDeals, 0);
  const totalVolume = summaries.reduce((s, a) => s + a.ytdSaleVolumeCents, 0);

  const availableYears = [
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
    new Date().getFullYear() - 2,
  ];

  return (
    <PageShell
      title="Commission Tracking"
      description="Track team commissions, tier progression, and payments"
    >
      <div className="space-y-6">
        {/* Year selector + summary stats */}
        <div className="flex items-center justify-between">
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(parseInt(v))}
          >
            <SelectTrigger className="w-32">
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

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{summaries.length}</p>
                  <p className="text-sm text-muted-foreground">Agents</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{totalDeals}</p>
                  <p className="text-sm text-muted-foreground">Deals Closed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <DollarSign className="w-8 h-8 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold">{fmt(totalOwed)}</p>
                  <p className="text-sm text-muted-foreground">Total Commissions</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertCircle
                  className={`w-8 h-8 ${
                    totalOutstanding > 0 ? "text-red-500" : "text-green-500"
                  }`}
                />
                <div>
                  <p className="text-2xl font-bold">{fmt(totalOutstanding)}</p>
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="agents">
          <TabsList>
            <TabsTrigger value="agents">By Agent</TabsTrigger>
            <TabsTrigger value="records">All Records</TabsTrigger>
            <TabsTrigger value="tiers">Tier Config</TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="mt-4">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : summaries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No team members found.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {summaries.map((s) => (
                  <AgentCard
                    key={s.teamMemberId}
                    summary={s}
                    year={year}
                    onPayClick={setPayTarget}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="records" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Deal #</TableHead>
                      <TableHead>Closed</TableHead>
                      <TableHead>Sale Price</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.flatMap((s) =>
                      s.records.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {s.displayName}
                          </TableCell>
                          <TableCell>#{r.dealId}</TableCell>
                          <TableCell>
                            {format(new Date(r.dealClosedAt), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>{fmt(r.salePrice)}</TableCell>
                          <TableCell>{r.commissionRatePercent}%</TableCell>
                          <TableCell>{fmt(r.totalOwedCents)}</TableCell>
                          <TableCell>{fmt(r.paidCents)}</TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                    {summaries.every((s) => s.records.length === 0) && (
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tiers" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Commission Tiers</CardTitle>
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tier</TableHead>
                          <TableHead>Min Deals</TableHead>
                          <TableHead>Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {config.tiers.map((t, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">
                              {t.label}
                            </TableCell>
                            <TableCell>{t.minDeals}+</TableCell>
                            <TableCell>{t.ratePercent}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {config.baseFlatAmount && config.baseFlatAmount > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Flat bonus per deal:{" "}
                        <span className="font-medium">
                          {fmt(config.baseFlatAmount)}
                        </span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
