/**
 * Settings → Integrations → Developer tools sections — extracted from the
 * settings.tsx monolith (T3 census W1-2). Behavior and test ids preserved;
 * spinner loading states upgraded to table-row-shaped Skeletons, empty
 * states upgraded to the EmptyState primitive with purposeful CTAs, and
 * query failures now render QueryErrorState with retry.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";
import { Code, Shield, Plus, X, CheckCircle2, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";

// ── API Key Manager ────────────────────────────────────────────────────────────

interface OrgApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  scope: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}

/** Table-row-shaped skeleton shared by the two list panels below. */
function TableRowsSkeleton({ announceText, rows = 3 }: { announceText: string; rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-28" announce={i === 0} announceText={announceText} />
          <Skeleton className="h-4 w-20 hidden sm:block" announce={false} />
          <Skeleton className="h-5 w-14 rounded-full" announce={false} />
          <Skeleton className="h-4 flex-1" announce={false} />
        </div>
      ))}
    </div>
  );
}

export function ApiKeyManager() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState<"read" | "write" | "admin">("read");
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>("never");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);

  const { data: keys = [], isLoading, isError, error, refetch, isRefetching } = useQuery<OrgApiKey[]>({
    queryKey: ["/api/org/api-keys"],
    queryFn: async () => {
      const res = await fetch("/api/org/api-keys", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load API keys");
      return res.json();
    },
  });

  // allow-no-invalidation: onSuccess calls the key list's refetch() — refetch-based, not key-based
  const createKey = useMutation({
    mutationFn: async () => {
      const expiresInDays = newKeyExpiry === "never" ? null : parseInt(newKeyExpiry);
      const res = await apiRequest("POST", "/api/org/api-keys", {
        name: newKeyName,
        scope: newKeyScope,
        expiresInDays,
      });
      return res.json() as Promise<OrgApiKey & { key: string }>;
    },
    onSuccess: (data) => {
      setCreatedKey((data as any).key);
      setShowCreate(false);
      setNewKeyName("");
      refetch();
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't create API key",
        description: err?.message || "Check your connection and try again — no key was created.",
        variant: "destructive",
      }),
  });

  // allow-no-invalidation: onSuccess calls the key list's refetch() — refetch-based, not key-based
  const revokeKey = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/org/api-keys/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      setRevokeId(null);
      refetch();
      toast({ title: "API key revoked" });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't revoke API key",
        description: err?.message || "Check your connection and try again — the key is still active.",
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <Code className="w-5 h-5" aria-hidden="true" />
            API keys
          </h2>
          <p className="text-muted-foreground text-sm">
            Create API keys to let external tools access your AcreOS data.
          </p>
        </div>
        <Button
          size="sm"
          className="min-h-11 pointer-fine:sm:min-h-9"
          onClick={() => setShowCreate(true)}
          data-testid="button-create-api-key"
        >
          <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Create key
        </Button>
      </div>

      {/* Newly created key — show once */}
      {createdKey && (
        <Card
          className="border-acr-pos bg-acr-pos-soft dark:bg-acr-pos-soft/30"
          role="alert"
          aria-live="assertive"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-acr-pos dark:text-acr-pos flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> API key created — copy it now, it won't be shown again
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Label htmlFor="text-created-api-key" className="sr-only">Newly created API key</Label>
              <code
                id="text-created-api-key"
                className="flex-1 text-xs bg-muted rounded px-2 py-1.5 font-mono break-all tabular-nums"
                data-testid="text-created-api-key"
              >{createdKey}</code>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 pointer-fine:sm:min-h-9 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                  toast({ title: "API key copied to clipboard" });
                }}
                aria-label="Copy API key to clipboard"
              >
                Copy
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 pointer-fine:sm:h-9 pointer-fine:sm:w-9 shrink-0"
                onClick={() => setCreatedKey(null)}
                aria-label="Dismiss new API key banner"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New API key</CardTitle>
            <CardDescription>Name it for where you'll use it — Zapier, a custom script, etc. — so you know which key to revoke later.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newKeyName.trim() || createKey.isPending) return;
                createKey.mutate();
              }}
            >
              <div>
                <Label htmlFor="input-api-key-name">
                  Name <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="input-api-key-name"
                  placeholder="e.g. Zapier integration"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  className="mt-1"
                  autoComplete="off"
                  data-testid="input-api-key-name"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="select-api-key-scope">Scope</Label>
                  <Select value={newKeyScope} onValueChange={(v: any) => setNewKeyScope(v)}>
                    <SelectTrigger id="select-api-key-scope" className="mt-1" data-testid="select-api-key-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">Read — view data only</SelectItem>
                      <SelectItem value="write">Write — create and edit</SelectItem>
                      <SelectItem value="admin">Admin — full control</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="select-api-key-expiry">Expiry</Label>
                  <Select value={newKeyExpiry} onValueChange={setNewKeyExpiry}>
                    <SelectTrigger id="select-api-key-expiry" className="mt-1" data-testid="select-api-key-expiry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="60">60 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="min-h-11 pointer-fine:sm:min-h-9"
                  disabled={!newKeyName.trim() || createKey.isPending}
                  data-testid="button-create-api-key-submit"
                >
                  {createKey.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                  Create
                </Button>
                <Button type="button" variant="outline" className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => setShowCreate(false)}>{Verbs.CANCEL}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Keys list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableRowsSkeleton announceText="Loading API keys" />
          ) : isError ? (
            <div className="p-4">
              <QueryErrorState
                error={error as Error}
                onRetry={() => refetch()}
                isRetrying={isRefetching}
                compact
                title="Couldn't load your API keys"
                description="Your keys are unchanged — this is just a display issue."
                testId="error-api-keys"
              />
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              icon={Code}
              headline="No API keys yet"
              subtitle="Create a key to connect Zapier, custom scripts, or any external tool to your AcreOS data."
              cta={{
                label: "Create key",
                onClick: () => setShowCreate(true),
                "data-testid": "empty-create-api-key",
              }}
              className="py-8"
              testId="empty-api-keys"
            />
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Active API keys"
              className="overflow-x-auto"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map(k => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{k.keyPrefix}…</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">{k.scope}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(k.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.expiresAt ? formatDate(k.expiresAt) : "Never"}
                      </TableCell>
                      <TableCell>
                        {revokeId === k.id ? (
                          <div
                            className="flex gap-1"
                            role="group"
                            aria-label={`Confirm revocation of ${k.name}`}
                          >
                            <Button
                              size="sm"
                              variant="destructive"
                              className="min-h-11 pointer-fine:sm:min-h-9"
                              onClick={() => revokeKey.mutate(k.id)}
                              disabled={revokeKey.isPending}
                              data-testid={`button-confirm-revoke-${k.id}`}
                              aria-label={`Confirm revoke ${k.name}`}
                            >
                              {revokeKey.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" /> : null}
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-11 pointer-fine:sm:min-h-9"
                              onClick={() => setRevokeId(null)}
                              aria-label={`Cancel revoke of ${k.name}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive active:text-destructive min-h-11 pointer-fine:sm:min-h-9"
                            onClick={() => setRevokeId(k.id)}
                            data-testid={`button-revoke-${k.id}`}
                            aria-label={`Revoke ${k.name}`}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Activity Audit Log Panel ───────────────────────────────────────────────────

interface AuditLogEntry {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  changes: Record<string, any> | null;
  ipAddress: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export function ActivityLogPanel() {
  const { data: entries = [], isLoading, isError, error, refetch, isRefetching } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/org/activity-log"],
    queryFn: async () => {
      const res = await fetch("/api/org/activity-log", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load activity log");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-section-h2 flex items-center gap-2">
          <Shield className="w-5 h-5" aria-hidden="true" />
          Activity log
        </h2>
        <p className="text-muted-foreground text-sm">
          Last 50 actions performed in your organization.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableRowsSkeleton announceText="Loading activity log" rows={4} />
          ) : isError ? (
            <div className="p-4">
              <QueryErrorState
                error={error as Error}
                onRetry={() => refetch()}
                isRetrying={isRefetching}
                compact
                title="Couldn't load the activity log"
                description="The log itself is intact — this is just a display issue."
                testId="error-activity-log"
              />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={Shield}
              headline="No activity yet"
              subtitle="Actions performed in your organization — edits, invites, key changes — will appear here."
              cta={{
                label: "Refresh",
                onClick: () => refetch(),
                "data-testid": "empty-refresh-activity-log",
              }}
              actionIcon={null}
              className="py-8"
              testId="empty-activity-log"
            />
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Organization activity log"
              className="overflow-x-auto"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{e.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="capitalize">{e.entityType}</span>
                        {e.entityId && <span className="text-muted-foreground ml-1 tabular-nums">#{e.entityId}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {e.userId ? e.userId.slice(0, 8) + "…" : "System"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
