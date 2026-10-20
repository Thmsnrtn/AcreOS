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
import { Search, FileCheck, AlertTriangle, XCircle, Loader2, Calendar, Info } from "lucide-react";

/**
 * MIRRORS `TitleSearchResult` in server/services/titleSearchService.ts — the
 * exact JSON that POST /api/title-search/search returns. This page used to
 * declare an invented shape (issues[] / titleClear / chainOfTitle / reportId /
 * estimatedClearanceCost) that the server never sent, so `result.issues.filter`
 * threw on EVERY response and the page could not render a single result.
 * `titleSearchPreScreen.test.tsx` renders this view with the server's own
 * output so the two cannot drift apart again.
 */
export interface TitleLienRecord {
  type: "mortgage" | "tax_lien" | "mechanic_lien" | "judgment" | "hoa" | "other";
  amount: number;
  lender?: string;
  recordedDate?: string;
  maturityDate?: string;
  position: number;
  status: "open" | "satisfied" | "unknown";
}

export interface TitleDeedRecord {
  grantee: string | null;
  grantor: string | null;
  deedType: "warranty" | "quitclaim" | "grant" | "trustee" | "other";
  recordedDate: string;
  documentNumber?: string;
  saleAmount?: number;
}

export interface TitleSearchResult {
  apn: string;
  address?: string;
  currentOwner: string | null;
  ownerOccupied: boolean | null;
  vestingType?: string;
  ownerMailingAddress?: string;
  liens: TitleLienRecord[];
  totalLienAmount: number;
  hasOpenLiens: true | null;
  deedChain: TitleDeedRecord[];
  lastSaleDate?: string;
  lastSalePrice?: number;
  hasHoa: boolean | null;
  hoaName?: string;
  hoaFeeMonthly?: number;
  titleClearStatus: "encumbered" | "unverified";
  redFlags: string[];
  source: "propstream" | "attom" | "mock";
  searchedAt: string;
}

const NOT_REPORTED = "Not reported";

function humanizeType(s: string): string {
  const spaced = s.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function yesNoUnknown(v: boolean | null): string {
  if (v === null) return NOT_REPORTED;
  return v ? "Yes" : "No";
}

const SOURCE_LABEL: Record<TitleSearchResult["source"], string> = {
  propstream: "PropStream",
  attom: "ATTOM",
  mock: "No provider",
};

/**
 * Renders the server's pre-screen result. Unknown is shown as unknown: there
 * is no "Clear" badge, because a public-records pre-screen cannot certify
 * clear title and absence of a reported lien is not evidence of none.
 */
export function TitleSearchResultView({ result }: { result: TitleSearchResult }) {
  const openLiens = result.liens.filter((l) => l.status === "open");
  const encumbered = result.titleClearStatus === "encumbered";
  return (
    <div className="space-y-4" data-testid="title-search-result">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">{result.address || `Parcel ${result.apn}`}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Parcel <span className="font-mono">{result.apn}</span> · Source {SOURCE_LABEL[result.source]} · Searched {formatDate(result.searchedAt)}
              </p>
            </div>
            <Badge variant={encumbered ? "destructive" : "secondary"} data-testid="badge-title-status">
              {encumbered ? (
                <><XCircle className="w-3 h-3 mr-1" aria-hidden="true" />Encumbrances reported</>
              ) : (
                <><AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" />Not verified</>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Current owner</dt>
              <dd className="font-medium" data-testid="text-current-owner">{result.currentOwner ?? NOT_REPORTED}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Owner occupied</dt>
              <dd className="font-medium">{yesNoUnknown(result.ownerOccupied)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">HOA</dt>
              <dd className="font-medium" data-testid="text-hoa">{yesNoUnknown(result.hasHoa)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Open liens reported</dt>
              <dd className={`font-medium tabular-nums ${openLiens.length > 0 ? "text-acr-neg" : ""}`} data-testid="text-open-lien-count">
                {openLiens.length > 0 ? `${openLiens.length} (${usd(result.totalLienAmount)})` : "None reported"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {result.redFlags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Red flags</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" aria-label="Red flags" data-testid="list-red-flags">
              {result.redFlags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md p-3 bg-acr-warn-soft text-acr-warn-soft-ink text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{flag}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result.liens.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Liens reported</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" aria-label="Liens reported">
              {result.liens.map((lien, i) => (
                <li key={i} className={`rounded-md p-3 ${lien.status === "open" ? "bg-acr-neg-soft" : "bg-muted"}`}>
                  <div className={`flex items-center gap-2 text-xs font-medium ${lien.status === "open" ? "text-acr-neg-soft-ink" : ""}`}>
                    <FileCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{humanizeType(lien.type)} · {humanizeType(lien.status)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                    {lien.lender && <span>Holder: {lien.lender}</span>}
                    <span className="tabular-nums">Amount: {usd(lien.amount)}</span>
                    {lien.recordedDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        <span className="tabular-nums">{formatDate(lien.recordedDate)}</span>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result.deedChain.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recorded transfers</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2" aria-label="Recorded transfers">
              {result.deedChain.map((deed, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                  <span className="font-medium">{deed.grantor ?? NOT_REPORTED} → {deed.grantee ?? NOT_REPORTED}</span>
                  <span className="text-muted-foreground">{humanizeType(deed.deedType)}</span>
                  <span className="text-muted-foreground tabular-nums">{formatDate(deed.recordedDate)}</span>
                  {deed.saleAmount != null && <span className="tabular-nums">{usd(deed.saleAmount)}</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
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

      {result && <TitleSearchResultView result={result} />}
    </PageShell>
  );
}
