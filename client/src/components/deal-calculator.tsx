import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Calculator, DollarSign, Percent, TrendingUp, Save, RotateCcw } from "lucide-react";
import type { Deal, Property } from "@shared/schema";

const calculatorSchema = z.object({
  purchasePrice: z.coerce.number().min(0, "Must be positive"),
  downPayment: z.coerce.number().min(0, "Must be positive"),
  interestRate: z.coerce.number().min(0).max(100, "Must be 0-100"),
  holdingCostsMonthly: z.coerce.number().min(0, "Must be positive"),
  holdingPeriodMonths: z.coerce.number().min(1, "Must be at least 1"),
  improvementCosts: z.coerce.number().min(0, "Must be positive"),
  expectedSalePrice: z.coerce.number().min(0, "Must be positive"),
});

type CalculatorFormData = z.infer<typeof calculatorSchema>;

interface AnalysisResults {
  purchasePrice: number;
  downPayment: number;
  financedAmount: number;
  interestRate: number;
  holdingCostsMonthly: number;
  holdingPeriodMonths: number;
  improvementCosts: number;
  expectedSalePrice: number;
  totalInvestment: number;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
  roiPercent: number;
  annualizedRoi: number;
  cashOnCashReturn: number;
  calculatedAt: string;
}

interface DealCalculatorProps {
  deal?: Deal;
  property?: Property;
  onSave?: (results: AnalysisResults) => void;
  isSaving?: boolean;
  showSaveButton?: boolean;
}

