/**
 * /founder/studio — every dial in one place.
 *
 * Generic renderer over `founder_settings`. New keys added to
 * server/services/settingsSeeder.ts auto-appear here with a sensible
 * editor chosen from the `validRange.type` field (number → input, enum
 * → select, boolean → switch, array/object → JSON editor, fallthrough →
 * text input). No per-key UI code.
 *
 * Responsive parity: single-column dial cards on phone; two-column grid
 * on desktop. Tabs at the top for category. Save and reset per dial.
 *
 * Once a dial is edited, the new value takes effect on the next agent
 * decision that calls `getSetting()` — no restart, no deploy.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Save,
  RotateCcw,
  Sliders,
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Dial {
  id: number;
  key: string;
  scope: string;
  scopeRef: string | null;
  value: unknown;
  defaultValue: unknown;
  validRange: {
    type?: "number" | "string" | "array" | "object" | "boolean" | "enum";
    min?: number;
    max?: number;
    oneOf?: unknown[];
  } | null;
  category: string;
  description: string;
  lastChangedBy: string | null;
  lastChangedAt: string | null;
  lastChangedNote: string | null;
}

interface DialsResponse {
  categories: Array<{ category: string; dials: Dial[] }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  autonomy: "Autonomy",
  cost: "Cost",
  lifecycle: "Lifecycle",
  safety: "Safety",
  voice: "Voice",
  compliance: "Compliance",
};

export default function FounderStudioPage() {
  useDocumentTitle("Studio — Founder");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DialsResponse>({
    queryKey: ["/api/founder/studio/dials"],
    refetchInterval: 60 * 1000,
  });

  const [activeTab, setActiveTab] = useState<string>("autonomy");

  const tabs = useMemo(() => {
    if (!data) return [];
    return data.categories.map((c) => ({
      key: c.category,
      label: CATEGORY_LABELS[c.category] ?? c.category,
      count: c.dials.length,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <PageShell label="Studio">
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageShell>
    );
  }

  if (!data || data.categories.length === 0) {
    return (
      <PageShell label="Studio">
        <div className="text-center py-16 space-y-3">
          <Sliders className="w-12 h-12 mx-auto text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            No dials registered. The settings seeder should run on boot — check server logs for
            <code className="font-mono text-xs ml-1 px-1 py-0.5 rounded bg-muted">[settings]</code>.
          </p>
        </div>
      </PageShell>
    );
  }

  const activeCategoryDials =
    data.categories.find((c) => c.category === activeTab)?.dials ??
    data.categories[0]?.dials ?? [];
  const resolvedTab = data.categories.find((c) => c.category === activeTab) ? activeTab : data.categories[0]?.category;

  return (
    <PageShell label="Studio">
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Studio</h1>
          <p className="text-sm text-muted-foreground">
            Every dial that controls how the platform runs. Changes take effect on the next
            agent decision without a restart.
          </p>
        </header>

        <Tabs value={resolvedTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                <span>{t.label}</span>
                <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">
                  {t.count}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {data.categories.map((c) => (
            <TabsContent key={c.category} value={c.category} className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {c.dials.map((dial) => (
                  <DialCard
                    key={dial.id}
                    dial={dial}
                    onSaved={() =>
                      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] })
                    }
                    toast={toast}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </PageShell>
  );
}

function DialCard({
  dial,
  onSaved,
  toast,
}: {
  dial: Dial;
  onSaved: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const queryClient = useQueryClient();
  const [pendingValue, setPendingValue] = useState<unknown>(dial.value);
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async (args: { value: unknown; note: string }) =>
      apiRequest("PATCH", "/api/founder/studio/dial", {
        key: dial.key,
        value: args.value,
        note: args.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: "Saved", description: dial.key });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const reset = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/founder/studio/dial/reset", {
        key: dial.key,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: "Reset to default", description: dial.key });
      setPendingValue(dial.defaultValue);
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  const isDirty = JSON.stringify(pendingValue) !== JSON.stringify(dial.value);
  const isDefault = JSON.stringify(dial.value) === JSON.stringify(dial.defaultValue);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <code className="font-mono text-xs text-muted-foreground break-all">{dial.key}</code>
            {!isDefault && (
              <Badge variant="outline" className="shrink-0 text-xs">
                customized
              </Badge>
            )}
          </div>
          <p className="text-sm leading-snug">{dial.description}</p>
        </div>

        <DialEditor dial={dial} value={pendingValue} onChange={setPendingValue} />

        <div className="space-y-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — why are you changing this?"
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <div className="text-xs text-muted-foreground">
              {dial.lastChangedAt
                ? `Last changed ${new Date(dial.lastChangedAt).toLocaleString()} by ${dial.lastChangedBy ?? "founder"}`
                : `Default value — never edited`}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isDefault || reset.isPending}
                onClick={() => reset.mutate()}
                className="gap-1.5"
              >
                {reset.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                Reset
              </Button>
              <Button
                size="sm"
                disabled={!isDirty || save.isPending}
                onClick={() => save.mutate({ value: pendingValue, note })}
                className="gap-1.5"
              >
                {save.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : isDirty ? (
                  <Save className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {isDirty ? "Save" : "Saved"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DialEditor({
  dial,
  value,
  onChange,
}: {
  dial: Dial;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const type = inferType(dial);

  if (type === "number") {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        min={dial.validRange?.min}
        max={dial.validRange?.max}
        step={dial.validRange?.max && dial.validRange.max <= 1 ? 0.05 : 1}
        className="font-mono"
      />
    );
  }

  if (type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
        <span className="text-sm font-mono">{value ? "true" : "false"}</span>
      </div>
    );
  }

  if (type === "enum" && dial.validRange?.oneOf) {
    return (
      <Select value={String(value)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {dial.validRange.oneOf.map((opt) => (
            <SelectItem key={String(opt)} value={String(opt)} className="font-mono">
              {String(opt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === "string") {
    return (
      <Input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
    );
  }

  // array, object, or unknown → JSON editor
  return (
    <JsonEditor value={value} onChange={onChange} />
  );
}

function JsonEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      setError(null);
      onChange(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="space-y-1">
      <Textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={Math.min(10, text.split("\n").length + 1)}
        className="font-mono text-xs"
      />
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function inferType(dial: Dial): "number" | "boolean" | "string" | "enum" | "json" {
  if (dial.validRange?.type === "number") return "number";
  if (dial.validRange?.type === "boolean") return "boolean";
  if (dial.validRange?.type === "string") return "string";
  if (dial.validRange?.type === "enum") return "enum";
  if (dial.validRange?.type === "array" || dial.validRange?.type === "object") return "json";

  // Fallback: infer from current value
  const v = dial.value ?? dial.defaultValue;
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") {
    return dial.validRange?.oneOf ? "enum" : "string";
  }
  return "json";
}
