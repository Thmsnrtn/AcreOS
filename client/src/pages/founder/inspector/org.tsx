/**
 * /founder/inspector/org/:id — per-organization provenance lens.
 *
 * Tabs: Cost (this file), Trust, Activity, Synergy, Prompts. The other
 * four are placeholders for now — the existing inspector.tsx still owns
 * the agent/decision/audit scopes and we don't want to fork those.
 *
 * The Cost tab is the heavy lift; everything else is a "see <related
 * page>" stub so the tab strip is honest about scope.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { useState } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Mail,
  Pause,
  Gauge,
  PiggyBank,
  KeyRound,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
} from "recharts";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
interface OrgCostResponse {
  org: {
    id: number;
    name: string;
    slug: string;
    subscriptionTier: string;
    subscriptionStatus: string;
  };
  windowDays: number;
  lifetime: {
    revenueCents: number;
    variableCostCents: number;
    contributionMarginCents: number;
    ltvToCacRatio: number | null;
  };
  window: {
    revenueCents: number;
    variableCostCents: number;
    marginCents: number;
  };
  trend: Array<{ day: string; costCents: number }>;
  categoryBreakdown: Array<{ feature: string; costCents: number; events: number }>;
  monthly: Array<{
    month: string;
    revenueCents: number;
    variableCostCents: number;
    marginCents: number;
    netNegative: boolean;
  }>;
  byok: Array<{
    channel: string;
    usingByok: boolean;
    fingerprint: string | null;
    lastUsedAt: string | null;
    createdAt: string | null;
  }>;
  cacheSavings: { savingsCents: number; hitCount: number };
  overrides: {
    pauses: Array<{ channel: string; paused: boolean; setAt: string | null; setBy: string | null; description: string | null }>;
    throttles: Array<{ channel: string; dailyCap: number | null; setAt: string | null; setBy: string | null; description: string | null }>;
  };
  recentEvents: Array<{
    id: number;
    costCents: number;
    feature: string | null;
    provider: string | null;
    externalEventId: string | null;
    postedAt: string;
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────
export default function OrgInspector() {
  const [, params] = useRoute<{ id: string }>("/founder/inspector/org/:id");
  const orgIdNum = params?.id ? parseInt(params.id, 10) : NaN;

  useDocumentTitle(`Org ${params?.id ?? ""} — Inspector`);

  if (!Number.isFinite(orgIdNum)) {
    return (
      <PageShell label="Org inspector">
        <p className="text-sm text-muted-foreground">Invalid organization id.</p>
      </PageShell>
    );
  }

  return (
    <PageShell label="Org inspector">
      <div className="space-y-6">
        <header>
          <Link
            href="/founder"
            className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline"
          >
            <ArrowLeft className="w-3 h-3" aria-hidden /> Back to Now
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">
            Org #{orgIdNum}
          </h1>
        </header>

        <Tabs defaultValue="cost">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="cost">Cost</TabsTrigger>
            <TabsTrigger value="trust">Trust</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="synergy">Synergy</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
          </TabsList>
          <TabsContent value="cost" className="mt-4">
            <CostTab orgId={orgIdNum} />
          </TabsContent>
          <TabsContent value="trust" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Trust telemetry lives on the per-agent inspector for now. Open an agent from{" "}
              <Link href="/founder/agents" className="underline">/founder/agents</Link> to see trust-score
              evolution.
            </p>
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Activity timeline: see <Link href={`/founder/feed?org=${orgIdNum}`} className="underline">org feed</Link>.
            </p>
          </TabsContent>
          <TabsContent value="synergy" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Synergy graph wiring lands with the growth-modeling pillar.
            </p>
          </TabsContent>
          <TabsContent value="prompts" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Prompt history surfaces from <Link href="/founder/prompt-versions" className="underline">/founder/prompt-versions</Link>.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Cost tab — the main attraction
// ────────────────────────────────────────────────────────────────────────────
function CostTab({ orgId }: { orgId: number }) {
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(30);
  const { data, isLoading, error } = useQuery<OrgCostResponse>({
    queryKey: [`/api/founder/inspector/org/${orgId}/cost?days=${windowDays}`],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        Failed to load cost data: {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h2 className="text-lg font-semibold">{data.org.name}</h2>
          <p className="text-xs text-muted-foreground font-mono">
            {data.org.slug} · {data.org.subscriptionTier} / {data.org.subscriptionStatus}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d as 30 | 60 | 90)}
              aria-label={`Show ${d} day window`}
              className={
                "px-3 py-1.5 transition-colors " +
                (windowDays === d
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted")
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Lifetime metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Lifetime revenue" value={fmtUsd(data.lifetime.revenueCents)} />
        <Metric label="Lifetime variable cost" value={fmtUsd(data.lifetime.variableCostCents)} />
        <Metric
          label="Lifetime contribution"
          value={fmtUsd(data.lifetime.contributionMarginCents)}
          tone={data.lifetime.contributionMarginCents < 0 ? "negative" : "positive"}
        />
        <Metric
          label="LTV : CAC"
          value={data.lifetime.ltvToCacRatio === null ? "—" : `${data.lifetime.ltvToCacRatio.toFixed(2)}×`}
          tone={
            data.lifetime.ltvToCacRatio === null
              ? "neutral"
              : data.lifetime.ltvToCacRatio >= 3
                ? "positive"
                : data.lifetime.ltvToCacRatio >= 1
                  ? "neutral"
                  : "negative"
          }
        />
      </div>

      {/* Variable cost trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="w-4 h-4" aria-hidden /> Variable cost trend ({windowDays}d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.trend.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No spend in this window.</p>
          ) : (
            <div className="w-full h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
                  />
                  <Tooltip
                    formatter={((v: number) => fmtUsd(v)) as never}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="costCents"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost per category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cost per category ({windowDays}d)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.categoryBreakdown.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No categorised spend in this window.</p>
          ) : (
            <div className="w-full h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.categoryBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis type="category" dataKey="feature" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip
                    formatter={((v: number) => fmtUsd(v)) as never}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="costCents" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly contribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Net contribution margin (last 6 months)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.monthly.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No monthly data yet.</p>
          ) : (
            <div className="w-full h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis
                    tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    formatter={((v: number) => fmtUsd(v)) as never}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="marginCents">
                    {data.monthly.map((m) => (
                      <Cell
                        key={m.month}
                        fill={m.netNegative ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.monthly.some((m) => m.netNegative) && (
            <p className="text-xs text-destructive mt-2 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" aria-hidden /> Net-negative month(s) highlighted in red.
            </p>
          )}
        </CardContent>
      </Card>

      {/* BYOK status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <KeyRound className="w-4 h-4" aria-hidden /> BYOK status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {data.byok.map((b) => (
              <div
                key={b.channel}
                className="flex items-center justify-between text-sm border border-border rounded p-2"
              >
                <span className="font-mono text-xs">{b.channel}</span>
                <Badge variant={b.usingByok ? "default" : "secondary"}>
                  {b.usingByok ? "BYOK" : "platform"}
                </Badge>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead>Last used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byok.map((b) => (
                  <TableRow key={b.channel}>
                    <TableCell className="font-mono text-xs">{b.channel}</TableCell>
                    <TableCell>
                      <Badge variant={b.usingByok ? "default" : "secondary"}>
                        {b.usingByok ? "Customer BYOK" : "Platform credentials"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {b.fingerprint ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {b.lastUsedAt ? new Date(b.lastUsedAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Cache-hit savings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <PiggyBank className="w-4 h-4" aria-hidden /> Cache-hit savings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            This org saved{" "}
            <span className="font-semibold tabular-nums">{fmtUsd(data.cacheSavings.savingsCents)}</span>{" "}
            in the last {windowDays} days via the shared data cache (
            {data.cacheSavings.hitCount.toLocaleString()} hits).
          </p>
        </CardContent>
      </Card>

      {/* Recent cost events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent cost events</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentEvents.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No cost events in this window.</p>
          ) : (
            <div className="space-y-1">
              {data.recentEvents.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 text-xs border-b border-border/40 py-1.5"
                >
                  <span className="text-muted-foreground font-mono w-36 shrink-0">
                    {new Date(e.postedAt).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-xs">{e.provider ?? "—"}</Badge>
                  <Badge variant="outline" className="text-xs">{e.feature ?? "—"}</Badge>
                  <span className="tabular-nums font-medium">{fmtUsd(e.costCents)}</span>
                  <Link
                    href={`/founder/inspector/cost-event/${e.id}`}
                    className="ml-auto underline text-primary"
                  >
                    View provenance →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Emergency overrides */}
      <OverridesPanel orgId={orgId} data={data} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Overrides panel
