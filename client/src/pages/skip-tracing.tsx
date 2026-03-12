import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [results, setResults] = useState<SkipTraceResult[]>([]);

  const traceMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/skip-tracing/trace/${leadId}`),
    onSuccess: async (res) => {
      const data = await res.json();
      setResults(prev => [data, ...prev]);
      toast({ title: "Skip trace complete" });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: () => toast({ title: "Skip trace failed", variant: "destructive" }),
  });

  const batchTraceMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/skip-tracing/batch"),
    onSuccess: () => {
      toast({ title: "Batch trace queued" });
    },
    onError: () => toast({ title: "Batch trace failed", variant: "destructive" }),
  });

  const { data: statsData } = useQuery<{ totalTraced: number; foundRate: number; avgConfidence: number }>({
    queryKey: ["/api/skip-tracing/stats"],
    queryFn: () => fetch("/api/skip-tracing/stats").then(r => r.json()),
  });

  const statusColor = (status: string) =>
    status === "found" ? "text-green-600" : status === "partial" ? "text-yellow-600" : "text-red-600";

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-skip-tracing-title">
          Skip Tracing
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Locate contact information for property owners who are hard to reach.
        </p>
      </div>

      {statsData && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Traced</p>
              <p className="text-2xl font-bold">{statsData.totalTraced}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Found Rate</p>
              <p className="text-2xl font-bold">{statsData.foundRate}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Avg Confidence</p>
              <p className="text-2xl font-bold">{statsData.avgConfidence}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trace a Lead</CardTitle>
          <CardDescription>Search for contact info by lead ID.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Lead ID"
              value={leadId}
              onChange={e => setLeadId(e.target.value)}
              className="w-32"
            />
            <Button
              disabled={!leadId || traceMutation.isPending}
              onClick={() => leadId && traceMutation.mutate()}
            >
              {traceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Trace
            </Button>
            <Button
              variant="outline"
              onClick={() => batchTraceMutation.mutate()}
              disabled={batchTraceMutation.isPending}
            >
              Batch Trace All Untraced
            </Button>
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Results</h2>
          {results.map((r, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Lead #{r.leadId}</span>
                  </div>
                  <div className={`flex items-center gap-1 text-xs ${statusColor(r.status)}`}>
                    {r.status === "found" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {r.status}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1 text-xs">
                  {r.foundPhone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-3 h-3" /> {r.foundPhone}
                    </div>
                  )}
                  {r.foundEmail && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-3 h-3" /> {r.foundEmail}
                    </div>
                  )}
                  {r.foundAddress && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="w-3 h-3" /> {r.foundAddress}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Confidence: {r.confidence}%</span>
                  <Badge variant="outline" className="text-xs">{r.source}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
