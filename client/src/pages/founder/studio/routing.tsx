/**
 * /founder/studio → Routing tab.
 *
 * Four sub-sections (mail / comms / data / ai) — each backed by its own
 * settings key. Saved independently so a typo in one section never blocks
 * the others. Drag-to-reorder is replaced with up/down arrows for
 * responsive parity (mobile lacks reliable drag handles).
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, ArrowUp, ArrowDown, Plus, X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
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

// ── Types ────────────────────────────────────────────────────────────────
interface MailRouting {
  providerPriority: string[];
  eddmStates: string[];
  holdAndBatchHours: number;
  coMarketingEnabled: boolean;
}
interface CommsRouting {
  smsPriority: string[];
  carrierOverrides: string;
  trackingPoolSize: number;
  byokWins: boolean;
}
interface DataRouting {
  cacheTtlDays: Record<string, number>;
  freeSourceFirst: boolean;
  fallbackOrder: string[];
}
interface AIRouting {
  modelFloor: Record<string, string>;
  cacheTtlHoursByComplexity: Record<string, number>;
  enforcePromptCache: boolean;
}

export default function FounderStudioRouting() {
  return (
    <Tabs defaultValue="mail">
      <TabsList className="flex-wrap h-auto bg-muted/40 p-1">
        <TabsTrigger value="mail">Mail</TabsTrigger>
        <TabsTrigger value="comms">Comms</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
      </TabsList>
      <TabsContent value="mail" className="mt-4">
        <MailSection />
      </TabsContent>
      <TabsContent value="comms" className="mt-4">
        <CommsSection />
      </TabsContent>
      <TabsContent value="data" className="mt-4">
        <DataSection />
      </TabsContent>
      <TabsContent value="ai" className="mt-4">
        <AISection />
      </TabsContent>
    </Tabs>
  );
}

// ── Reorderable list helper ─────────────────────────────────────────────
function ReorderableList({
  items,
  onChange,
  label,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, value: string) =>
    onChange(items.map((x, idx) => (idx === i ? value : x)));
  const add = () => onChange([...items, ""]);

  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <ol className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground w-5 text-right">
              {i + 1}.
            </span>
            <Input
              value={it}
              onChange={(e) => update(i, e.target.value)}
              className="h-8 font-mono text-sm"
              aria-label={`${label} item ${i + 1}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label="Move up"
            >
              <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              aria-label="Move down"
            >
              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => remove(i)}
              aria-label="Remove item"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1.5">
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Add
      </Button>
    </div>
  );
}

// ── Mail ────────────────────────────────────────────────────────────────
function MailSection() {
  return useRoutingSection<MailRouting>({
    suffix: "mail",
    label: "Mail routing",
    render: (draft, set) => (
      <div className="space-y-5">
        <ReorderableList
          items={draft.providerPriority}
          onChange={(v) => set({ providerPriority: v })}
          label="Provider priority (top wins)"
        />
        <div className="space-y-2">
          <Label className="text-sm">EDDM states</Label>
          <Input
            value={draft.eddmStates.join(", ")}
            onChange={(e) =>
              set({
                eddmStates: e.target.value
                  .split(/[,\s]+/)
                  .map((s) => s.trim().toUpperCase())
                  .filter(Boolean),
              })
            }
            className="font-mono"
            placeholder="TX, FL, AZ, ..."
            aria-label="EDDM states"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="holdBatch" className="text-sm">
            Hold-and-batch window (hours)
          </Label>
          <Input
            id="holdBatch"
            type="number"
            min={0}
            max={72}
            step={0.5}
            value={draft.holdAndBatchHours}
            onChange={(e) => set({ holdAndBatchHours: Number(e.target.value) || 0 })}
            className="w-32 font-mono"
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="coMarketing"
            checked={draft.coMarketingEnabled}
            onCheckedChange={(v) => set({ coMarketingEnabled: v })}
            aria-label="Co-marketing enabled"
          />
          <Label htmlFor="coMarketing" className="text-sm">
            Co-marketing pool enabled
          </Label>
        </div>
      </div>
    ),
  });
}

// ── Comms ───────────────────────────────────────────────────────────────
function CommsSection() {
  return useRoutingSection<CommsRouting>({
    suffix: "comms",
    label: "Comms routing",
    render: (draft, set) => (
      <div className="space-y-5">
        <ReorderableList
          items={draft.smsPriority}
          onChange={(v) => set({ smsPriority: v })}
          label="SMS provider priority"
        />
        <div className="space-y-2">
          <Label htmlFor="carrierOverrides" className="text-sm">
            Per-carrier coverage overrides
          </Label>
          <Textarea
            id="carrierOverrides"
            value={draft.carrierOverrides}
            onChange={(e) => set({ carrierOverrides: e.target.value })}
            rows={3}
            className="font-mono text-xs"
            placeholder="e.g. tmobile=telnyx, att=twilio"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm">
            Tracking pool size: <span className="font-mono">{draft.trackingPoolSize}</span>
          </Label>
          <Slider
            min={10}
            max={200}
            step={5}
            value={[draft.trackingPoolSize]}
            onValueChange={(v) => set({ trackingPoolSize: v[0] })}
            aria-label="Tracking pool size"
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="byokWins"
            checked={draft.byokWins}
            onCheckedChange={(v) => set({ byokWins: v })}
            aria-label="BYOK precedence"
          />
          <Label htmlFor="byokWins" className="text-sm">
            BYOK credentials win over platform defaults
          </Label>
        </div>
      </div>
    ),
  });
}

// ── Data ────────────────────────────────────────────────────────────────
function DataSection() {
  return useRoutingSection<DataRouting>({
    suffix: "data",
    label: "Data routing",
    render: (draft, set) => (
      <div className="space-y-5">
        <div className="space-y-2">
          <Label className="text-sm">Cache TTL per entity (days)</Label>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-right w-32">TTL (days)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(draft.cacheTtlDays).map(([entity, ttl]) => (
                  <TableRow key={entity}>
                    <TableCell className="font-mono text-xs">{entity}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={3650}
                        value={ttl}
                        onChange={(e) =>
                          set({
                            cacheTtlDays: {
                              ...draft.cacheTtlDays,
                              [entity]: Number(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-24 h-8 font-mono text-right"
                        aria-label={`${entity} cache TTL days`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="freeFirst"
            checked={draft.freeSourceFirst}
            onCheckedChange={(v) => set({ freeSourceFirst: v })}
            aria-label="Free source first"
          />
          <Label htmlFor="freeFirst" className="text-sm">
            Try free sources before paid lookups
          </Label>
        </div>
        <ReorderableList
          items={draft.fallbackOrder}
          onChange={(v) => set({ fallbackOrder: v })}
          label="Paid provider fallback order"
        />
      </div>
    ),
  });
}

// ── AI ──────────────────────────────────────────────────────────────────
function AISection() {
  return useRoutingSection<AIRouting>({
    suffix: "ai",
    label: "AI routing",
    render: (draft, set) => (
      <div className="space-y-5">
        <div className="space-y-2">
          <Label className="text-sm">Per-task model floor</Label>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(draft.modelFloor).map(([task, model]) => (
                  <TableRow key={task}>
                    <TableCell className="font-mono text-xs">{task}</TableCell>
                    <TableCell>
                      <Input
                        value={model}
                        onChange={(e) =>
                          set({
                            modelFloor: { ...draft.modelFloor, [task]: e.target.value },
                          })
                        }
                        className="h-8 font-mono text-xs"
                        aria-label={`${task} model floor`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Cache TTL per complexity (hours)</Label>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Complexity</TableHead>
                  <TableHead className="text-right w-32">TTL (hours)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(draft.cacheTtlHoursByComplexity).map(([level, ttl]) => (
                  <TableRow key={level}>
                    <TableCell className="font-mono text-xs">{level}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={8760}
                        value={ttl}
                        onChange={(e) =>
                          set({
                            cacheTtlHoursByComplexity: {
                              ...draft.cacheTtlHoursByComplexity,
                              [level]: Number(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-24 h-8 font-mono text-right"
                        aria-label={`${level} TTL hours`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="enforceCache"
            checked={draft.enforcePromptCache}
            onCheckedChange={(v) => set({ enforcePromptCache: v })}
            aria-label="Enforce prompt cache"
          />
          <Label htmlFor="enforceCache" className="text-sm">
            Block uncached system prompts on hot paths
          </Label>
        </div>
      </div>
    ),
  });
}

// ── Shared section hook ─────────────────────────────────────────────────
function useRoutingSection<T extends object>({
  suffix,
  label,
  render,
}: {
  suffix: "mail" | "comms" | "data" | "ai";
  label: string;
  render: (draft: T, set: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ routing: T }>({
    queryKey: [`/api/founder/studio/routing/${suffix}`],
  });
  const [draft, setDraft] = useState<T | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (data?.routing && draft === null) setDraft(data.routing);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft");
      return apiRequest("POST", `/api/founder/studio/routing/${suffix}`, {
        ...draft,
        note: note || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/founder/studio/routing/${suffix}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: `${label} saved` });
      setNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !draft) {
    return <Skeleton className="h-96 w-full" />;
  }

  const set = (patch: Partial<T>) => setDraft({ ...draft, ...patch });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {render(draft, set)}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between pt-2 border-t">
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
            Save {suffix}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
