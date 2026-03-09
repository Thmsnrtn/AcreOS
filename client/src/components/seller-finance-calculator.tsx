/**
 * T31 — Seller Finance Calculator
 *
 * Interactive amortization calculator for seller-financed land deals.
 * Shows: monthly payment, amortization schedule preview, total interest paid.
 * Used on the Borrower Portal and Deal views to explain seller financing to sellers.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Percent, Calendar, TrendingDown } from "lucide-react";

interface AmortizationRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

function buildSchedule(
  principal: number,
  annualRate: number,
  termMonths: number
): AmortizationRow[] {
  if (principal <= 0 || annualRate < 0 || termMonths <= 0) return [];
  const monthlyRate = annualRate / 100 / 12;
  const payment =
    monthlyRate === 0
      ? principal / termMonths
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
        (Math.pow(1 + monthlyRate, termMonths) - 1);

  const rows: AmortizationRow[] = [];
  let balance = principal;
  for (let m = 1; m <= termMonths; m++) {
    const interest = balance * monthlyRate;
    const principalPaid = payment - interest;
    balance = Math.max(0, balance - principalPaid);
    rows.push({
      month: m,
      payment: Math.round(payment * 100) / 100,
      principal: Math.round(principalPaid * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    });
  }
  return rows;
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtFull$(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

interface Props {
  initialPurchasePrice?: number;
  initialDownPayment?: number;
  initialRate?: number;
  initialTermYears?: number;
  readOnly?: boolean;
  onValuesChange?: (values: {
    purchasePrice: number;
    downPayment: number;
    interestRate: number;
    termMonths: number;
    monthlyPayment: number;
  }) => void;
}

export default function SellerFinanceCalculator({
  initialPurchasePrice = 100000,
  initialDownPayment = 10000,
  initialRate = 8,
  initialTermYears = 10,
  readOnly = false,
  onValuesChange,
}: Props) {
  const [purchasePrice, setPurchasePrice] = useState(initialPurchasePrice);
  const [downPayment, setDownPayment] = useState(initialDownPayment);
  const [rate, setRate] = useState(initialRate);
  const [termYears, setTermYears] = useState(initialTermYears);
  const [showFullSchedule, setShowFullSchedule] = useState(false);

  const principal = Math.max(0, purchasePrice - downPayment);
  const termMonths = termYears * 12;

  const schedule = useMemo(
    () => buildSchedule(principal, rate, termMonths),
    [principal, rate, termMonths]
  );

  const monthlyPayment = schedule[0]?.payment ?? 0;
  const totalPaid = monthlyPayment * termMonths;
  const totalInterest = totalPaid - principal;
  const ltv = purchasePrice > 0 ? ((principal / purchasePrice) * 100).toFixed(1) : "0.0";

  // Notify parent on value change
  const handleChange = (field: string, val: number) => {
    const next = {
      purchasePrice,
      downPayment,
      interestRate: rate,
      termMonths,
      monthlyPayment,
      [field]: val,
    };
    if (field === "termYears") next.termMonths = val * 12;
    onValuesChange?.({
      purchasePrice: next.purchasePrice,
      downPayment: next.downPayment,
      interestRate: next.interestRate,
      termMonths: next.termMonths,
      monthlyPayment: next.monthlyPayment,
    });
  };

  const displayRows = showFullSchedule ? schedule : schedule.filter(r => r.month <= 12);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-green-700" />
          Seller Financing Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Purchase Price</Label>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="number"
                className="pl-7 h-9 text-sm"
                value={purchasePrice}
                disabled={readOnly}
                onChange={e => {
                  const v = Number(e.target.value);
                  setPurchasePrice(v);
                  handleChange("purchasePrice", v);
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Down Payment</Label>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="number"
                className="pl-7 h-9 text-sm"
                value={downPayment}
                disabled={readOnly}
                onChange={e => {
                  const v = Number(e.target.value);
                  setDownPayment(v);
                  handleChange("downPayment", v);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="h-3 w-3" /> Interest Rate
              </Label>
              <span className="text-xs font-semibold">{rate}%</span>
            </div>
            {readOnly ? (
              <p className="text-sm font-medium">{rate}% per annum</p>
            ) : (
              <Slider
                min={0}
                max={20}
                step={0.5}
                value={[rate]}
                onValueChange={([v]) => {
                  setRate(v);
                  handleChange("interestRate", v);
                }}
                className="w-full"
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Term
              </Label>
              <span className="text-xs font-semibold">{termYears} yrs</span>
            </div>
            {readOnly ? (
              <p className="text-sm font-medium">{termYears} years ({termMonths} months)</p>
            ) : (
              <Slider
                min={1}
                max={30}
                step={1}
                value={[termYears]}
                onValueChange={([v]) => {
                  setTermYears(v);
                  handleChange("termYears", v);
                }}
                className="w-full"
              />
            )}
          </div>
        </div>

        <Separator />

        {/* Summary metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Monthly Payment</p>
            <p className="text-lg font-bold text-green-700 dark:text-green-400">
              {fmtFull$(monthlyPayment)}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Financed Amount</p>
            <p className="text-base font-semibold">{fmt$(principal)}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Total Interest</p>
            <p className="text-base font-semibold text-amber-600 dark:text-amber-400">
              {fmt$(totalInterest)}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">LTV Ratio</p>
            <p className="text-base font-semibold">
              {ltv}%{" "}
              <Badge variant="outline" className="text-[10px] ml-0.5">
                {Number(ltv) <= 70 ? "Conservative" : Number(ltv) <= 85 ? "Standard" : "High"}
              </Badge>
            </p>
          </div>
        </div>

        {/* Amortization schedule preview */}
        {schedule.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Amortization Schedule
                </h4>
                <button
                  onClick={() => setShowFullSchedule(s => !s)}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  {showFullSchedule ? "Show Year 1 Only" : `Show All ${termMonths} Months`}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left pb-1 pr-2">Mo.</th>
                      <th className="text-right pb-1 pr-2">Payment</th>
                      <th className="text-right pb-1 pr-2">Principal</th>
                      <th className="text-right pb-1 pr-2">Interest</th>
                      <th className="text-right pb-1">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map(row => (
                      <tr key={row.month} className="border-b border-border/40 last:border-0">
                        <td className="py-0.5 pr-2 text-muted-foreground">{row.month}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums">{fmtFull$(row.payment)}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums text-green-700 dark:text-green-400">{fmtFull$(row.principal)}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums text-amber-600">{fmtFull$(row.interest)}</td>
                        <td className="py-0.5 text-right tabular-nums">{fmtFull$(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!showFullSchedule && schedule.length > 12 && (
                <p className="text-xs text-muted-foreground mt-1.5 text-center">
                  Showing months 1–12 of {schedule.length}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
