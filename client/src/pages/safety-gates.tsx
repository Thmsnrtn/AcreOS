import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, AlertCircle, ShieldCheck, Loader2,
} from "lucide-react";

interface Deal {
  id: number;
  status: string;
  offerAmount?: string;
  exitStrategy?: string;
  propertyId: number;
  analysisResults?: {
    purchasePrice?: number;
  };
}

interface Property {
  id: number;
  apn?: string;
  address?: string;
  estimatedValue?: string;
  assessedValue?: string;
  status?: string;
}

interface Gate {
  id: string;
  label: string;
  description: string;
  check: (deal: Deal, property: Property | null) => GateResult;
}

type GateStatus = "pass" | "fail" | "missing";

interface GateResult {
  status: GateStatus;
  value?: string;
  note?: string;
}

const GATES: Gate[] = [
  {
    id: "apn",
    label: "APN Confirmed",
    description: "Assessor's Parcel Number must be on record",
    check: (_deal, property) => {
      if (!property) return { status: "missing", note: "Property not loaded" };
      if (property.apn && property.apn.trim()) {
        return { status: "pass", value: property.apn };
      }
      return { status: "fail", note: "APN is blank — verify with county assessor" };
    },
  },
  {
    id: "offer_amount",
    label: "Offer Amount Set",
    description: "Deal must have an offer amount recorded",
    check: (deal) => {
      if (!deal.offerAmount) return { status: "fail", note: "No offer amount recorded on this deal" };
      const amt = parseFloat(deal.offerAmount);
      if (isNaN(amt) || amt <= 0) return { status: "fail", note: "Offer amount is zero or invalid" };
      return { status: "pass", value: `$${amt.toLocaleString()}` };
    },
  },
  {
    id: "ltv",
    label: "LTV in Range (≤ 65%)",
    description: "Offer / estimated value must be ≤ 65%",
    check: (deal, property) => {
      if (!deal.offerAmount) return { status: "missing", note: "Offer amount not set" };
      if (!property) return { status: "missing", note: "Property not loaded" };
      const avm = parseFloat(property.estimatedValue ?? property.assessedValue ?? "0");
      const offer = parseFloat(deal.offerAmount);
      if (!avm || isNaN(avm)) return { status: "missing", note: "No AVM / assessed value on property" };
      const ltv = offer / avm;
      const ltvPct = (ltv * 100).toFixed(1);
      if (ltv <= 0.65) {
        return { status: "pass", value: `${ltvPct}% LTV` };
      }
      return { status: "fail", value: `${ltvPct}% LTV`, note: "Above 65% — verify comps before proceeding" };
    },
  },
  {
    id: "exit_strategy",
    label: "Exit Strategy Set",
    description: "Wholesale, hold, or seller-finance must be recorded",
    check: (deal) => {
      if (!deal.exitStrategy) return { status: "fail", note: "Exit strategy not defined on this deal" };
      return { status: "pass", value: deal.exitStrategy };
    },
  },
  {
    id: "property_status",
    label: "Property Not Already Closed",
    description: "Property should not be in sold/closed status",
    check: (_deal, property) => {
      if (!property) return { status: "missing", note: "Property not loaded" };
      if (property.status === "sold" || property.status === "closed") {
        return { status: "fail", note: `Property is marked "${property.status}" — may be a duplicate` };
      }
      return { status: "pass", value: property.status ?? "active" };
    },
  },
  {
    id: "deal_status",
    label: "Deal Status Pre-Close",
    description: "Deal should be in an active negotiation stage",
    check: (deal) => {
      const terminalStages = ["closed", "cancelled"];
      if (terminalStages.includes(deal.status)) {
        return { status: "fail", value: deal.status, note: "Deal is already in a terminal stage" };
      }
      return { status: "pass", value: deal.status.replace(/_/g, " ") };
    },
  },
];

