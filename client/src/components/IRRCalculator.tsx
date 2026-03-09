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
import { TrendingUp, Calculator, FileDown } from 'lucide-react';

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

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" />
              IRR / Return Calculator
            </CardTitle>
            <CardDescription>
              Calculate IRR, NPV, equity multiple, and cash-on-cash return
            </CardDescription>
          </div>
          {showExport && (
            <Button size="sm" variant="outline" onClick={handleExport}>
              <FileDown className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Purchase Price ($)</Label>
            <Input
              type="number"
              value={inputs.purchasePrice}
              onChange={e => setField('purchasePrice', e.target.value)}
              min={0}
            />
          </div>
          <div>
            <Label className="text-xs">Annual Net Income ($)</Label>
            <Input
              type="number"
              value={inputs.annualIncome}
              onChange={e => setField('annualIncome', e.target.value)}
              min={0}
            />
          </div>
          <div>
            <Label className="text-xs">Exit / Sale Value ($)</Label>
            <Input
              type="number"
              value={inputs.exitValue}
              onChange={e => setField('exitValue', e.target.value)}
              min={0}
            />
          </div>
          <div>
            <Label className="text-xs">Hold Period (Years)</Label>
            <Input
              type="number"
              value={inputs.holdYears}
              onChange={e => setField('holdYears', e.target.value)}
              min={1}
              max={50}
            />
          </div>
          <div>
            <Label className="text-xs">Financing % (LTV)</Label>
            <Input
              type="number"
              value={inputs.financingPct}
              onChange={e => setField('financingPct', e.target.value)}
              min={0}
              max={100}
            />
          </div>
          <div>
            <Label className="text-xs">Discount Rate for NPV (%)</Label>
            <Input
              type="number"
              value={inputs.discountRate}
              onChange={e => setField('discountRate', e.target.value)}
              min={0}
              max={100}
            />
          </div>
        </div>

        {/* Results */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <p className="text-xs text-muted-foreground mb-1">IRR</p>
            <p className={`text-3xl font-bold ${irrColor}`}>
              {fmtPct(results.irr)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Internal Rate of Return</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <p className="text-xs text-muted-foreground mb-1">NPV</p>
            <p className={`text-3xl font-bold ${results.npv >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {fmtDollar(results.npv)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">@ {inputs.discountRate}% discount</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <p className="text-xs text-muted-foreground mb-1">Equity Multiple</p>
            <p className="text-3xl font-bold text-blue-600">
              {results.equityMultiple.toFixed(2)}x
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Total return on equity</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/40 text-center">
            <p className="text-xs text-muted-foreground mb-1">Cash-on-Cash</p>
            <p className="text-3xl font-bold text-purple-600">
              {fmtPct(results.cashOnCashReturn)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Annual income yield</p>
          </div>
        </div>

        {/* Summary Row */}
        <div className="flex flex-wrap gap-3 text-sm">
          <Badge variant="outline">
            Equity Invested: {fmtDollar(results.totalEquityInvested)}
          </Badge>
          <Badge variant="outline">
            Total Profit: {fmtDollar(results.totalProfit)}
          </Badge>
          <Badge variant="outline">
            Hold: {inputs.holdYears} year{inputs.holdYears !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Annual cash flows */}
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2">Annual Cash Flow Schedule</p>
          <div className="flex gap-2 flex-wrap">
            {results.annualCashFlows.map((cf, i) => (
              <div key={i} className="text-center">
                <p className="text-xs text-muted-foreground">Y{i}</p>
                <p className={`text-xs font-mono font-bold ${cf >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {fmtDollar(cf)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default IRRCalculator;
