import { useState, useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd, formatDate } from "@/lib/format";
import { Search, FileCheck, AlertTriangle, XCircle, CheckCircle2, Loader2, DollarSign, Calendar, Info } from "lucide-react";

interface TitleIssue {
  type: "lien" | "encumbrance" | "easement" | "judgment" | "tax_lien";
  description: string;
  amount?: number;
  holder?: string;
  recordedDate?: string;
  severity: "blocking" | "warning" | "informational";
}

interface TitleSearchResult {
  parcelId: string;
  address: string;
  currentOwner: string;
  ownerSince: string;
  legalDescription: string;
  titleClear: boolean;
  issues: TitleIssue[];
  chainOfTitle: Array<{ owner: string; from: string; to?: string }>;
  estimatedClearanceCost?: number;
  searchDate: string;
  reportId: string;
}

const SEVERITY_CONFIG = {
  blocking: { color: "text-acr-neg", bg: "bg-acr-neg-soft", icon: XCircle },
  warning: { color: "text-acr-warn", bg: "bg-acr-warn-soft", icon: AlertTriangle },
  informational: { color: "text-acr-accent", bg: "bg-acr-accent", icon: FileCheck },
};

function humanizeType(s: string): string {
  const spaced = s.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function TitleSearchPage() {
  // Mae Vasquez (title ops audit, 2026-05-27): renamed surface from "Title
  // search" to "Title issues checklist". This page runs a public-records
  // *preview* (PropStream / ATTOM) for liens, encumbrances, ownership gaps —
  // it does NOT produce a title commitment from a licensed underwriter
  // (Fidelity / First American / Stewart / Old Republic). Calling the result
  // a "title search" leads founders to close on screening data alone, which
  // bypasses the very thing a title policy underwrites against. Keep the
  // route /title-search for backward compat; change the surface label.
  useDocumentTitle("Title issues checklist");
  const { toast } = useToast();
  const [parcelId, setParcelId] = useState("");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<TitleSearchResult | null>(null);
  const parcelInputId = useId();
  const addressInputId = useId();

  // allow-no-invalidation: search result lands in page-local state (setResult)
  const searchMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/title-search/search", { parcelId, address }),
    onSuccess: async (res) => {
      const data = await res.json();
      setResult(data);
    },
    onError: () =>
      toast({
        title: "Couldn't run title search",
        description: "Your previous result (if any) is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const blockingCount = result?.issues.filter(i => i.severity === "blocking").length ?? 0;
  const warningCount = result?.issues.filter(i => i.severity === "warning").length ?? 0;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-title-search-title">
          Title issues checklist
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Pre-screen liens, encumbrances, and ownership gaps from public records before you order a real title commitment.
        </p>
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-acr-warn/30 bg-acr-warn-soft p-3 text-xs"
          role="note"
          aria-label="Important: this is not a title commitment"
        >
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-acr-warn" aria-hidden="true" />
          <div>
            <p className="font-medium">This is a public-records pre-screen — not a title commitment.</p>
            <p className="text-muted-foreground mt-0.5">
              A real title commitment must come from a licensed underwriter (Fidelity, First American, Stewart, Old Republic, etc.).
              Closing without one means you are uninsured against undisclosed liens, mineral severances, and chain-of-title defects.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search title</CardTitle>
          <CardDescription>Provide a parcel ID or address to begin.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if ((parcelId || address) && !searchMutation.isPending) searchMutation.mutate(); }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={parcelInputId} className="text-xs">Parcel ID</Label>
                <Input
                  id={parcelInputId}
                  placeholder="123-456-789"
                  value={parcelId}
                  onChange={e => setParcelId(e.target.value)}
                  className="font-mono"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <Label htmlFor={addressInputId} className="text-xs">Property address</Label>
                <Input
                  id={addressInputId}
                  placeholder="123 Main St, Austin TX"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  autoCapitalize="words"
                  autoComplete="street-address"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={(!parcelId && !address) || searchMutation.isPending}
              className="min-h-11"
            >
              {searchMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />Searching…</>
              ) : (
                <><Search className="w-4 h-4 mr-2" aria-hidden="true" />Run title search</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-base">{result.address}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Parcel <span className="font-mono">{result.parcelId}</span> · Report <span className="font-mono">#{result.reportId}</span>
                  </p>
                </div>
                <Badge variant={result.titleClear ? "default" : "destructive"}>
                  {result.titleClear ? (
                    <><CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />Clear</>
                  ) : (
                    <><XCircle className="w-3 h-3 mr-1" aria-hidden="true" />Issues found</>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Current owner</dt>
                  <dd className="font-medium">{result.currentOwner}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Owner since</dt>
                  <dd className="font-medium tabular-nums">{formatDate(result.ownerSince)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Blocking issues</dt>
                  <dd className={`font-medium tabular-nums ${blockingCount > 0 ? "text-acr-neg" : "text-acr-pos"}`}>{blockingCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Warnings</dt>
                  <dd className={`font-medium tabular-nums ${warningCount > 0 ? "text-acr-warn" : ""}`}>{warningCount}</dd>
                </div>
              </dl>

              {result.estimatedClearanceCost && result.estimatedClearanceCost > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  Est. clearance cost: <strong className="tabular-nums">{usd(result.estimatedClearanceCost / 100)}</strong>
                </div>
              )}
            </CardContent>
          </Card>

          {result.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Title issues</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2" aria-label="Title issues">
                  {result.issues.map((issue, i) => {
                    const config = SEVERITY_CONFIG[issue.severity];
                    const Icon = config.icon;
                    return (
                      <li
                        key={i}
                        className={`rounded-md p-3 ${config.bg}`}
                        role={issue.severity === "blocking" ? "alert" : undefined}
                      >
                        <div className={`flex items-center gap-2 text-xs font-medium ${config.color}`}>
                          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                          <span aria-label={`${issue.severity} issue: ${humanizeType(issue.type)}`}>
                            {humanizeType(issue.type)}
                          </span>
                        </div>
                        <p className="text-xs mt-1">{issue.description}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                          {issue.holder && <span>Holder: {issue.holder}</span>}
                          {issue.amount && <span className="tabular-nums">Amount: {usd(issue.amount / 100)}</span>}
                          {issue.recordedDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" aria-hidden="true" />
                              <span className="tabular-nums">{formatDate(issue.recordedDate)}</span>
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {result.chainOfTitle.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Chain of title</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2" aria-label="Chain of title">
                  {result.chainOfTitle.map((entry, i) => (
                    <li key={i} className="flex items-center gap-3 text-xs">
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                      <span className="font-medium">{entry.owner}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatDate(entry.from)}
                        {entry.to ? ` — ${formatDate(entry.to)}` : " — Present"}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  );
}
