/**
 * IRRCalculator.tsx
 *
 * Standalone IRR/NPV/Equity Multiple/Cash-on-Cash return calculator.
 * Can be embedded anywhere or used as a modal content.
 *
 * Usage:
 *   import { IRRCalculator } from '@/components/IRRCalculator';
 *   <IRRCalculator />
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calculator, FileDown } from 'lucide-react';

// ─── Math utilities ───────────────────────────────────────────────────────────

/**
 * Newton-Raphson IRR solver.
 * cashFlows[0] is the initial investment (negative), rest are inflows.
 * Returns IRR as a decimal (e.g. 0.15 = 15%).
 */
function calcIRR(cashFlows: number[], guess = 0.1): number | null {
  const MAX_ITER = 1000;
  const TOLERANCE = 1e-7;

  let rate = guess;

  for (let i = 0; i < MAX_ITER; i++) {
    let npv = 0;
    let dNpv = 0;

    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      if (t > 0) dNpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }

    if (Math.abs(dNpv) < 1e-12) return null; // derivative too small

    const newRate = rate - npv / dNpv;
    if (Math.abs(newRate - rate) < TOLERANCE) return newRate;
    rate = newRate;
  }

  return null; // did not converge
}

/**
 * Net Present Value given annual discount rate and cash flows.
 * cashFlows[0] is initial investment (negative).
 */
function calcNPV(discountRate: number, cashFlows: number[]): number {
  return cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + discountRate, t), 0);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IRRInputs {
  purchasePrice: number;    // Total investment cost
  annualIncome: number;     // Net annual income (cash flow)
  exitValue: number;        // Sale price at end of hold
  holdYears: number;        // Hold period in years
  financingPct: number;     // % of purchase price financed (0-100)
  discountRate: number;     // Discount rate for NPV % (0-100)
}

export interface IRRResults {
  irr: number | null;       // decimal (0.15 = 15%)
  npv: number;
  equityMultiple: number;
  cashOnCashReturn: number; // decimal (0.08 = 8%)
  totalEquityInvested: number;
  totalProfit: number;
  annualCashFlows: number[];
}

// ─── Calculation engine ───────────────────────────────────────────────────────

