import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, MapPin, DollarSign, FileText, CheckCircle, AlertTriangle } from "lucide-react";

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

function fmt$(val: string | number | undefined | null): string {
  if (!val) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (!isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export default function SharedDealPage() {
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
      <div className="max-w-2xl mx-auto p-6 space-y-4">
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
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Link Expired or Invalid</h2>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            Deal #{deal.id} — {property.address || "Property Details"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Shared via AcreOS · Read-only view
          </p>
        </div>
        <Badge variant={deal.status === "closed" ? "default" : "secondary"}>
          {deal.status?.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Property Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Property
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Address:</span>{" "}
            {property.address || "—"}, {property.city || ""} {property.state || ""}
          </div>
          <div>
            <span className="text-muted-foreground">County:</span> {property.county || "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Acreage:</span>{" "}
            {property.sizeAcres ? `${parseFloat(property.sizeAcres).toFixed(2)} ac` : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">APN:</span> {property.apn || "—"}
          </div>
        </CardContent>
      </Card>

      {/* Financials */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Financials
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Offer:</span> {fmt$(deal.offerAmount)}
          </div>
          <div>
            <span className="text-muted-foreground">Accepted:</span> {fmt$(deal.acceptedAmount)}
          </div>
          <div>
            <span className="text-muted-foreground">Closing Date:</span>{" "}
            {deal.closingDate || "TBD"}
          </div>
          <div>
            <span className="text-muted-foreground">Closing Costs:</span>{" "}
            {fmt$(deal.closingCosts)}
          </div>
        </CardContent>
      </Card>

      {/* Compliance */}
      {compliance && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" /> Compliance Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {compliance.doddFrank && (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                Dodd-Frank: {compliance.doddFrank}
              </div>
            )}
            {compliance.usury && (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                Usury: {compliance.usury}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Closing Checklist */}
      {checklist && checklist.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Closing Checklist — {checklist.completed}/{checklist.total} complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {checklist.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <CheckCircle
                  className={`h-3.5 w-3.5 ${
                    item.completed ? "text-green-600" : "text-muted-foreground"
                  }`}
                />
                <span className={item.completed ? "line-through text-muted-foreground" : ""}>
                  {item.title}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      {documents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {documents.map((doc, i) => (
              <div key={i} className="text-sm flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                {doc.name}
                <Badge variant="outline" className="text-xs ml-auto">
                  {doc.type}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-center">
        This link expires {new Date(data.expiresAt).toLocaleDateString()}. Powered by AcreOS.
      </p>
    </div>
  );
}
