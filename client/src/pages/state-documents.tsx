import { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FileText, AlertTriangle, Scale } from "lucide-react";

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
  useDocumentTitle("State document requirements");
  const [search, setSearch] = useState("");
  const searchId = useId();

  const filtered = Object.entries(STATE_DOCS).filter(([abbr, config]) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return abbr.toLowerCase().includes(q) || config.stateName.toLowerCase().includes(q);
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-state-documents-title">
          State document requirements
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Deed types, recording requirements, and seller-financing rules by state.
        </p>
      </div>

      <div>
        <Label htmlFor={searchId} className="sr-only">Search states</Label>
        <Input
          id={searchId}
          type="search"
          placeholder="Search states…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">No states match your search.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2" aria-label="State document requirements">
          {filtered.map(([abbr, config]) => (
            <li key={abbr}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{abbr}</span>
                        <span className="text-sm text-muted-foreground">{config.stateName}</span>
                        {config.attorneyState && (
                          <Badge variant="secondary" className="text-xs">
                            <Scale className="w-3 h-3 mr-1" aria-hidden="true" /> Attorney state
                          </Badge>
                        )}
                      </div>

                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <dt className="text-muted-foreground">Primary deed</dt>
                          <dd className="font-medium">{config.primaryDeedType}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Lien instrument</dt>
                          <dd className="font-medium">{config.lienInstrument}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Land contract</dt>
                          <dd className="font-medium">{config.landContractName}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Transfer tax</dt>
                          <dd className="font-medium tabular-nums">
                            {config.transferTaxPercent === 0
                              ? "None"
                              : `${config.transferTaxPercent.toFixed(2)}%`}
                          </dd>
                        </div>
                      </dl>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>Notary: {config.notaryRequired ? "required" : "not required"}</span>
                        {config.witnessCount > 0 && (
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-500" aria-hidden="true" />
                            <span className="tabular-nums">{config.witnessCount}</span> witness{config.witnessCount > 1 ? "es" : ""} required
                          </span>
                        )}
                      </div>
                    </div>

                    <FileText className="w-4 h-4 text-muted-foreground ml-3 shrink-0" aria-hidden="true" />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
