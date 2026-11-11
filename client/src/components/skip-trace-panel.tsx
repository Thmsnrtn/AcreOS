import { useState, useEffect, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SKIP_TRACE_PURPOSES, MIN_JUSTIFICATION_CHARS } from "@/lib/skip-trace-purposes";
import {
  ShieldCheck,
  Search,
  Phone,
  Mail,
  MapPin,
  Users,
  Loader2,
  XCircle,
  Clock,
  DollarSign,
  RefreshCw
} from "lucide-react";
import { GlossaryTerm } from "@/components/Glossary";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { StatusBadge } from "@/components/StatusBadge";
import type { Lead } from "@shared/schema";
import { formatDate } from "@/lib/format";

type SkipTraceResult = {
  phones?: Array<{ number: string; type: string; verified: boolean }>;
  emails?: Array<{ email: string; verified: boolean }>;
  addresses?: Array<{ address: string; type: string; current: boolean }>;
  relatives?: Array<{ name: string; relationship: string }>;
  ageRange?: string;
};

type SkipTrace = {
  id: number;
  organizationId: number;
  leadId: number;
  status: "pending" | "processing" | "completed" | "failed" | "no_results";
  results?: SkipTraceResult;
  costCents?: number;
  requestedAt?: string;
  completedAt?: string;
};

