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
  /**
   * When the operator is amortizing over a longer term than the
   * actual loan term (creating a balloon at maturity), pass the
   * scheduled balloon term in months. Triggers the §1026.18(s) /
   * (g) balloon-payment disclosure block. If undefined, the
   * calculator assumes a fully-amortizing note.
   */
  balloonAfterMonths?: number;
  onValuesChange?: (values: {
    purchasePrice: number;
    downPayment: number;
    interestRate: number;
    termMonths: number;
    monthlyPayment: number;
    balloonPaymentAmount?: number;
    balloonAfterMonths?: number;
  }) => void;
}

export default function SellerFinanceCalculator({
  initialPurchasePrice = 100000,
  initialDownPayment = 10000,
  initialRate = 8,
  initialTermYears = 10,
  readOnly = false,
  balloonAfterMonths,
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

  // ── Balloon detection ────────────────────────────────────────────────
  // Two paths produce a balloon: (a) the operator explicitly set
  // balloonAfterMonths shorter than the amortization term, OR (b) the
  // last row of the amortization schedule still has a nonzero balance
  // (floating-point edge cases) — we ignore the latter when the
  // computed final balance is within $1 of zero (fully-amortizing).
  const hasExplicitBalloon =
    balloonAfterMonths !== undefined && balloonAfterMonths < termMonths;
  const finalBalance = schedule[schedule.length - 1]?.balance ?? 0;
  const impliedBalloon = !hasExplicitBalloon && finalBalance > 1.0;
  const hasBalloon = hasExplicitBalloon || impliedBalloon;

  const balloonMonth = hasExplicitBalloon ? balloonAfterMonths! : termMonths;
  const balloonRow = hasExplicitBalloon
    ? schedule[Math.min(balloonMonth - 1, schedule.length - 1)]
    : schedule[schedule.length - 1];
  // Balloon payment = remaining balance at the balloon month + that
  // month's scheduled P&I. For an implied balloon (under-amortized
  // schedule), the final balance IS the balloon.
  const balloonPaymentAmount = hasBalloon
    ? hasExplicitBalloon
      ? (balloonRow?.balance ?? 0) + (balloonRow?.payment ?? 0)
      : finalBalance
    : 0;
  const balloonYearsFromOrigination = hasBalloon ? balloonMonth / 12 : 0;
  // Reg-Z's seller-finance natural-person exemption (12 CFR 1026.36(a)(4)(ii))
  // disqualifies any balloon under 60 months. HOEPA high-cost mortgages
  // (1026.32) prohibit balloons except for narrow bridge-loan carve-outs.
  // We flag the under-5-year case so the operator sees it before close.
  const balloonUnderFiveYears = hasBalloon && balloonMonth < 60;

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
      balloonPaymentAmount: hasBalloon ? balloonPaymentAmount : undefined,
      balloonAfterMonths: hasBalloon ? balloonMonth : undefined,
    });
  };

  const displayRows = showFullSchedule ? schedule : schedule.filter(r => r.month <= 12);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-acr-pos" />
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
          <div className="bg-acr-pos-soft dark:bg-acr-pos-soft/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Monthly Payment</p>
            <p className="text-lg font-bold text-acr-pos dark:text-acr-pos">
              {fmtFull$(monthlyPayment)}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Financed Amount</p>
            <p className="text-base font-semibold">{fmt$(principal)}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Total Interest</p>
            <p className="text-base font-semibold text-acr-warn dark:text-acr-warn">
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

        {/* ── Balloon-payment disclosure (Reg-Z §1026.18(s)/(g)) ───────── */}
        {hasBalloon && (
          <>
            <Separator />
            <div
              role="alert"
              aria-label="Balloon payment disclosure"
              data-testid="balloon-disclosure"
              className={
                balloonUnderFiveYears
                  ? "rounded-md border-2 border-acr-warn bg-acr-warn-soft/40 p-3 space-y-2"
                  : "rounded-md border border-acr-warn bg-acr-warn-soft/30 p-3 space-y-2"
              }
            >
              <div className="flex items-start gap-2">
                <span className="text-acr-warn font-bold text-base leading-tight" aria-hidden>
                  !
                </span>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">
                    This loan does NOT fully amortize — a balloon payment is due
                    in month {balloonMonth} ({balloonYearsFromOrigination.toFixed(1)} years).
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Scheduled monthly payments of {fmtFull$(monthlyPayment)} will
                    NOT pay this loan off. At month {balloonMonth} the borrower
                    owes a single lump-sum balloon payment of approximately{" "}
                    <span className="font-semibold text-foreground">
                      {fmtFull$(balloonPaymentAmount)}
                    </span>{" "}
                    — equal to the remaining principal balance plus that month's
                    scheduled interest.
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-semibold">Required disclosures:</span>{" "}
                    Reg-Z §1026.18(s) requires the balloon-payment amount,
                    payment number, and a "this is a balloon payment" statement
                    on the federal Truth-in-Lending Disclosure. The borrower
                    must receive this disclosure at application AND at closing.
                  </p>
                  {balloonUnderFiveYears && (
                    <p className="text-xs leading-relaxed text-acr-warn-foreground bg-acr-warn-soft/70 dark:bg-acr-warn-soft/40 rounded px-2 py-1.5 mt-1">
                      <span className="font-semibold">
                        Balloon under 5 years —{" "}
                      </span>
                      A balloon payment due in fewer than 60 months
                      disqualifies the federal seller-finance natural-person
                      exemption (12 CFR 1026.36(a)(4)(ii)) AND is prohibited on
                      HOEPA high-cost mortgages (12 CFR 1026.32(d)(1)). Confirm
                      with counsel before originating.
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground italic pt-1">
                    Informational only — not legal advice. Confirm specific
                    disclosure language and timing with licensed counsel.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

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
                  type="button"
                  onClick={() => setShowFullSchedule(s => !s)}
                  className="text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  aria-pressed={showFullSchedule}
                  aria-controls="amortization-schedule-table"
                >
                  {showFullSchedule ? "Show Year 1 Only" : `Show All ${termMonths} Months`}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table id="amortization-schedule-table" className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th scope="col" className="text-left pb-1 pr-2">Mo.</th>
                      <th scope="col" className="text-right pb-1 pr-2">Payment</th>
                      <th scope="col" className="text-right pb-1 pr-2">Principal</th>
                      <th scope="col" className="text-right pb-1 pr-2">Interest</th>
                      <th scope="col" className="text-right pb-1">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map(row => (
                      <tr key={row.month} className="border-b border-border/40 last:border-0">
                        <td className="py-0.5 pr-2 text-muted-foreground">{row.month}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums">{fmtFull$(row.payment)}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums text-acr-pos dark:text-acr-pos">{fmtFull$(row.principal)}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums text-acr-warn">{fmtFull$(row.interest)}</td>
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