export function calculateReturns(inputs: IRRInputs): IRRResults {
  const {
    purchasePrice,
    annualIncome,
    exitValue,
    holdYears,
    financingPct,
    discountRate,
  } = inputs;

  const loanAmount = purchasePrice * (financingPct / 100);
  const equityInvested = purchasePrice - loanAmount;

  // Simple annual cash flows (income each year, exit value at end)
  // Year 0: -equityInvested (equity down payment)
  // Year 1..N-1: annualIncome
  // Year N: annualIncome + exitValue - loanBalance (simplified: exit net of loan)
  const loanBalance = loanAmount; // Simplified: interest-only or balloon
  const netExitProceeds = exitValue - loanBalance;

  const cashFlows: number[] = [-equityInvested];
  for (let t = 1; t <= holdYears; t++) {
    if (t < holdYears) {
      cashFlows.push(annualIncome);
    } else {
      cashFlows.push(annualIncome + netExitProceeds);
    }
  }

  const irr = calcIRR(cashFlows);
  const npv = calcNPV(discountRate / 100, cashFlows);
  const totalCashIn = annualIncome * holdYears + netExitProceeds;
  const equityMultiple = equityInvested > 0 ? (equityInvested + totalCashIn) / equityInvested : 0;
  const cashOnCashReturn = equityInvested > 0 ? annualIncome / equityInvested : 0;
  const totalProfit = totalCashIn - equityInvested;

  return {
    irr,
    npv,
    equityMultiple,
    cashOnCashReturn,
    totalEquityInvested: equityInvested,
    totalProfit,
    annualCashFlows: cashFlows,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

function fmtDollar(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function fmtPct(n: number | null) {
  if (n === null || isNaN(n as number)) return 'N/A';
  return `${(n * 100).toFixed(1)}%`;
}

interface IRRCalculatorProps {
  defaultInputs?: Partial<IRRInputs>;
  showExport?: boolean;
  className?: string;
}

export function IRRCalculator({
  defaultInputs,
  showExport = true,
  className = '',
}: IRRCalculatorProps) {
  const [inputs, setInputs] = useState<IRRInputs>({
    purchasePrice: defaultInputs?.purchasePrice ?? 150000,
    annualIncome: defaultInputs?.annualIncome ?? 12000,
    exitValue: defaultInputs?.exitValue ?? 250000,
    holdYears: defaultInputs?.holdYears ?? 5,
    financingPct: defaultInputs?.financingPct ?? 0,
    discountRate: defaultInputs?.discountRate ?? 10,
  });

  const results = useMemo(() => calculateReturns(inputs), [inputs]);

  function setField(field: keyof IRRInputs, value: string) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setInputs(prev => ({ ...prev, [field]: num }));
    }
  }

  function handleExport() {
    const rows = [
      ['Metric', 'Value'],
      ['Purchase Price', `$${inputs.purchasePrice}`],
      ['Annual Income', `$${inputs.annualIncome}`],
      ['Exit Value', `$${inputs.exitValue}`],
      ['Hold Years', String(inputs.holdYears)],
      ['Financing %', `${inputs.financingPct}%`],
      ['Equity Invested', fmtDollar(results.totalEquityInvested)],
      ['IRR', fmtPct(results.irr)],
      ['NPV', fmtDollar(results.npv)],
      ['Equity Multiple', `${results.equityMultiple.toFixed(2)}x`],
      ['Cash-on-Cash Return', fmtPct(results.cashOnCashReturn)],
      ['Total Profit', fmtDollar(results.totalProfit)],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'irr-analysis.csv';
    a.click();
  }

  const irrColor =
    results.irr === null
      ? 'text-muted-foreground'
      : results.irr >= 0.2
      ? 'text-emerald-600'
      : results.irr >= 0.1
      ? 'text-yellow-600'
      : 'text-red-500';

  const irrText = fmtPct(results.irr);
  const npvText = fmtDollar(results.npv);
  const emText = `${results.equityMultiple.toFixed(2)}x`;
  const cocText = fmtPct(results.cashOnCashReturn);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" aria-hidden="true" />
              IRR / return calculator
            </CardTitle>
            <CardDescription>
              Calculate IRR, NPV, equity multiple, and cash-on-cash return
            </CardDescription>
          </div>
          {showExport && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleExport}
              aria-label="Export IRR analysis as CSV"
            >
              <FileDown className="w-4 h-4 mr-1" aria-hidden="true" /> Export CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="irr-purchase-price" className="text-xs">Purchase price ($)</Label>
            <Input
              id="irr-purchase-price"
              type="number"
              value={inputs.purchasePrice}
              onChange={e => setField('purchasePrice', e.target.value)}
              min={0}
              className="tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="irr-annual-income" className="text-xs">Annual net income ($)</Label>
            <Input
              id="irr-annual-income"
              type="number"
              value={inputs.annualIncome}
              onChange={e => setField('annualIncome', e.target.value)}
              min={0}
              className="tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="irr-exit-value" className="text-xs">Exit / sale value ($)</Label>
            <Input
              id="irr-exit-value"
              type="number"
              value={inputs.exitValue}
              onChange={e => setField('exitValue', e.target.value)}
              min={0}
              className="tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="irr-hold-years" className="text-xs">Hold period (years)</Label>
            <Input
              id="irr-hold-years"
              type="number"
              value={inputs.holdYears}
              onChange={e => setField('holdYears', e.target.value)}
              min={1}
              max={50}
              className="tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="irr-financing-pct" className="text-xs">Financing % (LTV)</Label>
            <Input
              id="irr-financing-pct"
              type="number"
              value={inputs.financingPct}
              onChange={e => setField('financingPct', e.target.value)}
              min={0}
              max={100}
              className="tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="irr-discount-rate" className="text-xs">Discount rate for NPV (%)</Label>
            <Input
              id="irr-discount-rate"
              type="number"
              value={inputs.discountRate}
              onChange={e => setField('discountRate', e.target.value)}
              min={0}
              max={100}
              className="tabular-nums"
            />
          </div>
        </div>

        {/* Results */}
        <dl
          aria-label="IRR calculator results"
          className="grid grid-cols-2 md:grid-cols-4 gap-4 m-0"
        >
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <dt className="text-xs text-muted-foreground mb-1">IRR</dt>
            <dd className={`text-3xl font-bold tabular-nums m-0 ${irrColor}`} aria-label={`IRR: ${irrText}`}>
              {irrText}
            </dd>
            <p className="text-xs text-muted-foreground mt-0.5">Internal rate of return</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <dt className="text-xs text-muted-foreground mb-1">NPV</dt>
            <dd className={`text-3xl font-bold tabular-nums m-0 ${results.npv >= 0 ? 'text-emerald-600' : 'text-red-500'}`} aria-label={`NPV: ${npvText}`}>
              {npvText}
            </dd>
            <p className="text-xs text-muted-foreground mt-0.5">@ <span className="tabular-nums">{inputs.discountRate}</span>% discount</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <dt className="text-xs text-muted-foreground mb-1">Equity multiple</dt>
            <dd className="text-3xl font-bold tabular-nums text-blue-600 m-0" aria-label={`Equity multiple: ${emText}`}>
              {emText}
            </dd>
            <p className="text-xs text-muted-foreground mt-0.5">Total return on equity</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <dt className="text-xs text-muted-foreground mb-1">Cash-on-cash</dt>
            <dd className="text-3xl font-bold tabular-nums text-purple-600 m-0" aria-label={`Cash-on-cash return: ${cocText}`}>
              {cocText}
            </dd>
            <p className="text-xs text-muted-foreground mt-0.5">Annual income yield</p>
          </div>
        </dl>

        {/* Summary Row */}
        <ul aria-label="Investment summary" className="flex flex-wrap gap-3 text-sm list-none p-0 m-0">
          <li>
            <Badge variant="outline" aria-label={`Equity invested: ${fmtDollar(results.totalEquityInvested)}`}>
              Equity invested: <span className="tabular-nums ml-1">{fmtDollar(results.totalEquityInvested)}</span>
            </Badge>
          </li>
          <li>
            <Badge variant="outline" aria-label={`Total profit: ${fmtDollar(results.totalProfit)}`}>
              Total profit: <span className="tabular-nums ml-1">{fmtDollar(results.totalProfit)}</span>
            </Badge>
          </li>
          <li>
            <Badge variant="outline" aria-label={`Hold period: ${inputs.holdYears} year${inputs.holdYears !== 1 ? 's' : ''}`}>
              Hold: <span className="tabular-nums ml-1">{inputs.holdYears}</span> year{inputs.holdYears !== 1 ? 's' : ''}
            </Badge>
          </li>
        </ul>

        {/* Annual cash flows */}
        <section aria-labelledby="irr-cashflow-heading">
          <p id="irr-cashflow-heading" className="text-xs text-muted-foreground font-medium mb-2">Annual cash flow schedule</p>
          <ol aria-label="Annual cash flows by year" className="flex gap-2 flex-wrap list-none p-0 m-0">
            {results.annualCashFlows.map((cf, i) => (
              <li key={i} className="text-center" aria-label={`Year ${i}: ${fmtDollar(cf)}`}>
                <p className="text-xs text-muted-foreground" aria-hidden="true">Y<span className="tabular-nums">{i}</span></p>
                <p className={`text-xs font-mono font-bold tabular-nums ${cf >= 0 ? 'text-emerald-600' : 'text-red-500'}`} aria-hidden="true">
                  {fmtDollar(cf)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </CardContent>
    </Card>
  );
}

export default IRRCalculator;
