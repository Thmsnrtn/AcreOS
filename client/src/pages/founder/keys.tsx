/**
 * /founder/keys — System API keys (extracted from founder-dashboard.tsx).
 *
 * Per docs/archive/exhaustive-completion/founder-dashboard-extraction-queue.md
 * Extraction #1. Pure move; no behavior change. Preserves the existing
 * /api/admin/system-api-keys query key + mutation paths.
 *
 * Founders touch this monthly to rotate keys; the in-dashboard card stays
 * as a link for discoverability.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Key, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const COMMON_PROVIDERS = [
  { provider: "openai", displayName: "OpenAI", description: "GPT models for AI features" },
  { provider: "openrouter", displayName: "OpenRouter", description: "Multi-model routing (recommended)" },
  { provider: "anthropic", displayName: "Anthropic", description: "Claude models" },
  { provider: "stripe", displayName: "Stripe", description: "Payment processing" },
  { provider: "sendgrid", displayName: "SendGrid", description: "Email delivery" },
  { provider: "twilio", displayName: "Twilio", description: "SMS & voice" },
  { provider: "lob", displayName: "Lob", description: "Direct mail campaigns" },
  { provider: "regrid", displayName: "Regrid", description: "Parcel & property data" },
  { provider: "mapbox", displayName: "Mapbox", description: "Maps & geocoding" },
];

export function KeysContent() {
  useDocumentTitle("System API keys — AcreOS");

  const { data: keys = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ["/api/admin/system-api-keys"],
  });
  const { toast } = useToast();
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  // allow-no-invalidation: onSuccess calls refetch() — refetch-based, not key-based
  const updateMutation = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      apiRequest("PUT", `/api/admin/system-api-keys/${provider}`, { apiKey }),
    onSuccess: () => {
      refetch();
      setEditProvider(null);
      setNewKey("");
      toast({ title: "API key saved" });
    },
    onError: () => toast({ title: "Couldn't save API key", description: "The previous key is still in use.", variant: "destructive" }),
  });

  const existingProviders = new Set((keys as any[]).map((k: any) => k.provider));
  const missingProviders = COMMON_PROVIDERS.filter(p => !existingProviders.has(p.provider));
  const allProviders = [
    ...(keys as any[]).map((k: any) => ({ ...k, fromDb: true })),
    ...missingProviders.map(p => ({
      id: p.provider,
      provider: p.provider,
      displayName: p.displayName,
      hasKey: false,
      fromDb: false,
      description: p.description,
    })),
  ];

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <Key className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System API keys</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Platform-wide API keys. Users' BYOK keys override these for their
            own usage. Rotate any key here; the previous value stays in use
            until the new save succeeds.
          </p>
        </div>
      </div>

      <div className="p-6 border rounded-xl bg-card space-y-4" data-testid="section-system-api-keys">
        {isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="space-y-2"
            data-testid="skeleton-system-api-keys"
          >
            <span className="sr-only">Loading API keys</span>
            {Array.from({ length: COMMON_PROVIDERS.length }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border rounded-card">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton announce={false} className="h-4 w-24" />
                    <Skeleton announce={false} className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton announce={false} className="h-3 w-56" />
                </div>
                <Skeleton announce={false} className="h-8 w-16 shrink-0" />
              </div>
            ))}
          </div>
        ) : error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            title="Couldn't load API keys"
            testId="error-system-api-keys"
          />
        ) : (
          <div className="space-y-2">
            {allProviders.map((key) => (
              <div key={key.provider} className="flex items-center gap-3 p-3 border rounded-card">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{key.displayName}</span>
                    <Badge variant={key.hasKey ? "default" : "outline"} className={`text-xs ${key.hasKey ? "bg-acr-pos/10 text-acr-pos border-acr-pos/20" : ""}`}>
                      {key.hasKey ? "Configured" : "Not set"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{key.provider}</span>
                    {key.description && <span className="ml-2">— {key.description}</span>}
                  </div>
                </div>
                {editProvider === key.provider ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newKey && !updateMutation.isPending) updateMutation.mutate({ provider: key.provider, apiKey: newKey });
                    }}
                  >
                    <Input
                      type="password"
                      placeholder="Paste API key…"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="h-8 w-56 text-xs font-mono"
                      autoComplete="off"
                      aria-label={`API key for ${key.provider}`}
                      autoFocus
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="h-8"
                      disabled={updateMutation.isPending || !newKey}
                    >
                      {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                    </Button>
                    <Button aria-label="Cancel" type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setEditProvider(null); setNewKey(""); }}>
                      <X className="w-3 h-3" />
                    </Button>
                  </form>
                ) : (
                  <Button
                    size="sm"
                    variant={key.hasKey ? "outline" : "default"}
                    className="h-8 text-xs shrink-0"
                    onClick={() => { setEditProvider(key.provider); setNewKey(""); }}
                  >
                    {key.hasKey ? "Update" : "Set Key"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
