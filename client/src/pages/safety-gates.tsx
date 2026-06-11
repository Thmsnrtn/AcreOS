import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, AlertCircle, ShieldCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

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
    label: "APN confirmed",
    description: "Assessor's Parcel Number must be on record.",
    check: (_deal, property) => {
      if (!property) return { status: "missing", note: "Property not loaded." };
      if (property.apn && property.apn.trim()) {
        return { status: "pass", value: property.apn };
      }
      return { status: "fail", note: "APN is blank — verify with county assessor." };
    },
  },
  {
    id: "offer_amount",
    label: "Offer amount set",
    description: "Deal must have an offer amount recorded.",
    check: (deal) => {
      if (!deal.offerAmount) return { status: "fail", note: "No offer amount recorded on this deal." };
      const amt = parseFloat(deal.offerAmount);
      if (isNaN(amt) || amt <= 0) return { status: "fail", note: "Offer amount is zero or invalid." };
      return { status: "pass", value: usd(amt) };
    },
  },
  {
    id: "ltv",
    label: "LTV in range (≤ 65%)",
    description: "Offer / estimated value must be ≤ 65%.",
    check: (deal, property) => {
      if (!deal.offerAmount) return { status: "missing", note: "Offer amount not set." };
      if (!property) return { status: "missing", note: "Property not loaded." };
      const avm = parseFloat(property.estimatedValue ?? property.assessedValue ?? "0");
      const offer = parseFloat(deal.offerAmount);
      if (!avm || isNaN(avm)) return { status: "missing", note: "No AVM / assessed value on property." };
      const ltv = offer / avm;
      const ltvPct = (ltv * 100).toFixed(1);
      if (ltv <= 0.65) {
        return { status: "pass", value: `${ltvPct}% LTV` };
      }
      return { status: "fail", value: `${ltvPct}% LTV`, note: "Above 65% — verify comps before proceeding." };
    },
  },
  {
    id: "exit_strategy",
    label: "Exit strategy set",
    description: "Wholesale, hold, or seller-finance must be recorded.",
    check: (deal) => {
      if (!deal.exitStrategy) return { status: "fail", note: "Exit strategy not defined on this deal." };
      return { status: "pass", value: deal.exitStrategy };
    },
  },
  {
    id: "property_status",
    label: "Property not already closed",
    description: "Property should not be in sold/closed status.",
    check: (_deal, property) => {
      if (!property) return { status: "missing", note: "Property not loaded." };
      if (property.status === "sold" || property.status === "closed") {
        return { status: "fail", note: `Property is marked "${property.status}" — may be a duplicate.` };
      }
      return { status: "pass", value: property.status ?? "active" };
    },
  },
  {
    id: "deal_status",
    label: "Deal status pre-close",
    description: "Deal should be in an active negotiation stage.",
    check: (deal) => {
      const terminalStages = ["closed", "cancelled"];
      if (terminalStages.includes(deal.status)) {
        return { status: "fail", value: deal.status, note: "Deal is already in a terminal stage." };
      }
      return { status: "pass", value: deal.status.replace(/_/g, " ") };
    },
  },
];

const STATUS_LABEL: Record<GateStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  missing: "Missing",
};

function GateRow({ gate, result }: { gate: Gate; result: GateResult }) {
  const statusLabel = STATUS_LABEL[result.status];
  const icon =
    result.status === "pass" ? (
      <CheckCircle2 className="w-5 h-5 text-acr-pos shrink-0" aria-label={statusLabel} />
    ) : result.status === "fail" ? (
      <XCircle className="w-5 h-5 text-acr-neg shrink-0" aria-label={statusLabel} />
    ) : (
      <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0" aria-label={statusLabel} />
    );

  const rowColor =
    result.status === "pass"
      ? "border-l-green-400"
      : result.status === "fail"
      ? "border-l-red-400"
      : "border-l-gray-300";

  return (
    <li
      className={`flex items-start gap-3 border-l-4 ${rowColor} pl-3 py-2`}
      role={result.status === "fail" ? "alert" : undefined}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{gate.label}</p>
          {result.value && (
            <Badge
              variant="outline"
              className={`text-xs tabular-nums ${
                result.status === "pass"
                  ? "border-acr-pos text-acr-pos"
                  : result.status === "fail"
                  ? "border-acr-neg text-acr-neg"
                  : ""
              }`}
            >
              {result.value}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{gate.description}</p>
        {result.note && (
          <p className="text-xs text-acr-warn mt-0.5">{result.note}</p>
        )}
      </div>
    </li>
  );
}

export default function SafetyGatesPage() {
  useDocumentTitle("Safety gates");
  const dealSelectId = useId();
  const [selectedDealId, setSelectedDealId] = useState<string>("");

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: async () => {
      const r = await fetch("/api/deals", { credentials: "include" });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
    },
  });

  const activeDeals = Array.isArray(deals) ? deals.filter(d => !["closed", "cancelled"].includes(d.status)) : [];
  const selectedDeal = Array.isArray(deals) ? deals.find(d => String(d.id) === selectedDealId) : undefined;

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
            <ShieldCheck className="w-6 h-6 text-acr-pos" aria-hidden="true" />
            Safety gates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pre-offer checklist — advisory only, not a blocker.
          </p>
        </div>

        <div className="max-w-sm">
          <Label htmlFor={dealSelectId} className="sr-only">Select a deal to check</Label>
          <Select value={selectedDealId} onValueChange={setSelectedDealId}>
            <SelectTrigger id={dealSelectId} aria-label="Select a deal to check">
              <SelectValue placeholder={dealsLoading ? "Loading deals…" : "Select a deal to check"} />
            </SelectTrigger>
            <SelectContent>
              {activeDeals.map(d => (
                <SelectItem key={d.id} value={String(d.id)}>
                  Deal #<span className="tabular-nums">{d.id}</span>
                  {d.offerAmount && ` — ${usd(parseFloat(d.offerAmount))}`}
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
              <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                <span>Gates for Deal #<span className="tabular-nums">{selectedDeal.id}</span></span>
                {propLoading ? (
                  <Skeleton announceText="Loading property data…" className="h-4 w-36" />
                ) : (
                  <span
                    className={`text-sm font-normal tabular-nums ${
                      allPass ? "text-acr-pos" : failed > 0 ? "text-acr-neg" : "text-acr-warn"
                    }`}
                  >
                    {allPass
                      ? "All gates passed"
                      : `${passed} passed · ${failed} failed${missing > 0 ? ` · ${missing} missing` : ""}`}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3" aria-label={`Pre-offer safety gates for Deal #${selectedDeal.id}`}>
                {GATES.map((gate, i) => (
                  <GateRow key={gate.id} gate={gate} result={results[i] ?? { status: "missing" }} />
                ))}
              </ul>
              {!allPass && failed > 0 && (
                <p className="text-xs text-muted-foreground pt-3 mt-3 border-t">
                  Review the failed gates above before submitting an offer. This checklist is advisory — your judgement overrides it.
                </p>
              )}
              {allPass && (
                <p className="text-xs text-acr-pos pt-3 mt-3 border-t" role="status">
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
