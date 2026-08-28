import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryErrorState } from "@/components/query-error-state";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Search, User, Phone, Mail, MapPin, Loader2, CheckCircle2, AlertCircle, AlertTriangle, ShieldCheck } from "lucide-react";

/**
 * Contracts mirror server/routes-skip-tracing.ts exactly — the page renders
 * only fields the server truthfully derives. There is deliberately no
 * "avg confidence" stat: no per-trace confidence is persisted, so there is
 * nothing real to aggregate.
 */
interface SkipTraceStats {
  configured: boolean;
  totalLeads: number;
  tracedCount: number;
  untracedCount: number;
  foundCount: number;
  foundRate: number | null;
}

interface TracePhone {
  number: string;
  lineType: string | null;
  confidence: number; // 0-1, provider-reported
  doNotCall: boolean;
}

interface TraceEmail {
  address: string;
  confidence: number; // 0-1, provider-reported
}

interface SkipTraceResponse {
  leadId: number;
  status: "completed" | "no_results";
  source: string;
  phones: TracePhone[];
  emails: TraceEmail[];
  ownerAddress: string | null;
  leadUpdated: { phone: boolean; email: boolean };
  tracedAt: string;
}

interface BatchTraceResponse {
  requested: number;
  traced: number;
  found: number;
  failed: number;
  untracedRemaining: number;
  message?: string;
}

/**
 * Provider match confidences arrive 0-1; the canonical chip takes 0-100.
 * Classification is "estimate": a skip-trace contact is a data-backed match
 * from broker records with a provider-reported score — not an authoritative
 * system-of-record. tracedAt is fetch time, not source-update time, so no
 * sourceAsOf (same reasoning as skip-trace-panel.tsx).
 */
const toChipConfidence = (confidence: number) => Math.round(confidence * 100);

/**
 * FCRA §1681b permissible purposes accepted by the server's skip-trace gate
 * (SKIP_TRACE_PURPOSES in server/services/fcraAttestation.ts). Both POST
 * endpoints REQUIRE purposeOfUse + a ≥10-char justification — traces without
 * them are refused, so the buttons stay disabled until both are provided.
 */
const SKIP_TRACE_PURPOSES = [
  { value: "collection", label: "Collection of a debt owed by this person" },
  { value: "legitimate_business_need", label: "Legitimate business need — transaction initiated by this person" },
  { value: "written_consent", label: "Written consent from this person" },
  { value: "account_review", label: "Review of an existing account" },
] as const;

const MIN_JUSTIFICATION_CHARS = 10;

