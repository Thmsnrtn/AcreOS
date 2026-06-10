/**
 * BATNACalculator — local, instant best-alternative math for the active
 * negotiation. Pure client-side; no fetches.
 * Extracted from pages/negotiation-copilot.tsx (T3 W1-4).
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Shield, ArrowLeftRight, Lightbulb } from 'lucide-react';
import { formatDollar } from './meta';

export function BATNACalculator() {
  const [askingPrice, setAskingPrice] = useState('');
  const [yourOffer, setYourOffer] = useState('');
  const [marketComps, setMarketComps] = useState('');
  const [renovationCost, setRenovationCost] = useState('');
  const [holdingCost, setHoldingCost] = useState('');
  const [desiredProfit, setDesiredProfit] = useState('20');

  const asking = parseFloat(askingPrice.replace(/[^0-9.]/g, '')) || 0;
  const offer = parseFloat(yourOffer.replace(/[^0-9.]/g, '')) || 0;
  const comps = parseFloat(marketComps.replace(/[^0-9.]/g, '')) || 0;
  const reno = parseFloat(renovationCost.replace(/[^0-9.]/g, '')) || 0;
  const holding = parseFloat(holdingCost.replace(/[^0-9.]/g, '')) || 0;
  const profitPct = parseFloat(desiredProfit) / 100;

  const maxAllowable = comps > 0 ? Math.round(comps * (1 - profitPct) - reno - holding) : 0;
  const walkawayPrice = maxAllowable;
  const negotiationZone = asking > 0 && offer > 0 ? {
    mid: Math.round((asking + offer) / 2),
    zopa: asking > walkawayPrice ? null : { low: offer, high: asking },
  } : null;

  const sellerFlexibility = asking > 0 && offer > 0
    ? Math.max(0, Math.min(100, Math.round(((asking - offer) / asking) * 100)))
    : 0;

  const dealViability = maxAllowable > 0 && offer > 0
    ? offer <= maxAllowable ? "viable" : offer <= maxAllowable * 1.1 ? "tight" : "unfavorable"
    : "unknown";

  const viabilityColor = dealViability === "viable" ? "text-acr-pos bg-acr-pos-soft border-acr-pos-soft" :
                         dealViability === "tight" ? "text-acr-warn bg-acr-warn-soft border-acr-warn-soft" :
                         dealViability === "unfavorable" ? "text-acr-neg bg-acr-neg-soft border-acr-neg-soft" :
                         "text-muted-foreground bg-muted/50 border-border";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
          BATNA calculator
          <span className="text-xs font-normal text-muted-foreground ml-1">— Best Alternative to Negotiated Agreement</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="border-0 p-0 m-0">
          <legend className="sr-only">BATNA inputs</legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "batna-asking", label: "Seller asking price", value: askingPrice, set: setAskingPrice, prefix: "$" },
              { id: "batna-offer", label: "Your offer", value: yourOffer, set: setYourOffer, prefix: "$" },
              { id: "batna-comps", label: "Market comps (ARV)", value: marketComps, set: setMarketComps, prefix: "$" },
              { id: "batna-reno", label: "Renovation cost", value: renovationCost, set: setRenovationCost, prefix: "$" },
              { id: "batna-holding", label: "Holding/closing cost", value: holdingCost, set: setHoldingCost, prefix: "$" },
              { id: "batna-profit", label: "Desired profit %", value: desiredProfit, set: setDesiredProfit, prefix: "%" },
            ].map(({ id, label, value, set, prefix }) => (
              <div key={id}>
                <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
                <div className="relative mt-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">{prefix}</span>
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    className="w-full border rounded-md pl-6 pr-2 py-1.5 min-h-11 sm:min-h-0 text-sm tabular-nums bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    placeholder={prefix === "$" ? "0" : "20"}
                  />
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {(asking > 0 || offer > 0 || comps > 0) && (
          <div className="space-y-3 pt-2 border-t" aria-live="polite">
            {/* Deal Viability */}
            <div className={`rounded-card border p-3 ${viabilityColor}`} role="status">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide">Deal viability</span>
                <Badge className={`text-xs ${viabilityColor} border`} aria-label={`Deal viability: ${dealViability}`}>{dealViability}</Badge>
              </div>
            </div>

            {/* Key outputs */}
            <dl className="grid grid-cols-2 gap-2 m-0">
              {maxAllowable > 0 && (
                <div className="rounded-card border p-3 bg-muted/30">
                  <dt className="text-micro text-muted-foreground uppercase tracking-wide">Max allowable offer</dt>
                  <dd className="text-xl font-bold tabular-nums text-primary mt-0.5 m-0">{formatDollar(maxAllowable)}</dd>
                  <p className="text-micro text-muted-foreground">your BATNA walkaway</p>
                </div>
              )}
              {negotiationZone !== null && negotiationZone.mid > 0 && (
                <div className="rounded-card border p-3 bg-muted/30">
                  <dt className="text-micro text-muted-foreground uppercase tracking-wide">Midpoint</dt>
                  <dd className="text-xl font-bold tabular-nums mt-0.5 m-0">{formatDollar(negotiationZone.mid)}</dd>
                  <p className="text-micro text-muted-foreground">split-the-difference</p>
                </div>
              )}
            </dl>

            {/* Seller flexibility gauge */}
            {sellerFlexibility > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <ArrowLeftRight className="w-3 h-3" aria-hidden="true" /> Negotiation range
                  </span>
                  <span className="font-semibold tabular-nums">{sellerFlexibility}% gap</span>
                </div>
                <div
                  className="w-full bg-muted rounded-full h-2 overflow-hidden"
                  role="progressbar"
                  aria-label="Negotiation gap between asking and offer"
                  aria-valuenow={sellerFlexibility}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full ${sellerFlexibility > 30 ? "bg-acr-pos" : sellerFlexibility > 15 ? "bg-acr-warn" : "bg-acr-neg"}`}
                    style={{ width: `${Math.min(sellerFlexibility, 100)}%` }}
                  />
                </div>
                <p className="text-micro text-muted-foreground mt-1">
                  {sellerFlexibility > 30 ? "Wide gap — room to negotiate aggressively." :
                   sellerFlexibility > 15 ? "Moderate gap — fair negotiation zone." :
                   "Narrow gap — close to agreement."}
                </p>
              </div>
            )}

            {/* Strategy hint */}
            {dealViability !== "unknown" && (
              <div className="flex items-start gap-2 text-xs bg-primary/5 rounded-md p-2.5 border border-primary/10">
                <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {dealViability === "viable"
                    ? "Your offer is within your BATNA range. Hold firm or offer a small concession to close faster."
                    : dealViability === "tight"
                    ? "You're slightly above your max allowable. Look for seller concessions (repairs, closing costs) to compensate."
                    : "This deal doesn't pencil at current pricing. Consider walking away or counter significantly lower."}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
