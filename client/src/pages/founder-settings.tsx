/**
 * FounderSettingsPage — the customization center.
 *
 * One card per tunable knob. Edit inline, press Save, the value
 * takes effect on the next decision the system processes (no
 * redeploy, no server restart). The source of each value is shown
 * explicitly: 'founder' (you set it), 'env' (legacy env var),
 * 'default' (hardcoded fallback).
 *
 * Safety knobs live here, not thresholds affecting UI chrome. The
 * mental model is: "these are the knobs that change how the system
 * behaves when you're not watching."
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Shield, Brain, Clock, Settings, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

interface SettingRow {
  key: string;
  value: string;
  source: "founder" | "env" | "default";
  definition: {
    key: string;
    valueType: "string" | "number" | "boolean" | "json";
    defaultValue: string;
    description: string;
    category: "safety" | "learning" | "scheduling" | "general";
    min?: number;
    max?: number;
    units?: string;
  };
}

const CATEGORY_META: Record<
  SettingRow["definition"]["category"],
  { label: string; icon: any; colorClass: string }
> = {
  safety: { label: "Safety rails", icon: Shield, colorClass: "text-red-600 dark:text-red-400" },
  learning: { label: "Learning & thresholds", icon: Brain, colorClass: "text-amber-600 dark:text-amber-400" },
  scheduling: { label: "Scheduling", icon: Clock, colorClass: "text-blue-600 dark:text-blue-400" },
  general: { label: "General", icon: Settings, colorClass: "text-muted-foreground" },
};

export default function FounderSettingsPage() {
  const { data, isLoading, isError } = useQuery<{ settings: SettingRow[] }>({
    queryKey: ["/api/founder/intelligence/settings"],
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();

  const byCategory = new Map<string, SettingRow[]>();
  for (const s of data?.settings ?? []) {
    const bucket = byCategory.get(s.definition.category) ?? [];
    bucket.push(s);
    byCategory.set(s.definition.category, bucket);
  }

  return (
    <PageShell label="Founder Settings">
      <div className="space-y-6 max-w-4xl mx-auto">
        <PageHeader
          title="Customization center"
          icon={<Settings className="h-5 w-5 text-muted-foreground" />}
          description="Operational knobs the system reads on every decision. Changes take effect on the next decision — no restart, no deploy. Values you set here override environment variables."
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-8 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600 dark:text-red-400">
              Could not load settings. Retry in a moment.
            </CardContent>
          </Card>
        ) : (
          [...byCategory.entries()].map(([category, rows]) => {
            const meta = CATEGORY_META[category as keyof typeof CATEGORY_META] ?? CATEGORY_META.general;
            return (
              <Card key={category}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <meta.icon className={`h-4 w-4 ${meta.colorClass}`} />
                    {meta.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {rows.map((row) => (
                    <SettingRowEditor
                      key={row.key}
                      row={row}
                      onSave={async (val) => {
                        try {
                          const res = await apiRequest("POST", `/api/founder/intelligence/settings/${row.key}`, { value: val });
                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.error ?? "save failed");
                          }
                          qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/settings"] });
                          toast({ title: "Saved", description: `${row.key} updated.` });
                        } catch (e: any) {
                          toast({ title: "Save failed", description: e.message, variant: "destructive" });
                        }
                      }}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </PageShell>
  );
}

function SettingRowEditor({
  row,
  onSave,
}: {
  row: SettingRow;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(row.value);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== row.value;

  const displayValue = row.definition.valueType === "number"
    ? row.definition.units === "cents"
      ? `$${(Number(row.value) / 100).toLocaleString()}`
      : `${Number(row.value).toLocaleString()}${row.definition.units ? ` ${row.definition.units}` : ""}`
    : row.value;

  const sourceLabel =
    row.source === "founder" ? "you set this" : row.source === "env" ? "from env var" : "system default";

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-xs font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {row.key}
            </code>
            <Badge variant="secondary" className="text-[10px]">
              {sourceLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{row.definition.description}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Current:</span>
            <span className="text-sm font-medium text-foreground">{displayValue}</span>
          </div>
        </div>
      </div>
      <div className="flex items-end gap-2 mt-3">
        <div className="flex-1 min-w-[160px]">
          <Input
            type={row.definition.valueType === "number" ? "number" : "text"}
            value={draft}
            min={row.definition.min}
            max={row.definition.max}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`New value for ${row.key}`}
            data-testid={`input-${row.key}`}
          />
        </div>
        <Button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            await onSave(draft);
            setSaving(false);
          }}
          size="sm"
          data-testid={`save-${row.key}`}
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