export default function SkipTracingPage() {
  useDocumentTitle("Skip tracing");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [purposeOfUse, setPurposeOfUse] = useState("");
  const [justification, setJustification] = useState("");
  const [results, setResults] = useState<SkipTraceResponse[]>([]);
  const leadIdInputId = useId();
  const purposeSelectId = useId();
  const justificationInputId = useId();

  const purposeReady =
    purposeOfUse !== "" && justification.trim().length >= MIN_JUSTIFICATION_CHARS;
  const fcraBody = { purposeOfUse, justification: justification.trim() };

  const statsQuery = useQuery<SkipTraceStats>({
    queryKey: ["/api/skip-tracing/stats"],
  });
  const stats = statsQuery.data;

  // Invalidation is written out inline in each onSuccess below rather than
  // shared through a helper: the use-mutation-must-invalidate rule reads the
  // callback body and cannot follow a call into a helper, so a helper here
  // reads as "no invalidation" to the gate. Four duplicated lines are worth
  // keeping that check honest — stats and the lead list BOTH move on a trace.
  const traceMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/skip-tracing/trace/${leadId}`, fcraBody),
    onSuccess: async (res) => {
      const data: SkipTraceResponse = await res.json();
      setResults(prev => [data, ...prev]);
      toast({
        title: data.status === "completed" ? "Skip trace complete." : "Skip trace finished — no contacts found.",
        description:
          data.status === "completed"
            ? data.leadUpdated.phone || data.leadUpdated.email
              ? "Found contact info was saved to the lead record."
              : "The lead already had contact info, so nothing was overwritten."
            : "The provider returned no contact information for this lead.",
      });
      qc.invalidateQueries({ queryKey: ["/api/skip-tracing/stats"] });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: Error) =>
      // Surface the server's refusal honestly — an FCRA gate refusal names
      // the missing piece (purpose / justification / annual attestation and
      // its remedy) and must not be flattened into a generic retry message.
      toast({
        title: "Couldn't run skip trace",
        description: err.message || "The lead's contact info is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const batchTraceMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/skip-tracing/batch", fcraBody),
    onSuccess: async (res) => {
      const data: BatchTraceResponse = await res.json();
      toast({
        title: data.requested === 0 ? "Nothing to trace." : `Traced ${data.traced} of ${data.requested} leads.`,
        description:
          data.requested === 0
            ? "Every lead already has a finished skip trace."
            : `${data.found} with contact info · ${data.failed} failed · ${data.untracedRemaining} untraced remaining.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/skip-tracing/stats"] });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't run batch trace",
        description: err.message || "No leads were traced. Try again shortly.",
        variant: "destructive",
      }),
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-skip-tracing-title">
          Skip tracing
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Locate contact information for property owners who are hard to reach.
        </p>
      </div>

      {statsQuery.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-3 w-24" announce={i === 0} announceText="Loading skip tracing stats" />
                <Skeleton className="h-8 w-16" announce={false} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : statsQuery.isError ? (
        <QueryErrorState
          error={statsQuery.error as Error}
          onRetry={() => statsQuery.refetch()}
          isRetrying={statsQuery.isRefetching}
          compact
          title="Couldn't load skip tracing stats"
          testId="skip-tracing-stats-error"
        />
      ) : stats ? (
        <>
          {!stats.configured && (
            <Card className="border-acr-warn/40" data-testid="skip-tracing-not-configured">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 text-acr-warn shrink-0" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  No skip tracing provider is connected. Traces will fail until a
                  BatchSkipTracing or REISkip key is configured in Settings.
                </p>
              </CardContent>
            </Card>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Leads traced</dt>
                <dd className="text-2xl font-bold tabular-nums">
                  {stats.tracedCount}
                  <span className="text-sm font-normal text-muted-foreground"> / {stats.totalLeads}</span>
                </dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Untraced</dt>
                <dd className="text-2xl font-bold tabular-nums">{stats.untracedCount}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <dt className="text-xs text-muted-foreground mb-1">Found rate</dt>
                {stats.foundRate === null ? (
                  <>
                    <dd className="text-2xl font-bold" aria-label="No finished traces yet">—</dd>
                    <p className="text-xs text-muted-foreground">No finished traces yet</p>
                  </>
                ) : (
                  <dd className="text-2xl font-bold tabular-nums">{stats.foundRate}%</dd>
                )}
              </CardContent>
            </Card>
          </dl>
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trace a lead</CardTitle>
          <CardDescription>Search for contact info by lead ID, or trace every lead that hasn't been traced yet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 space-y-3" data-testid="skip-tracing-fcra-purpose">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                Federal law (FCRA §1681b) permits these lookups only for a permissible
                purpose. Your purpose and justification are recorded on every trace,
                and a current annual FCRA attestation is required.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={purposeSelectId}>Permissible purpose</Label>
                <Select value={purposeOfUse} onValueChange={setPurposeOfUse}>
                  <SelectTrigger id={purposeSelectId} data-testid="select-skip-trace-purpose">
                    <SelectValue placeholder="Select a purpose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SKIP_TRACE_PURPOSES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={justificationInputId}>Justification</Label>
                <Textarea
                  id={justificationInputId}
                  rows={2}
                  placeholder="Why this lookup is permissible (e.g. collecting on delinquent note #123)"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  data-testid="input-skip-trace-justification"
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_JUSTIFICATION_CHARS} characters — kept as the audit trail for this trace.
                </p>
              </div>
            </div>
          </div>

          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => { e.preventDefault(); if (leadId && purposeReady && !traceMutation.isPending) traceMutation.mutate(); }}
          >
            <div className="w-32">
              <Label htmlFor={leadIdInputId} className="sr-only">Lead ID</Label>
              <Input
                id={leadIdInputId}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Lead ID"
                value={leadId}
                onChange={e => setLeadId(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={!leadId || !purposeReady || traceMutation.isPending}
              className="min-h-11"
            >
              {traceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : <Search className="w-4 h-4 mr-2" aria-hidden="true" />}
              Trace
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => batchTraceMutation.mutate()}
              disabled={!purposeReady || batchTraceMutation.isPending || !stats || stats.untracedCount === 0}
              className="min-h-11"
            >
              {batchTraceMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />}
              {stats
                ? stats.untracedCount === 0
                  ? "All leads traced"
                  : `Batch trace ${Math.min(stats.untracedCount, 50)} of ${stats.untracedCount} untraced`
                : "Batch trace untraced"}
            </Button>
            {!purposeReady && (
              <p className="basis-full text-xs text-muted-foreground">
                Select a permissible purpose and enter a justification of at least{" "}
                {MIN_JUSTIFICATION_CHARS} characters to enable tracing.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Results</h2>
          <ul className="space-y-3" aria-label="Skip trace results">
            {results.map((r, i) => (
              <li key={`${r.leadId}-${r.tracedAt}-${i}`}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium">Lead <span className="tabular-nums">#{r.leadId}</span></span>
                      </div>
                      <div
                        className={`flex items-center gap-1 text-xs ${r.status === "completed" ? "text-acr-pos" : "text-acr-warn"}`}
                        aria-label={r.status === "completed" ? "Status: contacts found" : "Status: no results"}
                      >
                        {r.status === "completed"
                          ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          : <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                        {r.status === "completed" ? "Contacts found" : "No results"}
                      </div>
                    </div>

                    {(r.phones.length > 0 || r.emails.length > 0 || r.ownerAddress) ? (
                      <dl className="grid grid-cols-1 gap-1 text-xs">
                        {r.phones.map((p) => (
                          <div key={p.number} className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="w-3 h-3" aria-hidden="true" />
                            <dt className="sr-only">Phone</dt>
                            <dd className="flex items-center gap-2">
                              <a href={`tel:${p.number.replace(/[^\d+]/g, '')}`} className="tabular-nums underline-offset-2 hover:underline">{p.number}</a>
                              {p.lineType && <span className="capitalize">{p.lineType}</span>}
                              <DataProvenanceChip
                                source={r.source.replace(/_/g, " ")}
                                classification="estimate"
                                confidence={toChipConfidence(p.confidence)}
                                className="capitalize"
                              />
                              {p.doNotCall && <Badge variant="destructive" className="text-[10px]">Do not call</Badge>}
                            </dd>
                          </div>
                        ))}
                        {r.emails.map((e) => (
                          <div key={e.address} className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="w-3 h-3" aria-hidden="true" />
                            <dt className="sr-only">Email</dt>
                            <dd className="flex items-center gap-2">
                              <a href={`mailto:${e.address}`} className="underline-offset-2 hover:underline">{e.address}</a>
                              <DataProvenanceChip
                                source={r.source.replace(/_/g, " ")}
                                classification="estimate"
                                confidence={toChipConfidence(e.confidence)}
                                className="capitalize"
                              />
                            </dd>
                          </div>
                        ))}
                        {r.ownerAddress && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin className="w-3 h-3" aria-hidden="true" />
                            <dt className="sr-only">Address</dt>
                            <dd>{r.ownerAddress}</dd>
                          </div>
                        )}
                      </dl>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        The provider returned no contact information for this lead.
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {r.leadUpdated.phone || r.leadUpdated.email
                          ? `Saved to lead record (${[r.leadUpdated.phone && "phone", r.leadUpdated.email && "email"].filter(Boolean).join(", ")})`
                          : "Lead record unchanged"}
                      </span>
                      <Badge variant="outline" className="text-xs capitalize">{r.source.replace(/_/g, ' ')}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