// ────────────────────────────────────────────────────────────────────────────
function OverridesPanel({ orgId, data }: { orgId: number; data: OrgCostResponse }) {
  const { toast } = useToast();

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        q.queryKey[0].startsWith(`/api/founder/inspector/org/${orgId}/cost`),
    });

  const pauseMutation = useMutation({
    mutationFn: async (vars: { channel: string; reason: string; resume?: boolean }) => {
      const r = await apiRequest("POST", `/api/founder/inspector/org/${orgId}/pause-channel`, vars);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Override saved" });
      invalidate();
    },
    onError: (err) =>
      toast({ title: "Override failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const throttleMutation = useMutation({
    mutationFn: async (vars: { channel: string; dailyCap: number; reason: string }) => {
      const r = await apiRequest("POST", `/api/founder/inspector/org/${orgId}/throttle`, vars);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Throttle saved" });
      invalidate();
    },
    onError: (err) =>
      toast({ title: "Throttle failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const lobPaused = data.overrides.pauses.find((p) => p.channel === "lob")?.paused ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden /> Emergency overrides
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <PauseLobDialog
            paused={lobPaused}
            onSubmit={(reason) =>
              pauseMutation.mutate({ channel: "lob", reason, resume: lobPaused })
            }
            isPending={pauseMutation.isPending}
          />
          <ThrottleDialog
            currentCap={
              data.overrides.throttles.find((t) => t.channel === "lob")?.dailyCap ?? null
            }
            onSubmit={(dailyCap, reason) =>
              throttleMutation.mutate({ channel: "lob", dailyCap, reason })
            }
            isPending={throttleMutation.isPending}
          />
          <DraftEmailDialog orgId={orgId} orgName={data.org.name} />
        </div>
        <p className="text-xs text-muted-foreground">
          Every override is logged to founder_audit. Channel adapters check
          founder_settings before sending.
        </p>
      </CardContent>
    </Card>
  );
}

function PauseLobDialog({
  paused,
  onSubmit,
  isPending,
}: {
  paused: boolean;
  onSubmit: (reason: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={paused ? "default" : "destructive"} size="sm">
          <Pause className="w-4 h-4 mr-1" aria-hidden />
          {paused ? "Resume Lob" : "Pause Lob for this org"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{paused ? "Resume Lob sending" : "Pause Lob sending"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="lob-reason">Reason (logged to founder_audit)</Label>
          <Textarea
            id="lob-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this needed?"
          />
        </div>
        <DialogFooter>
          <Button
            disabled={!reason.trim() || isPending}
            onClick={() => {
              onSubmit(reason.trim());
              setOpen(false);
              setReason("");
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ThrottleDialog({
  currentCap,
  onSubmit,
  isPending,
}: {
  currentCap: number | null;
  onSubmit: (dailyCap: number, reason: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState<string>(String(currentCap ?? 2));
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gauge className="w-4 h-4 mr-1" aria-hidden />
          {currentCap !== null ? `Throttle (cap ${currentCap}/day)` : "Throttle to 2 postcards/day"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set daily cap on Lob</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="throttle-cap">Daily cap (pieces/day)</Label>
            <Input
              id="throttle-cap"
              type="number"
              min={0}
              max={10000}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="throttle-reason">Reason</Label>
            <Textarea
              id="throttle-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!reason.trim() || !Number.isFinite(parseInt(cap, 10)) || isPending}
            onClick={() => {
              onSubmit(parseInt(cap, 10), reason.trim());
              setOpen(false);
              setReason("");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftEmailDialog({ orgId, orgName }: { orgId: number; orgName: string }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(`AcreOS usage check-in — ${orgName}`);
  const [body, setBody] = useState(
    `Hi,\n\nYour AcreOS account has been running hot on outreach this month. Want to compare notes on what's working and where to dial things back?\n\nTom`,
  );
  const [draft, setDraft] = useState<{ mailto: string | null } | null>(null);
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/founder/inspector/org/${orgId}/draft-email`, {
        subject,
        body,
      });
      return r.json();
    },
    onSuccess: (res: { draft: { mailto: string | null } }) => {
      setDraft({ mailto: res.draft.mailto });
      toast({ title: "Draft created" });
    },
    onError: (err) =>
      toast({
        title: "Draft failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="w-4 h-4 mr-1" aria-hidden /> Email this org about their usage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Draft a usage check-in email</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="draft-subject">Subject</Label>
            <Input
              id="draft-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="draft-body">Body</Label>
            <Textarea
              id="draft-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </div>
          {draft?.mailto && (
            <a
              href={draft.mailto}
              className="text-sm underline text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Open in your mail client →
            </a>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={mutation.isPending || !subject.trim() || !body.trim()}
            onClick={() => mutation.mutate()}
          >
            Draft (no send)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────────────────────
function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={
            "text-lg font-bold tabular-nums " +
            (tone === "negative"
              ? "text-destructive"
              : tone === "positive"
                ? "text-emerald-600 dark:text-emerald-400"
                : "")
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(dollars) < 1 ? 2 : 0,
  }).format(dollars);
}
