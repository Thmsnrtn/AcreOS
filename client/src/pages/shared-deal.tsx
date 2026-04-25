import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, MapPin, DollarSign, FileText, CheckCircle, AlertTriangle } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

interface SharedDealData {
  deal: {
    id: number;
    status: string;
    offerAmount?: string;
    acceptedAmount?: string;
    closingDate?: string;
    closingCosts?: string;
    titleCompany?: string;
  };
  property: {
    address?: string;
    city?: string;
    state?: string;
    county?: string;
    sizeAcres?: string;
    apn?: string;
  };
  compliance: {
    doddFrank?: string;
    usury?: string;
  };
  checklist: {
    total: number;
    completed: number;
    items: { title: string; completed: boolean; dueDate?: string }[];
  };
  documents: { name: string; type: string }[];
  expiresAt: string;
}

// Money-precision rule: keep decimals through to render. fmt$() previously
// used Math.round(), which silently dropped cents from server-side dollar
// values like "1234.56" — replaced with usd() so the buyer/lender sees the
// exact number their counterpart sees.
function fmtMoney(val: string | number | undefined | null): string {
  if (!val) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (!isFinite(n)) return "—";
  return usd(n);
}

export default function SharedDealPage() {
  useDocumentTitle("Shared deal");
  const params = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery<SharedDealData>({
    queryKey: [`/api/shared/deal/${params.token}`],
    queryFn: async () => {
      const res = await fetch(`/api/shared/deal/${params.token}`);
      if (res.status === 404) throw new Error("Link expired or invalid");
      if (!res.ok) throw new Error("Failed to load deal");
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4" role="status" aria-live="polite">
        <span className="sr-only">Loading shared deal…</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center" role="alert">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Link expired or invalid</h2>
            <p className="text-sm text-muted-foreground mt-2">
              This shared deal link may have expired or been revoked. Contact the sender for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { deal, property, compliance, checklist, documents } = data;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">
            Deal #<span className="tabular-nums">{deal.id}</span> — {property.address || "Property details"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Shared via AcreOS · Read-only view
          </p>
        </div>
        <Badge variant={deal.status === "closed" ? "default" : "secondary"} className="capitalize">
          {deal.status?.replace(/_/g, " ")}
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MapPin className="h-4 w-4" aria-hidden="true" /> Property
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground inline">Address: </dt>
              <dd className="inline">
                {property.address || "—"}
                {(property.city || property.state) && (
                  <>, {property.city || ""} {property.state || ""}</>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">County: </dt>
              <dd className="inline">{property.county || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Acreage: </dt>
              <dd className="inline tabular-nums">
                {property.sizeAcres ? `${parseFloat(property.sizeAcres).toFixed(2)} ac` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">APN: </dt>
              <dd className="inline font-mono">{property.apn || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" aria-hidden="true" /> Financials
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground inline">Offer: </dt>
              <dd className="inline tabular-nums">{fmtMoney(deal.offerAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Accepted: </dt>
              <dd className="inline tabular-nums">{fmtMoney(deal.acceptedAmount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Closing date: </dt>
              <dd className="inline tabular-nums">{deal.closingDate || "TBD"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground inline">Closing costs: </dt>
              <dd className="inline tabular-nums">{fmtMoney(deal.closingCosts)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {compliance && (compliance.doddFrank || compliance.usury) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" aria-hidden="true" /> Compliance status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" aria-label="Compliance checks">
              {compliance.doddFrank && (
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" aria-label="Pass" />
                  Dodd-Frank: {compliance.doddFrank}
                </li>
              )}
              {compliance.usury && (
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" aria-label="Pass" />
                  Usury: {compliance.usury}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {checklist && checklist.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Closing checklist — <span className="tabular-nums">{checklist.completed}</span>/<span className="tabular-nums">{checklist.total}</span> complete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1" aria-label="Closing checklist items">
              {checklist.items.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle
                    className={`h-3.5 w-3.5 shrink-0 ${item.completed ? "text-green-600" : "text-muted-foreground"}`}
                    aria-label={item.completed ? "Done" : "Open"}
                  />
                  <span className={item.completed ? "line-through text-muted-foreground" : ""}>
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {documents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden="true" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1" aria-label="Deal documents">
              {documents.map((doc, i) => (
                <li key={i} className="text-sm flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="truncate">{doc.name}</span>
                  <Badge variant="outline" className="text-xs ml-auto">
                    {doc.type}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-center">
        This link expires <span className="tabular-nums">{new Date(data.expiresAt).toLocaleDateString()}</span>. Powered by AcreOS.
      </p>
    </div>
  );
}
