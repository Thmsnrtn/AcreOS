import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function fmtDollar(cents: number) {
  return `$${cents.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function DepreciationCalculatorPage() {
  const [costBasis, setCostBasis] = useState("");
  const [method, setMethod] = useState<DepMethod>("macrs_7yr");
  const [slYears, setSlYears] = useState("10");
  const [schedule, setSchedule] = useState<DepRow[] | null>(null);

  const handleCalculate = () => {
    const cost = parseFloat(costBasis);
    if (!cost || cost <= 0) return;
    setSchedule(calcSchedule(cost, method, parseInt(slYears)));
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-depreciation-calculator-title">
          Depreciation Calculator
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Calculate MACRS or straight-line depreciation schedules for improvements and equipment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calculate Schedule</CardTitle>
          <CardDescription>Enter asset cost and depreciation method.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Cost Basis ($)</Label>
              <Input
                type="number"
                placeholder="e.g. 50000"
                value={costBasis}
                onChange={e => setCostBasis(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={v => setMethod(v as DepMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="macrs_5yr">MACRS 5-Year</SelectItem>
                  <SelectItem value="macrs_7yr">MACRS 7-Year</SelectItem>
                  <SelectItem value="macrs_15yr">MACRS 15-Year</SelectItem>
                  <SelectItem value="straight_line">Straight-Line</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method === "straight_line" && (
              <div>
                <Label className="text-xs">Useful Life (years)</Label>
                <Input
                  type="number"
                  placeholder="10"
                  value={slYears}
                  onChange={e => setSlYears(e.target.value)}
                />
              </div>
            )}
          </div>
          <Button onClick={handleCalculate} disabled={!costBasis}>
            <Calculator className="w-4 h-4 mr-2" /> Calculate
          </Button>
        </CardContent>
      </Card>

      {schedule && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="w-4 h-4" /> Depreciation Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Year</TableHead>
                  <TableHead className="text-xs text-right">Deduction</TableHead>
                  <TableHead className="text-xs text-right">Accumulated</TableHead>
                  <TableHead className="text-xs text-right">Book Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.map(row => (
                  <TableRow key={row.year}>
                    <TableCell className="text-xs">{row.year}</TableCell>
                    <TableCell className="text-xs text-right">{fmtDollar(row.deduction)}</TableCell>
                    <TableCell className="text-xs text-right">{fmtDollar(row.accumulated)}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{fmtDollar(row.bookValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
