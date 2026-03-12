import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, AlertTriangle, Scale } from "lucide-react";

// Minimal state config for UI — full data comes from server
const STATE_DOCS: Record<string, {
  stateName: string;
  primaryDeedType: string;
  lienInstrument: string;
  landContractName: string;
  notaryRequired: boolean;
  witnessCount: number;
  transferTaxPercent: number;
  attorneyState: boolean;
}> = {
  TX: { stateName: "Texas", primaryDeedType: "General Warranty Deed", lienInstrument: "Deed of Trust", landContractName: "Contract for Deed", notaryRequired: true, witnessCount: 0, transferTaxPercent: 0, attorneyState: false },
  FL: { stateName: "Florida", primaryDeedType: "General Warranty Deed", lienInstrument: "Mortgage", landContractName: "Land Sale Contract", notaryRequired: true, witnessCount: 2, transferTaxPercent: 0.07, attorneyState: false },
  CA: { stateName: "California", primaryDeedType: "Grant Deed", lienInstrument: "Deed of Trust", landContractName: "Land Sale Contract", notaryRequired: true, witnessCount: 0, transferTaxPercent: 0.11, attorneyState: false },
  AZ: { stateName: "Arizona", primaryDeedType: "General Warranty Deed", lienInstrument: "Deed of Trust", landContractName: "Agreement for Deed", notaryRequired: true, witnessCount: 0, transferTaxPercent: 0, attorneyState: false },
  CO: { stateName: "Colorado", primaryDeedType: "General Warranty Deed", lienInstrument: "Deed of Trust", landContractName: "Installment Sale Agreement", notaryRequired: true, witnessCount: 0, transferTaxPercent: 0.01, attorneyState: false },
  GA: { stateName: "Georgia", primaryDeedType: "General Warranty Deed", lienInstrument: "Security Deed", landContractName: "Installment Sale Agreement", notaryRequired: true, witnessCount: 2, transferTaxPercent: 0.1, attorneyState: true },
  NC: { stateName: "North Carolina", primaryDeedType: "General Warranty Deed", lienInstrument: "Deed of Trust", landContractName: "Installment Sale Contract", notaryRequired: true, witnessCount: 1, transferTaxPercent: 0.2, attorneyState: true },
  WA: { stateName: "Washington", primaryDeedType: "General Warranty Deed", lienInstrument: "Deed of Trust", landContractName: "Contract for Deed", notaryRequired: true, witnessCount: 0, transferTaxPercent: 1.1, attorneyState: false },
  NM: { stateName: "New Mexico", primaryDeedType: "General Warranty Deed", lienInstrument: "Mortgage", landContractName: "Land Contract", notaryRequired: true, witnessCount: 0, transferTaxPercent: 0, attorneyState: false },
  WY: { stateName: "Wyoming", primaryDeedType: "General Warranty Deed", lienInstrument: "Mortgage", landContractName: "Land Contract", notaryRequired: true, witnessCount: 0, transferTaxPercent: 0, attorneyState: false },
};

export default function StateDocumentsPage() {
  const [search, setSearch] = useState("");

  const filtered = Object.entries(STATE_DOCS).filter(([abbr, config]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return abbr.toLowerCase().includes(q) || config.stateName.toLowerCase().includes(q);
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-state-documents-title">
          State Document Requirements
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Deed types, recording requirements, and seller-financing rules by state.
        </p>
      </div>

      <Input
        placeholder="Search states..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <div className="grid gap-2">
        {filtered.map(([abbr, config]) => (
          <Card key={abbr}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{abbr}</span>
                    <span className="text-sm text-muted-foreground">{config.stateName}</span>
                    {config.attorneyState && (
                      <Badge variant="secondary" className="text-xs">
                        <Scale className="w-3 h-3 mr-1" /> Attorney State
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Primary Deed</p>
                      <p className="font-medium">{config.primaryDeedType}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Lien Instrument</p>
                      <p className="font-medium">{config.lienInstrument}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Land Contract</p>
                      <p className="font-medium">{config.landContractName}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Transfer Tax</p>
                      <p className="font-medium">
                        {config.transferTaxPercent === 0
                          ? "None"
                          : `${config.transferTaxPercent.toFixed(2)}%`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Notary: {config.notaryRequired ? "Required" : "Not required"}</span>
                    {config.witnessCount > 0 && (
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                        {config.witnessCount} witness{config.witnessCount > 1 ? "es" : ""} required
                      </span>
                    )}
                  </div>
                </div>

                <FileText className="w-4 h-4 text-muted-foreground ml-3" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
