/**
 * /founder/studio → Credits tab.
 *
 * Per-action credit weight tuner. Each row in `shared/billing/credit-weights.ts`
 * maps to a `credits.weight.{action}` row in `founder_settings`. Editing a
 * weight here writes that key via setSetting() so the next deduction picks it
 * up without a redeploy.
 *
 * Auto-calibrate is wired to /credits/calibrate; the server currently returns
 * 422 until 30 days of credit_ledger data is available, and the UI surfaces
 * the message inline.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CreditRow {
  action: string;
  weight: number;
  defaultWeight: number;
  observedAvgCostCents: number | null;
  observedP90CostCents: number | null;
}

interface CreditsResponse {
  rows: CreditRow[];
}

export default function FounderStudioCredits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<CreditsResponse>({
    queryKey: ["/api/founder/studio/credits"],
  });

  const calibrate = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/founder/studio/credits/calibrate", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/credits"] });
      toast({ title: "Credits recalibrated" });
    },
    onError: (err: Error) => {
      toast({ title: "Calibration unavailable", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
            <span>Credit weights</span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  Auto-calibrate (last 30 days)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Recalibrate all credit weights?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Sets every action&apos;s weight to the 90th-percentile observed cost over the
                    last 30 days. This affects how every customer&apos;s pool is consumed on the
                    next action. Continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => calibrate.mutate()}>
                    Recalibrate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Current weight</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Default</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Avg observed (¢)</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <CreditWeightRow key={row.action} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CreditWeightRow({ row }: { row: CreditRow }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [weight, setWeight] = useState<number>(row.weight);
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/founder/studio/credits/${row.action}`, {
        weight,
        note: note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: `Updated ${row.action}` });
      setNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const isDirty = weight !== row.weight;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.action}</TableCell>
      <TableCell className="text-right font-mono">{row.weight}</TableCell>
      <TableCell className="text-right font-mono hidden sm:table-cell text-muted-foreground">
        {row.defaultWeight}
      </TableCell>
      <TableCell className="text-right font-mono hidden md:table-cell text-muted-foreground">
        {row.observedAvgCostCents === null ? "—" : row.observedAvgCostCents.toFixed(2)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Input
            type="number"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value) || 0)}
            className="w-20 h-8 font-mono text-right text-sm"
            min={0}
            step={0.01}
            aria-label={`${row.action} weight`}
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            className="w-24 sm:w-32 h-8 text-sm hidden md:block"
            aria-label={`${row.action} note`}
          />
          <Button
            size="sm"
            disabled={!isDirty || save.isPending}
            onClick={() => save.mutate()}
            className="h-8 gap-1"
            aria-label={`Save ${row.action} weight`}
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
