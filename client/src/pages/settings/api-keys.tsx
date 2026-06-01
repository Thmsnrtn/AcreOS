/**
 * Settings → API Keys (Lens 50, Public API v0).
 *
 * Admin-only page (the backing route /api/admin/api-keys uses adminGuard).
 * Lists this org's API keys with their scopes, last-used time, and
 * revoke / regenerate actions. New-key dialog shows the plaintext token
 * exactly once with a copy button — no second chance.
 *
 * NOT wired into App.tsx router or the settings nav yet. The whole API
 * v0 surface is additive scaffold per the v0 spec.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getErrorMessage } from "@/lib/error-utils";
import { Copy, KeyRound, RefreshCw, Trash2, AlertTriangle } from "lucide-react";

const ALL_SCOPES = [
  "leads:read",
  "leads:write",
  "properties:read",
  "properties:write",
  "deals:read",
  "deals:write",
  "notes:read",
  "notes:write",
  "webhooks:write",
] as const;

type Scope = (typeof ALL_SCOPES)[number];

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  scopes: Scope[];
  rateLimit: number | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
}

interface CreateResponse {
  key: { id: number; name: string; prefix: string; scopes: Scope[]; createdAt: string };
  plaintext_key: string;
  warning: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

export default function ApiKeysSettingsPage() {
  useDocumentTitle("API Keys");
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<Scope[]>(["leads:read"]);
  const [revealedKey, setRevealedKey] = useState<CreateResponse | null>(null);

  const { data, isLoading, error } = useQuery<{ keys: ApiKeyRow[] }>({
    queryKey: ["/api/admin/api-keys"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/api-keys");
      return await res.json();
    },
  });
  const keys = data?.keys ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/api-keys", {
        name: newKeyName,
        scopes: newKeyScopes,
        mode: "live",
      });
      return (await res.json()) as CreateResponse;
    },
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setRevealedKey(resp);
      setCreateOpen(false);
      setNewKeyName("");
      setNewKeyScopes(["leads:read"]);
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: getErrorMessage(e), variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/api-keys/${id}/revoke`, {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({ title: "Key revoked" });
    },
    onError: (e: Error) =>
      toast({ title: "Revoke failed", description: getErrorMessage(e), variant: "destructive" }),
  });

  const regenerateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/api-keys/${id}/regenerate`, {});
      return (await res.json()) as CreateResponse;
    },
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setRevealedKey(resp);
    },
    onError: (e: Error) =>
      toast({ title: "Regenerate failed", description: getErrorMessage(e), variant: "destructive" }),
  });

  function toggleScope(scope: Scope) {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast({ title: "Copied to clipboard" }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  }

  return (
    <PageShell>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
            <p className="text-sm text-muted-foreground">
              Generate bearer tokens for the public AcreOS API (v1). Each key is
              scoped — give integrations only what they need.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-api-key">
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                New key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  Pick a name and the scopes this key should grant. You can't change
                  scopes later — create a new key instead.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-key-name">Name</Label>
                  <Input
                    id="api-key-name"
                    placeholder="Zapier production"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    data-testid="input-api-key-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scopes</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_SCOPES.map((scope) => (
                      <label key={scope} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={newKeyScopes.includes(scope)}
                          onCheckedChange={() => toggleScope(scope)}
                          aria-label={`Toggle scope ${scope}`}
                        />
                        <code className="text-xs">{scope}</code>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={
                    !newKeyName.trim() ||
                    newKeyScopes.length === 0 ||
                    createMutation.isPending
                  }
                  data-testid="button-confirm-create-key"
                >
                  Create key
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </header>

        {revealedKey && (
          <Alert variant="default" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Save this key now</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{revealedKey.warning}</p>
              <div className="flex items-center gap-2 rounded-md bg-background p-2 font-mono text-sm">
                <code className="flex-1 break-all" data-testid="text-plaintext-key">
                  {revealedKey.plaintext_key}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(revealedKey.plaintext_key)}
                  aria-label="Copy API key to clipboard"
                >
                  <Copy className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setRevealedKey(null)}>
                I've saved it
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Active keys</CardTitle>
            <CardDescription>
              {keys.filter((k) => !k.revokedAt).length} active,{" "}
              {keys.filter((k) => k.revokedAt).length} revoked
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}
            {!isLoading && error && (
              <p className="text-sm text-destructive">
                Failed to load keys: {getErrorMessage(error as Error)}
              </p>
            )}
            {!isLoading && !error && keys.length === 0 && (
              <EmptyState
                icon={KeyRound}
                headline="No API keys yet"
                subtitle="Create your first key to start integrating AcreOS with external tools."
                cta={{
                  label: "Create a key",
                  onClick: () => setCreateOpen(true),
                  "data-testid": "api-keys-create",
                }}
                actionIcon={null}
              />
            )}
            {!isLoading && !error && keys.length > 0 && (
              <ul className="divide-y divide-border">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{k.name}</span>
                        {k.revokedAt && <Badge variant="destructive">Revoked</Badge>}
                        {k.expiresAt &&
                          new Date(k.expiresAt).getTime() < Date.now() && (
                            <Badge variant="secondary">Expired</Badge>
                          )}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        ak_live_…{k.prefix}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last used {fmtDate(k.lastUsedAt)} · Created {fmtDate(k.createdAt)}
                      </div>
                    </div>
                    {!k.revokedAt && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => regenerateMutation.mutate(k.id)}
                          disabled={regenerateMutation.isPending}
                          aria-label={`Regenerate key ${k.name}`}
                          data-testid={`button-regenerate-${k.id}`}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                          Regenerate
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Revoke "${k.name}"? Any integration using it will start receiving 401s immediately.`)) {
                              revokeMutation.mutate(k.id);
                            }
                          }}
                          disabled={revokeMutation.isPending}
                          aria-label={`Revoke key ${k.name}`}
                          data-testid={`button-revoke-${k.id}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" aria-hidden />
                          Revoke
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
