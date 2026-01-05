import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DollarSign, Calculator, Percent, Clock, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PropertyListing } from "@shared/schema";

interface PaymentCalculatorProps {
  listingPrice: number;
  sellerFinancingAvailable?: boolean;
  defaultDownPaymentPercent?: number;
  defaultInterestRate?: number;
  defaultTermMonths?: number;
  onApply?: () => void;
  listing?: PropertyListing;
}

const TERM_OPTIONS = [12, 24, 36, 48, 60, 84, 120];

function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRate <= 0) return principal / termMonths;
  
  const monthlyRate = annualRate / 100 / 12;
  const payment = principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1);
  return payment;
}

export function PaymentCalculator({
  listingPrice,
  sellerFinancingAvailable = true,
  defaultDownPaymentPercent = 10,
  defaultInterestRate = 9.9,
  defaultTermMonths = 60,
  onApply,
  listing,
}: PaymentCalculatorProps) {
  const [downPaymentPercent, setDownPaymentPercent] = useState(defaultDownPaymentPercent);
  const [interestRate, setInterestRate] = useState(defaultInterestRate);
  const [termMonths, setTermMonths] = useState(defaultTermMonths);

  const calculations = useMemo(() => {
    const downPaymentAmount = (listingPrice * downPaymentPercent) / 100;
    const financedAmount = listingPrice - downPaymentAmount;
    const monthlyPayment = calculateMonthlyPayment(financedAmount, interestRate, termMonths);
    const totalPayment = downPaymentAmount + (monthlyPayment * termMonths);
    const totalInterest = totalPayment - listingPrice;

    return {
      downPaymentAmount,
      financedAmount,
      monthlyPayment,
      totalPayment,
      totalInterest,
    };
  }, [listingPrice, downPaymentPercent, interestRate, termMonths]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (!sellerFinancingAvailable) {
    return (
      <Card data-testid="card-payment-calculator">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Payment Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <p>Seller financing is not available for this property.</p>
            <p className="mt-2">Cash purchase only: {formatCurrency(listingPrice)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-payment-calculator">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Payment Calculator
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            Owner Financing Available
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center p-4 bg-muted/50 rounded-md">
          <p className="text-sm text-muted-foreground">Property Price</p>
          <p className="text-2xl font-bold" data-testid="text-listing-price">
            {formatCurrency(listingPrice)}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4" />
                Down Payment
              </Label>
              <span className="text-sm font-medium" data-testid="text-down-payment-display">
                {downPaymentPercent}% ({formatCurrency(calculations.downPaymentAmount)})
              </span>
            </div>
            <Slider
              data-testid="slider-down-payment"
              value={[downPaymentPercent]}
              onValueChange={(value) => setDownPaymentPercent(value[0])}
              min={5}
              max={50}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>5%</span>
              <span>50%</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="flex items-center gap-1.5">
                <Percent className="h-4 w-4" />
                Interest Rate
              </Label>
              <span className="text-sm font-medium" data-testid="text-interest-rate-display">
                {interestRate.toFixed(1)}% APR
              </span>
            </div>
            <Slider
              data-testid="slider-interest-rate"
              value={[interestRate]}
              onValueChange={(value) => setInterestRate(value[0])}
              min={0}
              max={15}
              step={0.1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span>15%</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Loan Term
              </Label>
              <span className="text-sm font-medium" data-testid="text-term-display">
                {termMonths} months ({(termMonths / 12).toFixed(1)} years)
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TERM_OPTIONS.map((term) => (
                <Button
                  key={term}
                  data-testid={`button-term-${term}`}
                  variant={termMonths === term ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTermMonths(term)}
                  className="flex-1 min-w-[60px]"
                >
                  {term}mo
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">Down Payment:</span>
            <span className="font-medium" data-testid="text-calc-down-payment">
              {formatCurrency(calculations.downPaymentAmount)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">Financed Amount:</span>
            <span className="font-medium" data-testid="text-calc-financed-amount">
              {formatCurrency(calculations.financedAmount)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap text-lg border-t pt-3">
            <span className="font-semibold flex items-center gap-1.5">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Monthly Payment:
            </span>
            <span className="font-bold text-green-600" data-testid="text-calc-monthly-payment">
              {formatCurrency(calculations.monthlyPayment)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">Total Payment:</span>
            <span className="font-medium" data-testid="text-calc-total-payment">
              {formatCurrency(calculations.totalPayment)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">Total Interest:</span>
            <span className="font-medium" data-testid="text-calc-total-interest">
              {formatCurrency(calculations.totalInterest)}
            </span>
          </div>
        </div>

        <Button
          data-testid="button-apply-property"
          className="w-full"
          size="lg"
          onClick={onApply}
        >
          Apply for This Property
        </Button>
      </CardContent>
    </Card>
  );
}
