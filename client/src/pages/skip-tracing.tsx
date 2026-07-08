import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Search, User, Phone, Mail, MapPin, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface SkipTraceResult {
  leadId: number;
  foundPhone?: string;
  foundEmail?: string;
  foundAddress?: string;
  confidence: number;
  source: string;
  tracedAt: string;
  status: "found" | "partial" | "not_found";
}

export default function SkipTracingPage() {
  useDocumentTitle("Skip tracing");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [results, setResults] = useState<SkipTraceResult[]>([]);
  const leadIdInputId = useId();

  const traceMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/skip-tracing/trace/${leadId}`),
    onSuccess: async (res) => {
      const data = await res.json();
      setResults(prev => [data, ...prev]);
      toast({ title: "Skip trace complete." });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: () =>
      toast({
        title: "Couldn't run skip trace",
        description: "The lead's contact info is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  // allow-no-invalidation: queues an async trace batch — results land server-side over time
  const batchTraceMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/skip-tracing/batch"),
    onSuccess: () => {
      toast({ title: "Batch trace queued.", description: "Results will arrive as each lead completes." });
    },
    onError: () =>
      toast({
        title: "Couldn't queue batch trace",
        description: "No leads were traced. Try again shortly.",
        variant: "destructive",
      }),
  });

  const { data: statsData } = useQuery<{ totalTraced: number; foundRate: number; avgConfidence: number }>({
    queryKey: ["/api/skip-tracing/stats"],
    queryFn: () => fetch("/api/skip-tracing/stats").then(r => r.json()),
  });

  const statusColor = (status: string) =>
    status === "found" ? "text-acr-pos" : status === "partial" ? "text-acr-warn" : "text-acr-neg";

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

      {statsData && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Total traced</dt>
              <dd className="text-2xl font-bold tabular-nums">{statsData.totalTraced}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Found rate</dt>
              <dd className="text-2xl font-bold tabular-nums">{statsData.foundRate}%</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Avg confidence</dt>
              <dd className="text-2xl font-bold tabular-nums">{statsData.avgConfidence}%</dd>
            </CardContent>
          </Card>
        </dl>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trace a lead</CardTitle>
          <CardDescription>Search for contact info by lead ID.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => { e.preventDefault(); if (leadId && !traceMutation.isPending) traceMutation.mutate(); }}
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
              disabled={!leadId || traceMutation.isPending}
              className="min-h-11"
            >
              {traceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : <Search className="w-4 h-4 mr-2" aria-hidden="true" />}
              Trace
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => batchTraceMutation.mutate()}
              disabled={batchTraceMutation.isPending}
              className="min-h-11"
            >
              Batch trace all untraced
            </Button>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Results</h2>
          <ul className="space-y-3" aria-label="Skip trace results">
            {results.map((r, i) => (
              <li key={i}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium">Lead <span className="tabular-nums">#{r.leadId}</span></span>
                      </div>
                      <div
                        className={`flex items-center gap-1 text-xs capitalize ${statusColor(r.status)}`}
                        aria-label={`Status: ${r.status.replace(/_/g, ' ')}`}
                      >
                        {r.status === "found" ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> : <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                        {r.status.replace(/_/g, ' ')}
                      </div>
                    </div>

                    <dl className="grid grid-cols-1 gap-1 text-xs">
                      {r.foundPhone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-3 h-3" aria-hidden="true" />
                          <dt className="sr-only">Phone</dt>
                          <dd><a href={`tel:${r.foundPhone.replace(/[^\d+]/g, '')}`} className="tabular-nums underline-offset-2 hover:underline">{r.foundPhone}</a></dd>
                        </div>
                      )}
                      {r.foundEmail && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="w-3 h-3" aria-hidden="true" />
                          <dt className="sr-only">Email</dt>
                          <dd><a href={`mailto:${r.foundEmail}`} className="underline-offset-2 hover:underline">{r.foundEmail}</a></dd>
                        </div>
                      )}
                      {r.foundAddress && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          <dt className="sr-only">Address</dt>
                          <dd>{r.foundAddress}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Confidence: <span className="tabular-nums">{r.confidence}%</span></span>
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