export function DealCalculator({ deal, property, onSave, isSaving, showSaveButton = true }: DealCalculatorProps) {
  const [results, setResults] = useState<AnalysisResults | null>(null);

  const defaultValues = useMemo(() => {
    if (deal?.analysisResults) {
      return {
        purchasePrice: deal.analysisResults.purchasePrice,
        downPayment: deal.analysisResults.downPayment,
        interestRate: deal.analysisResults.interestRate,
        holdingCostsMonthly: deal.analysisResults.holdingCostsMonthly,
        holdingPeriodMonths: deal.analysisResults.holdingPeriodMonths,
        improvementCosts: deal.analysisResults.improvementCosts,
        expectedSalePrice: deal.analysisResults.expectedSalePrice,
      };
    }
    
    const purchasePrice = deal?.acceptedAmount || deal?.offerAmount || property?.purchasePrice || 0;
    const expectedSalePrice = property?.listPrice || property?.marketValue || 0;
    
    return {
      purchasePrice: Number(purchasePrice) || 0,
      downPayment: Number(purchasePrice) || 0,
      interestRate: 0,
      holdingCostsMonthly: 50,
      holdingPeriodMonths: 6,
      improvementCosts: 0,
      expectedSalePrice: Number(expectedSalePrice) || 0,
    };
  }, [deal, property]);

  const form = useForm<CalculatorFormData>({
    resolver: zodResolver(calculatorSchema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const calculateResults = (data: CalculatorFormData): AnalysisResults => {
    const {
      purchasePrice,
      downPayment,
      interestRate,
      holdingCostsMonthly,
      holdingPeriodMonths,
      improvementCosts,
      expectedSalePrice,
    } = data;

    const financedAmount = Math.max(0, purchasePrice - downPayment);
    
    const monthlyRate = interestRate / 100 / 12;
    let totalInterest = 0;
    if (financedAmount > 0 && interestRate > 0) {
      totalInterest = financedAmount * monthlyRate * holdingPeriodMonths;
    }

    const totalHoldingCosts = holdingCostsMonthly * holdingPeriodMonths;
    const totalInvestment = downPayment + totalHoldingCosts + improvementCosts;
    const totalCost = purchasePrice + totalInterest + totalHoldingCosts + improvementCosts;
    const sellingCosts = expectedSalePrice * 0.10;
    const grossProfit = expectedSalePrice - totalCost;
    const netProfit = expectedSalePrice - totalCost - sellingCosts;
    const roiPercent = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;
    const years = holdingPeriodMonths / 12;
    const annualizedRoi = years > 0 ? roiPercent / years : 0;
    const cashOnCashReturn = downPayment > 0 ? (netProfit / downPayment) * 100 : 0;

    return {
      purchasePrice,
      downPayment,
      financedAmount,
      interestRate,
      holdingCostsMonthly,
      holdingPeriodMonths,
      improvementCosts,
      expectedSalePrice,
      totalInvestment,
      totalCost,
      grossProfit,
      netProfit,
      roiPercent,
      annualizedRoi,
      cashOnCashReturn,
      calculatedAt: new Date().toISOString(),
    };
  };

  const onSubmit = (data: CalculatorFormData) => {
    const calculatedResults = calculateResults(data);
    setResults(calculatedResults);
  };

  const handleReset = () => {
    form.reset(defaultValues);
    setResults(null);
  };

  const handleSave = () => {
    if (results && onSave) {
      onSave(results);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  return (
    <div className="space-y-6">
      <Card className="glass-panel">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Deal Analysis Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Price</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            placeholder="0" 
                            className="pl-9" 
                            data-testid="input-purchase-price"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="downPayment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Down Payment / Cash Investment</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            placeholder="0" 
                            className="pl-9" 
                            data-testid="input-down-payment"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="interestRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Interest Rate (Annual %)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            step="0.1"
                            placeholder="0" 
                            className="pl-9" 
                            data-testid="input-interest-rate"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="holdingCostsMonthly"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Holding Costs</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            placeholder="0" 
                            className="pl-9" 
                            data-testid="input-holding-costs"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="holdingPeriodMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Holding Period (Months)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="6" 
                          data-testid="input-holding-period"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="improvementCosts"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Improvement Costs (Optional)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            placeholder="0" 
                            className="pl-9" 
                            data-testid="input-improvement-costs"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expectedSalePrice"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Expected Sale Price</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            placeholder="0" 
                            className="pl-9" 
                            data-testid="input-expected-sale-price"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" data-testid="button-calculate">
                  <Calculator className="w-4 h-4 mr-2" />
                  Calculate
                </Button>
                <Button type="button" variant="outline" onClick={handleReset} data-testid="button-reset">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {results && (
        <Card className="glass-panel">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Analysis Results
              </CardTitle>
              {showSaveButton && onSave && (
                <Button 
                  onClick={handleSave} 
                  disabled={isSaving}
                  data-testid="button-save-analysis"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Analysis"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <ResultCard
                label="Total Investment"
                value={formatCurrency(results.totalInvestment)}
                description="Down payment + holding costs + improvements"
                testId="result-total-investment"
              />
              <ResultCard
                label="Total Cost"
                value={formatCurrency(results.totalCost)}
                description="All-in cost including interest"
                testId="result-total-cost"
              />
              <ResultCard
                label="Gross Profit"
                value={formatCurrency(results.grossProfit)}
                variant={results.grossProfit >= 0 ? "positive" : "negative"}
                description="Sale price minus total cost"
                testId="result-gross-profit"
              />
              <ResultCard
                label="Net Profit"
                value={formatCurrency(results.netProfit)}
                variant={results.netProfit >= 0 ? "positive" : "negative"}
                description="After 10% selling costs"
                testId="result-net-profit"
              />
              <ResultCard
                label="ROI"
                value={formatPercent(results.roiPercent)}
                variant={results.roiPercent >= 0 ? "positive" : "negative"}
                description="Return on total investment"
                testId="result-roi"
              />
              <ResultCard
                label="Annualized ROI"
                value={formatPercent(results.annualizedRoi)}
                variant={results.annualizedRoi >= 0 ? "positive" : "negative"}
                description="ROI adjusted for time"
                testId="result-annualized-roi"
              />
              <ResultCard
                label="Cash-on-Cash Return"
                value={formatPercent(results.cashOnCashReturn)}
                variant={results.cashOnCashReturn >= 0 ? "positive" : "negative"}
                description="Net profit / down payment"
                testId="result-cash-on-cash"
              />
              {results.financedAmount > 0 && (
                <ResultCard
                  label="Financed Amount"
                  value={formatCurrency(results.financedAmount)}
                  description={`At ${results.interestRate}% annual interest`}
                  testId="result-financed-amount"
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface ResultCardProps {
  label: string;
  value: string;
  description?: string;
  variant?: "default" | "positive" | "negative";
  testId?: string;
}

function ResultCard({ label, value, description, variant = "default", testId }: ResultCardProps) {
  const valueColor = {
    default: "text-foreground",
    positive: "text-green-600 dark:text-green-400",
    negative: "text-red-600 dark:text-red-400",
  }[variant];

  return (
    <div className="p-4 rounded-lg bg-muted/50 space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold font-mono ${valueColor}`} data-testid={testId}>
        {value}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export type { AnalysisResults };
