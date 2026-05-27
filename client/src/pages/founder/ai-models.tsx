/**
 * /founder/ai-models — AI Model Configuration (extracted from
 * founder-dashboard.tsx).
 *
 * Pure move; no behavior change. Preserves /api/admin/ai-models query key
 * + PUT mutation paths. Optimistic toggle + weight edit are preserved
 * exactly — switch / weight inputs reflect instantly on cellular.
 */

import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";

export function AIModelsSection() {
  const { data: models = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/ai-models"],
  });

  // Optimistic toggle + weight edit on AI-model rows — the switch / weight
  // input should reflect instantly even on cellular. Errors roll back to
  // the prior cached row and surface a destructive toast.
  const toggleMutation = useOptimisticUpdate<{ id: number; enabled: boolean }>({
    mutationFn: async ({ id, enabled }) =>
      apiRequest("PUT", `/api/admin/ai-models/${id}`, { enabled }),
    listKeys: [["/api/admin/ai-models"]],
    getId: ({ id }) => id,
    buildPatch: ({ enabled }) => ({ enabled }),
    successToast: false,
  });

  const updateWeightMutation = useOptimisticUpdate<{ id: number; weight: number }>({
    mutationFn: async ({ id, weight }) =>
      apiRequest("PUT", `/api/admin/ai-models/${id}`, { weight }),
    listKeys: [["/api/admin/ai-models"]],
    getId: ({ id }) => id,
    buildPatch: ({ weight }) => ({ weight }),
    successToast: false,
  });

  return (
    <div id="section-config" className="mt-8 p-6 border rounded-xl bg-card space-y-4 scroll-mt-16" data-testid="section-ai-models">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          AI Model Configuration
        </h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          All models route through OpenRouter. Adjust weights to control model selection by complexity tier.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-24 rounded-card bg-muted/50" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th scope="col" className="text-left py-2 pr-4 font-medium">Model</th>
                <th scope="col" className="text-right py-2 pr-4 font-medium">Input $/M</th>
                <th scope="col" className="text-right py-2 pr-4 font-medium">Output $/M</th>
                <th scope="col" className="text-right py-2 pr-4 font-medium">Weight</th>
                <th scope="col" className="text-center py-2 pr-4 font-medium">Enabled</th>
                <th scope="col" className="text-left py-2 font-medium">Task Types</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m: any) => (
                <tr key={m.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{m.displayName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{m.modelId}</div>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">
                    ${parseFloat(m.costPerMillionInput || "0").toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-xs">
                    ${parseFloat(m.costPerMillionOutput || "0").toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={m.weight ?? 50}
                      onBlur={(e) => updateWeightMutation.mutate({ id: m.id, weight: parseInt(e.target.value) })}
                      className="w-14 text-right border rounded px-1 py-0.5 text-xs bg-background"
                      aria-label={`Weight for ${m.displayName}`}
                    />
                  </td>
                  <td className="py-2 pr-4 text-center">
                    <Switch
                      checked={m.enabled}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: m.id, enabled: v })}
                      aria-label={`Enable ${m.displayName}`}
                    />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground max-w-xs">
                    <div className="flex flex-wrap gap-1">
                      {(m.taskTypes || []).slice(0, 4).map((t: string) => (
                        <Badge key={t} variant="secondary" className="text-xs px-1 py-0">{t}</Badge>
                      ))}
                      {(m.taskTypes || []).length > 4 && (
                        <Badge variant="outline" className="text-xs px-1 py-0">+{(m.taskTypes || []).length - 4}</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FounderAiModelsPage() {
  useDocumentTitle("AI models — AcreOS");

  return (
    <PageShell label="AI models">
      <div className="mb-6 flex items-start gap-3">
        <Bot className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI model configuration</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            All models route through OpenRouter. Adjust weights to control
            model selection by complexity tier. Toggle + weight updates apply
            optimistically.
          </p>
        </div>
      </div>

      <AIModelsSection />
    </PageShell>
  );
}
