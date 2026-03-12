import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Search, FileCheck, AlertTriangle, XCircle, CheckCircle2, Loader2, DollarSign, Calendar } from "lucide-react";

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
  blocking: { color: "text-red-600", bg: "bg-red-50", icon: XCircle },
  warning: { color: "text-yellow-600", bg: "bg-yellow-50", icon: AlertTriangle },
  informational: { color: "text-blue-600", bg: "bg-blue-50", icon: FileCheck },
};

export default function TitleSearchPage() {
  const { toast } = useToast();
  const [parcelId, setParcelId] = useState("");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<TitleSearchResult | null>(null);

  const searchMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/title-search/search", { parcelId, address }),
    onSuccess: async (res) => {
      const data = await res.json();
      setResult(data);
    },
    onError: () => toast({ title: "Title search failed", variant: "destructive" }),
  });

  const blockingCount = result?.issues.filter(i => i.severity === "blocking").length ?? 0;
  const warningCount = result?.issues.filter(i => i.severity === "warning").length ?? 0;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-title-search-title">
          Title Search
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Run preliminary title searches to identify liens, encumbrances, and ownership gaps.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search Title</CardTitle>
          <CardDescription>Provide a parcel ID or address to begin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Parcel ID</Label>
              <Input placeholder="123-456-789" value={parcelId} onChange={e => setParcelId(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Property Address</Label>
              <Input placeholder="123 Main St, Austin TX" value={address} onChange={e => setAddress(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={(!parcelId && !address) || searchMutation.isPending}
            onClick={() => searchMutation.mutate()}
          >
            {searchMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />Searching...</>
            ) : (
              <><Search className="w-4 h-4 mr-2" />Run Title Search</>
            )}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{result.address}</CardTitle>
                  <p className="text-xs text-muted-foreground">Parcel {result.parcelId} · Report #{result.reportId}</p>
                </div>
                <Badge variant={result.titleClear ? "default" : "destructive"}>
                  {result.titleClear ? (
                    <><CheckCircle2 className="w-3 h-3 mr-1" />Clear</>
                  ) : (
                    <><XCircle className="w-3 h-3 mr-1" />Issues Found</>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Current Owner</p>
                  <p className="font-medium">{result.currentOwner}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Owner Since</p>
                  <p className="font-medium">{new Date(result.ownerSince).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Blocking Issues</p>
                  <p className={`font-medium ${blockingCount > 0 ? "text-red-600" : "text-green-600"}`}>{blockingCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Warnings</p>
                  <p className={`font-medium ${warningCount > 0 ? "text-yellow-600" : ""}`}>{warningCount}</p>
                </div>
              </div>

              {result.estimatedClearanceCost && result.estimatedClearanceCost > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  Est. clearance cost: <strong>${(result.estimatedClearanceCost / 100).toLocaleString()}</strong>
                </div>
              )}
            </CardContent>
          </Card>

          {result.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Title Issues</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.issues.map((issue, i) => {
                  const config = SEVERITY_CONFIG[issue.severity];
                  const Icon = config.icon;
                  return (
                    <div key={i} className={`rounded-md p-3 ${config.bg}`}>
                      <div className={`flex items-center gap-2 text-xs font-medium ${config.color}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {issue.type.replace("_", " ").toUpperCase()}
                      </div>
                      <p className="text-xs mt-1">{issue.description}</p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {issue.holder && <span>Holder: {issue.holder}</span>}
                        {issue.amount && <span>Amount: ${(issue.amount / 100).toLocaleString()}</span>}
                        {issue.recordedDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(issue.recordedDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {result.chainOfTitle.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Chain of Title</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.chainOfTitle.map((entry, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                      <span className="font-medium">{entry.owner}</span>
                      <span className="text-muted-foreground">
                        {new Date(entry.from).toLocaleDateString()}
                        {entry.to ? ` — ${new Date(entry.to).toLocaleDateString()}` : " — Present"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  );
}
