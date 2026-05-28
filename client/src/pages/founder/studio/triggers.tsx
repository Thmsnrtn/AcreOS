/**
 * /founder/studio → Triggers tab.
 *
 * Edits the `revenue.triggers` setting — a JSON array of MRR thresholds
 * with one-time/recurring costs, status, and auto-approve flags. Saving
 * replaces the entire ladder atomically.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Plus, Trash2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface TriggerRow {
  mrr: number;
  action: string;
  oneTimeCost: number;
  recurringCost: number;
  status: "pending" | "active" | "skipped" | "manual";
  autoApprove: boolean;
}

interface TriggersResponse {
  rows: TriggerRow[];
  currentMrr: number | null;
  thresholdsCrossed: number | null;
}

const STATUSES: TriggerRow["status"][] = ["pending", "active", "skipped", "manual"];

export default function FounderStudioTriggers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<TriggersResponse>({
    queryKey: ["/api/founder/studio/triggers"],
  });

  const [draft, setDraft] = useState<TriggerRow[] | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (data?.rows && draft === null) setDraft(data.rows);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft");
      return apiRequest("POST", "/api/founder/studio/triggers", {
        rows: draft,
        note: note || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/triggers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: "Trigger ladder saved" });
      setNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !draft || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const updateRow = (i: number, patch: Partial<TriggerRow>) => {
    setDraft(draft.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const addRow = () =>
    setDraft([
      ...draft,
      {
        mrr: 0,
        action: "New trigger",
        oneTimeCost: 0,
        recurringCost: 0,
        status: "pending",
        autoApprove: false,
      },
    ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
            <span>Revenue trigger ladder</span>
            <div className="flex items-center gap-2">
              {data.currentMrr !== null && (
                <Badge variant="secondary" className="font-mono">
                  MRR ${data.currentMrr.toLocaleString()}
                </Badge>
              )}
              {data.thresholdsCrossed !== null && (
                <Badge variant="outline" className="font-mono">
                  {data.thresholdsCrossed} crossed
                </Badge>
              )}
            </div>
          </CardTitle>
          {data.currentMrr === null && (
            <p className="text-xs text-muted-foreground">
              MRR not yet wired — connect Stripe to populate <code>revenue.mrr.current</code>.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">MRR ($)</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="w-24 text-right">One-time</TableHead>
                  <TableHead className="w-24 text-right">Recurring</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-16">Auto</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input
                        type="number"
                        value={row.mrr}
                        onChange={(e) => updateRow(i, { mrr: Number(e.target.value) || 0 })}
                        className="w-20 h-8 font-mono text-right"
                        min={0}
                        aria-label={`Row ${i + 1} MRR threshold`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.action}
                        onChange={(e) => updateRow(i, { action: e.target.value })}
                        className="h-8 min-w-[12rem]"
                        aria-label={`Row ${i + 1} action`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={row.oneTimeCost}
                        onChange={(e) =>
                          updateRow(i, { oneTimeCost: Number(e.target.value) || 0 })
                        }
                        className="w-20 h-8 font-mono text-right"
                        min={0}
                        aria-label={`Row ${i + 1} one-time cost`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={row.recurringCost}
                        onChange={(e) =>
                          updateRow(i, { recurringCost: Number(e.target.value) || 0 })
                        }
                        className="w-20 h-8 font-mono text-right"
                        min={0}
                        aria-label={`Row ${i + 1} recurring cost`}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.status}
                        onValueChange={(v) => updateRow(i, { status: v as TriggerRow["status"] })}
                      >
                        <SelectTrigger className="h-8" aria-label={`Row ${i + 1} status`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.autoApprove}
                        onCheckedChange={(checked) => updateRow(i, { autoApprove: checked })}
                        aria-label={`Row ${i + 1} auto-approve`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(i)}
                        className="h-8 w-8 p-0"
                        aria-label={`Delete row ${i + 1}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="p-3 border-t">
            <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add threshold
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — why are you changing this?"
          className="text-sm"
          aria-label="Change note"
        />
        <Button
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="gap-1.5 shrink-0"
        >
          {save.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          Save ladder
        </Button>
      </div>
    </div>
  );
}