export function SkipTracePanel({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const [isPolling, setIsPolling] = useState(false);
  const [purposeOfUse, setPurposeOfUse] = useState("");
  const [justification, setJustification] = useState("");
  const purposeSelectId = useId();
  const justificationInputId = useId();
  const purposeReady =
    purposeOfUse !== "" && justification.trim().length >= MIN_JUSTIFICATION_CHARS;

  const { data: skipTrace, isLoading, refetch } = useQuery<SkipTrace | null>({
    queryKey: ['/api/skip-traces/lead', lead.id],
  });

  // allow-no-invalidation: starts an async trace; the polling query (setIsPolling) picks up results
  const runSkipTrace = useMutation({
    mutationFn: async () => {
      // The server's FCRA gate refuses without a permissible purpose and
      // justification; we supply what the operator chose, never a default.
      const res = await apiRequest('POST', '/api/skip-traces', {
        leadId: lead.id,
        purposeOfUse,
        justification: justification.trim(),
      });
      return res;
    },
    onSuccess: async (res) => {
      // The server answers 200 with status "unavailable" when no provider is
      // connected — say so rather than claiming a trace started.
      const body = await res.json().catch(() => null);
      if (body?.status === "unavailable") {
        toast({
          title: "Skip tracing isn't available",
          description: "No skip-trace provider is connected to this account. Nothing was charged.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Skip trace started", description: "Processing your request..." });
      setIsPolling(true);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't run skip trace", description: `${err.message} — no credits were deducted.`, variant: "destructive" });
    },
  });

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPolling) {
      interval = setInterval(async () => {
        const result = await refetch();
        if (result.data?.status === 'completed' || result.data?.status === 'failed' || result.data?.status === 'no_results') {
          setIsPolling(false);
          queryClient.invalidateQueries({ queryKey: ['/api/skip-traces/lead', lead.id] });
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [isPolling, lead.id, refetch]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <StatusBadge status="success" label="Completed" />;
      case 'processing':
      case 'pending':
        return <StatusBadge status="pending" label="Processing" />;
      case 'failed':
        return <StatusBadge status="error" label="Failed" />;
      case 'no_results':
        return <StatusBadge status="inactive" label="No results" />;
      default:
        return null;
    }
  };

  const purposeFields = (
    <div className="rounded-md border p-3 space-y-3 text-left" data-testid="skip-trace-panel-fcra-purpose">
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">
          Federal law (FCRA §1681b) permits these lookups only for a permissible
          purpose. Your purpose and justification are recorded on every trace,
          and a current annual FCRA attestation is required.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={purposeSelectId}>Permissible purpose</Label>
        <Select value={purposeOfUse} onValueChange={setPurposeOfUse}>
          <SelectTrigger id={purposeSelectId} data-testid="select-skip-trace-panel-purpose">
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
          placeholder="Why this lookup is permissible"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          data-testid="input-skip-trace-panel-justification"
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_JUSTIFICATION_CHARS} characters — kept as the audit trail for this trace.
        </p>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Card className="glass-panel">
        <CardContent className="pt-6 space-y-2" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading skip trace</span>
          <Skeleton announce={false} className="h-4 w-1/2 max-w-40" />
          <Skeleton announce={false} className="h-4 w-3/4 max-w-64" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-panel" data-testid="panel-skip-trace">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" /> <GlossaryTerm slug="skip_trace">Skip Trace</GlossaryTerm>
          </span>
          {skipTrace && getStatusBadge(skipTrace.status)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!skipTrace ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Run a skip trace to find additional contact information for this lead.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
              <DollarSign className="w-4 h-4" />
              <span>Cost: $0.50 per trace</span>
            </div>
            <div className="mb-4">{purposeFields}</div>
            <Button
              onClick={() => runSkipTrace.mutate()}
              disabled={runSkipTrace.isPending || !purposeReady}
              data-testid="button-run-skip-trace"
            >
              {runSkipTrace.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
              ) : (
                <><Search className="w-4 h-4 mr-2" /> Run Skip Trace</>
              )}
            </Button>
          </div>
        ) : skipTrace.status === 'processing' || skipTrace.status === 'pending' ? (
          <div className="text-center py-4">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Processing skip trace...</p>
          </div>
        ) : skipTrace.status === 'completed' && skipTrace.results ? (
          <div className="space-y-4">
            {skipTrace.results.phones && skipTrace.results.phones.length > 0 && (
              <div data-testid="skip-trace-phones">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone Numbers
                </p>
                <div className="space-y-1">
                  {skipTrace.results.phones.map((phone, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm" data-testid={`skip-trace-phone-${idx}`}>
                      <span className="font-medium">{phone.number}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{phone.type}</Badge>
                        {/* Provider-reported verification is a truth-state: canonical
                            chip (verified → "authoritative" + source label saying who).
                            completedAt is fetch time, not source-update time, so no
                            sourceAsOf. Unverified numbers carry no claim at all. */}
                        {phone.verified && (
                          <DataProvenanceChip source="Skip trace" classification="authoritative" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.emails && skipTrace.results.emails.length > 0 && (
              <div data-testid="skip-trace-emails">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Email Addresses
                </p>
                <div className="space-y-1">
                  {skipTrace.results.emails.map((email, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm" data-testid={`skip-trace-email-${idx}`}>
                      <span className="font-medium">{email.email}</span>
                      {/* Same truth-state pattern as phones above. */}
                      {email.verified && (
                        <DataProvenanceChip source="Skip trace" classification="authoritative" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.addresses && skipTrace.results.addresses.length > 0 && (
              <div data-testid="skip-trace-addresses">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Addresses
                </p>
                <div className="space-y-2">
                  {skipTrace.results.addresses.map((addr, idx) => (
                    <div key={idx} className="text-sm" data-testid={`skip-trace-address-${idx}`}>
                      <p className="font-medium">{addr.address}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">{addr.type}</Badge>
                        {addr.current && <Badge className="text-xs bg-acr-pos-soft text-acr-pos-soft-ink">Current</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.relatives && skipTrace.results.relatives.length > 0 && (
              <div data-testid="skip-trace-relatives">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Relatives
                </p>
                <div className="space-y-1">
                  {skipTrace.results.relatives.map((rel, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm" data-testid={`skip-trace-relative-${idx}`}>
                      <span className="font-medium">{rel.name}</span>
                      <Badge variant="outline" className="text-xs capitalize">{rel.relationship}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.ageRange && (
              <div className="flex items-center justify-between text-sm" data-testid="skip-trace-age">
                <span className="text-muted-foreground">Age Range</span>
                <span className="font-medium">{skipTrace.results.ageRange}</span>
              </div>
            )}

            <div className="pt-3 border-t text-xs text-muted-foreground flex items-center justify-between">
              <span>Cost: ${((skipTrace.costCents || 50) / 100).toFixed(2)}</span>
              {skipTrace.completedAt && (
                <span>Completed: {formatDate(skipTrace.completedAt)}</span>
              )}
            </div>

            {purposeFields}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => runSkipTrace.mutate()}
              disabled={runSkipTrace.isPending || !purposeReady}
              data-testid="button-refresh-skip-trace"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Run New Skip Trace
            </Button>
          </div>
        ) : (
          <div className="text-center py-4">
            <XCircle className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              {skipTrace.status === 'no_results' ? 'No results found for this lead.' : 'Skip trace failed. Please try again.'}
            </p>
            <div className="mb-4">{purposeFields}</div>
            <Button
              variant="outline"
              onClick={() => runSkipTrace.mutate()}
              disabled={runSkipTrace.isPending || !purposeReady}
              data-testid="button-retry-skip-trace"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