function GateRow({ gate, result }: { gate: Gate; result: GateResult }) {
  const icon =
    result.status === "pass" ? (
      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
    ) : result.status === "fail" ? (
      <XCircle className="w-5 h-5 text-red-500 shrink-0" />
    ) : (
      <AlertCircle className="w-5 h-5 text-gray-400 shrink-0" />
    );

  const rowColor =
    result.status === "pass"
      ? "border-l-green-400"
      : result.status === "fail"
      ? "border-l-red-400"
      : "border-l-gray-300";

  return (
    <div className={`flex items-start gap-3 border-l-4 ${rowColor} pl-3 py-2`}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{gate.label}</p>
          {result.value && (
            <Badge
              variant="outline"
              className={`text-xs ${
                result.status === "pass"
                  ? "border-green-300 text-green-700"
                  : result.status === "fail"
                  ? "border-red-300 text-red-700"
                  : ""
              }`}
            >
              {result.value}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{gate.description}</p>
        {result.note && (
          <p className="text-xs text-amber-600 mt-0.5">{result.note}</p>
        )}
      </div>
    </div>
  );
}

export default function SafetyGatesPage() {
  const [selectedDealId, setSelectedDealId] = useState<string>("");

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then(r => r.json()),
  });

  const activeDeals = deals.filter(d => !["closed", "cancelled"].includes(d.status));
  const selectedDeal = deals.find(d => String(d.id) === selectedDealId);

  const { data: property = null, isLoading: propLoading } = useQuery<Property | null>({
    queryKey: ["/api/properties", selectedDeal?.propertyId],
    queryFn: () =>
      selectedDeal
        ? fetch(`/api/properties/${selectedDeal.propertyId}`).then(r => r.json())
        : Promise.resolve(null),
    enabled: !!selectedDeal,
  });

  const results = selectedDeal ? GATES.map(g => g.check(selectedDeal, property)) : [];
  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const missing = results.filter(r => r.status === "missing").length;
  const allPass = failed === 0 && missing === 0 && results.length > 0;

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-green-500" />
            Safety Gates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pre-offer checklist — advisory only, not a blocker
          </p>
        </div>

        <div className="max-w-sm">
          <Select value={selectedDealId} onValueChange={setSelectedDealId}>
            <SelectTrigger>
              <SelectValue placeholder={dealsLoading ? "Loading deals…" : "Select a deal to check"} />
            </SelectTrigger>
            <SelectContent>
              {activeDeals.map(d => (
                <SelectItem key={d.id} value={String(d.id)}>
                  Deal #{d.id}
                  {d.offerAmount && ` — $${parseFloat(d.offerAmount).toLocaleString()}`}
                  {` (${d.status.replace(/_/g, " ")})`}
                </SelectItem>
              ))}
              {activeDeals.length === 0 && !dealsLoading && (
                <SelectItem value="_none" disabled>No active deals</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {selectedDeal && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Gates for Deal #{selectedDeal.id}</span>
                {propLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <span
                    className={`text-sm font-normal ${
                      allPass ? "text-green-600" : failed > 0 ? "text-red-600" : "text-amber-600"
                    }`}
                  >
                    {allPass
                      ? "All gates passed"
                      : `${passed} passed · ${failed} failed${missing > 0 ? ` · ${missing} missing` : ""}`}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {GATES.map((gate, i) => (
                <GateRow key={gate.id} gate={gate} result={results[i] ?? { status: "missing" }} />
              ))}
              {!allPass && failed > 0 && (
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Review the failed gates above before submitting an offer. This checklist is advisory — your judgement overrides it.
                </p>
              )}
              {allPass && (
                <p className="text-xs text-green-600 pt-2 border-t">
                  All gates passed. This deal looks ready for an offer.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {!selectedDeal && !dealsLoading && (
          <p className="text-sm text-muted-foreground">Select a deal above to run the safety check.</p>
        )}
      </div>
    </PageShell>
  );
}
