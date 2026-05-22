/**
 * /founder/studio → Infrastructure tab.
 *
 * Read-only dashboard of every infra dial the platform manages via the
 * revenue-trigger ladder. Manual override lives behind a confirmation
 * modal so the founder has to acknowledge they're breaking the ladder.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Loader2, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface InfraResponse {
  fly: { size: string; minMachines: number; autoStop: string; revenueManaged: boolean };
  postgres: { provider: string; revenueManaged: boolean };
  sentry: { sampleRate: number; quotaUsedPct: number | null; revenueManaged: boolean };
  stripeAch: { enabled: boolean; revenueManaged: boolean };
  readReplica: { categories: string[]; revenueManaged: boolean };
}

type OverrideKey =
  | "infra.override.fly.size"
  | "infra.override.fly.minMachines"
  | "infra.override.fly.autoStop"
  | "infra.override.sentry.sampleRate"
  | "infra.override.stripe.achEnabled"
  | "infra.override.readReplica.categories";

export default function FounderStudioInfra() {
  const { data, isLoading } = useQuery<InfraResponse>({
    queryKey: ["/api/founder/studio/infra"],
    refetchInterval: 60 * 1000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <InfraCard
        title="Fly app"
        managed={data.fly.revenueManaged}
        rows={[
          { label: "Machine size", value: data.fly.size },
          { label: "Min machines running", value: String(data.fly.minMachines) },
          { label: "Auto-stop strategy", value: data.fly.autoStop },
        ]}
        overrideKey="infra.override.fly.size"
        overrideLabel="Override Fly machine size"
        overrideHint="e.g. shared-cpu-2x, performance-1x"
        defaultValue={data.fly.size}
      />
      <InfraCard
        title="Postgres"
        managed={data.postgres.revenueManaged}
        rows={[{ label: "Provider", value: data.postgres.provider }]}
      />
      <InfraCard
        title="Sentry"
        managed={data.sentry.revenueManaged}
        rows={[
          { label: "Sample rate", value: data.sentry.sampleRate.toFixed(2) },
          {
            label: "Quota used",
            value: data.sentry.quotaUsedPct === null ? "—" : `${data.sentry.quotaUsedPct}%`,
          },
        ]}
        overrideKey="infra.override.sentry.sampleRate"
        overrideLabel="Override Sentry sample rate"
        overrideHint="0.0 — 1.0"
        defaultValue={String(data.sentry.sampleRate)}
        coerce="number"
      />
      <InfraCard
        title="Stripe ACH"
        managed={data.stripeAch.revenueManaged}
        rows={[{ label: "Enabled on yearly", value: data.stripeAch.enabled ? "yes" : "no" }]}
        overrideKey="infra.override.stripe.achEnabled"
        overrideLabel="Override Stripe ACH enabled"
        overrideHint="true / false"
        defaultValue={String(data.stripeAch.enabled)}
        coerce="boolean"
      />
      <InfraCard
        title="Read-replica adoption"
        managed={data.readReplica.revenueManaged}
        rows={
          data.readReplica.categories.length
            ? data.readReplica.categories.map((c) => ({ label: "Category", value: c }))
            : [{ label: "Routed categories", value: "none" }]
        }
      />
    </div>
  );
}

function InfraCard({
  title,
  managed,
  rows,
  overrideKey,
  overrideLabel,
  overrideHint,
  defaultValue,
  coerce,
}: {
  title: string;
  managed: boolean;
  rows: Array<{ label: string; value: string }>;
  overrideKey?: OverrideKey;
  overrideLabel?: string;
  overrideHint?: string;
  defaultValue?: string;
  coerce?: "number" | "boolean";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>{title}</span>
          {managed && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Lock className="w-3 h-3" aria-hidden="true" />
              auto
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-mono">{r.value}</dd>
            </div>
          ))}
        </dl>
        {overrideKey && (
          <OverrideForm
            settingKey={overrideKey}
            label={overrideLabel ?? "Manual override"}
            hint={overrideHint}
            defaultValue={defaultValue ?? ""}
            coerce={coerce}
          />
        )}
      </CardContent>
    </Card>
  );
}

function OverrideForm({
  settingKey,
  label,
  hint,
  defaultValue,
  coerce,
}: {
  settingKey: OverrideKey;
  label: string;
  hint?: string;
  defaultValue: string;
  coerce?: "number" | "boolean";
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      let parsedValue: unknown = value;
      if (coerce === "number") parsedValue = Number(value);
      else if (coerce === "boolean") parsedValue = value === "true";
      return apiRequest("POST", "/api/founder/studio/infra/override", {
        key: settingKey,
        value: parsedValue,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/infra"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: "Override applied" });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Override failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Manual override
      </summary>
      <div className="mt-2 space-y-2 pt-2 border-t">
        <Label htmlFor={`override-${settingKey}`} className="text-xs">
          {label}
          {hint && <span className="ml-2 text-muted-foreground">{hint}</span>}
        </Label>
        <div className="flex gap-2">
          <Input
            id={`override-${settingKey}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 font-mono text-sm"
            aria-label={label}
          />
          <AlertDialog open={open} onOpenChange={setOpen}>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 shrink-0"
              onClick={() => setOpen(true)}
            >
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              Apply
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Break the revenue ladder?</AlertDialogTitle>
                <AlertDialogDescription>
                  This breaks the revenue-triggered ladder for{" "}
                  <code className="font-mono text-xs">{settingKey}</code>. Future MRR milestones
                  will not auto-adjust this value. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    save.mutate();
                  }}
                  disabled={save.isPending}
                >
                  {save.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" aria-hidden="true" />
                  )}
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </details>
  );
}
