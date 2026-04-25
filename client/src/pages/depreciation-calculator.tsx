import { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Calculator, TrendingDown } from "lucide-react";

type DepMethod = "macrs_5yr" | "macrs_7yr" | "macrs_15yr" | "straight_line";

const MACRS: Record<string, number[]> = {
  macrs_5yr:  [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
  macrs_7yr:  [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  macrs_15yr: [5.00, 9.50, 8.55, 7.70, 6.93, 6.23, 5.90, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 2.95],
};

interface DepRow {
  year: number;
  deduction: number;
  accumulated: number;
  bookValue: number;
}

function calcSchedule(costBasis: number, method: DepMethod, slYears = 10): DepRow[] {
  const rows: DepRow[] = [];
  let accum = 0;

  if (method === "straight_line") {
    const annual = costBasis / slYears;
    for (let y = 1; y <= slYears; y++) {
      accum += annual;
      rows.push({ year: y, deduction: annual, accumulated: accum, bookValue: costBasis - accum });
    }
    return rows;
  }

  const table = MACRS[method] ?? [];
  for (let i = 0; i < table.length; i++) {
    const deduction = costBasis * (table[i] / 100);
    accum += deduction;
    rows.push({ year: i + 1, deduction, accumulated: accum, bookValue: Math.max(0, costBasis - accum) });
  }
  return rows;
}

export default function DepreciationCalculatorPage() {
  useDocumentTitle("Depreciation calculator");
  const { toast } = useToast();
  const [costBasis, setCostBasis] = useState("");
  const [method, setMethod] = useState<DepMethod>("macrs_7yr");
  const [slYears, setSlYears] = useState("10");
  const [schedule, setSchedule] = useState<DepRow[] | null>(null);
  const costBasisId = useId();
  const methodId = useId();
  const slYearsId = useId();

  const handleCalculate = () => {
    const cost = parseFloat(costBasis);
    if (!cost || cost <= 0) {
      toast({
        title: "Invalid cost basis",
        description: "Enter a positive dollar amount — your previous schedule (if any) is unchanged.",
        variant: "destructive",
      });
      return;
    }
    setSchedule(calcSchedule(cost, method, parseInt(slYears)));
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-depreciation-calculator-title">
          Depreciation calculator
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Calculate MACRS or straight-line depreciation schedules for improvements and equipment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calculate schedule</CardTitle>
          <CardDescription>Enter asset cost and depreciation method.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); handleCalculate(); }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor={costBasisId} className="text-xs">
                  Cost basis ($) <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id={costBasisId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 50000"
                  value={costBasis}
                  onChange={e => setCostBasis(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div>
                <Label htmlFor={methodId} className="text-xs">Method</Label>
                <Select value={method} onValueChange={v => setMethod(v as DepMethod)}>
                  <SelectTrigger id={methodId}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="macrs_5yr">MACRS 5-year — equipment, vehicles</SelectItem>
                    <SelectItem value="macrs_7yr">MACRS 7-year — office furniture, fixtures</SelectItem>
                    <SelectItem value="macrs_15yr">MACRS 15-year — land improvements (fences, paving)</SelectItem>
                    <SelectItem value="straight_line">Straight-line — equal deduction each year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {method === "straight_line" && (
                <div>
                  <Label htmlFor={slYearsId} className="text-xs">Useful life (years)</Label>
                  <Input
                    id={slYearsId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="10"
                    value={slYears}
                    onChange={e => setSlYears(e.target.value)}
                    className="tabular-nums"
                  />
                </div>
              )}
            </div>
            <Button type="submit" disabled={!costBasis} className="min-h-11">
              <Calculator className="w-4 h-4 mr-2" aria-hidden="true" /> Calculate
            </Button>
          </form>
        </CardContent>
      </Card>

      {schedule && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="w-4 h-4" aria-hidden="true" /> Depreciation schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div role="region" aria-label="Depreciation schedule" tabIndex={0} className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="text-xs">Year</TableHead>
                    <TableHead scope="col" className="text-xs text-right">Deduction</TableHead>
                    <TableHead scope="col" className="text-xs text-right">Accumulated</TableHead>
                    <TableHead scope="col" className="text-xs text-right">Book value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.map(row => (
                    <TableRow key={row.year}>
                      <TableCell className="text-xs tabular-nums">{row.year}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{usd(row.deduction)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{usd(row.accumulated)}</TableCell>
                      <TableCell className="text-xs text-right font-medium tabular-nums">{usd(row.bookValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
