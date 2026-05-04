import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlagsRefresh } from "@/contexts/feature-flags-context";
import { Flag, Search } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * Founder UI — `/founder/features`. Design-system §8.2.
 *
 * Calm table: one row per flag with key, description, current state,
 * audience, last changed, edit. Inline state edit; audience editor for
 * beta state. Every change persists via PATCH /api/feature-flags/admin/:key
 * and triggers a global refresh so other surfaces reflect immediately.
 *
 * This page replaces the prototype-design-system §8.2 spec. The older
 * /founder/feature-flags page (binary on/off model) is left intact for
 * back-compat but new flags should use this page's 5-state model.
 */

const STATES = [
  { value: "off", label: "Off", description: "Invisible everywhere" },
  { value: "founder-only", label: "Founder only", description: "Only the founder sees / hits" },
  { value: "beta", label: "Beta", description: "Opted-in users from audience list" },
  { value: "tier:free", label: "Tier: Free", description: "Free-tier subscribers" },
  { value: "tier:starter", label: "Tier: Starter", description: "Starter-tier subscribers" },
  { value: "tier:pro", label: "Tier: Pro", description: "Pro-tier subscribers" },
  { value: "tier:scale", label: "Tier: Scale", description: "Scale-tier subscribers" },
  { value: "on", label: "On", description: "Live for everyone" },
] as const;

interface AdminFlag {
  key: string;
  label: string;
  description: string;
  state: string;
  audience: { betaUserIds?: string[] };
  changedBy?: string | null;
  changedAt?: string | null;
  controlledRoutes: string[];
}

const STATE_BADGE_TONE: Record<string, string> = {
  on: "bg-acr-pos/10 text-acr-pos dark:text-acr-pos border-acr-pos/30",
  "founder-only": "bg-acr-brand/10 text-acr-brand dark:text-acr-brand border-acr-brand/30",
  beta: "bg-acr-warn/10 text-acr-warn dark:text-acr-warn border-acr-warn/30",
  off: "bg-muted text-muted-foreground border-border",
};

function fmtChanged(when?: string | null): string {
  useDocumentTitle("Feature management");

  if (!when) return "—";
  try {
    return new Date(when).toLocaleString();
  } catch {
    return when;
  }
}

export default function FounderFeatures() {
  const [flags, setFlags] = useState<AdminFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const { toast } = useToast();
  const refreshGlobal = useFeatureFlagsRefresh();

  const load = async () => {
    try {
      const res = await fetch("/api/feature-flags/admin", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          setError("Founder access required.");
          return;
        }
        setError(`Failed to load flags (${res.status})`);
        return;
      }
      const data = (await res.json()) as AdminFlag[];
      setFlags(data);
      setError(null);
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    }
  };

  useEffect(() => { void load(); }, []);

  const setState = async (key: string, state: string) => {
    const optimistic = flags?.map((f) => f.key === key ? { ...f, state } : f) ?? null;
    setFlags(optimistic);
    try {
      const res = await fetch(`/api/feature-flags/admin/${encodeURIComponent(key)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
      const updated = (await res.json()) as AdminFlag;
      setFlags((prev) => (prev ?? []).map((f) => (f.key === key ? updated : f)));
      await refreshGlobal();
      toast({ title: "Flag updated", description: `${key} → ${state}` });
    } catch (err) {
      toast({
        title: "Couldn't update flag",
        description: `${err}`,
        variant: "destructive",
      });
      void load();
    }
  };

  const setBetaUsers = async (key: string, userIdsCsv: string) => {
    const ids = userIdsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/feature-flags/admin/${encodeURIComponent(key)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: { betaUserIds: ids } }),
      });
      if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
      const updated = (await res.json()) as AdminFlag;
      setFlags((prev) => (prev ?? []).map((f) => (f.key === key ? updated : f)));
      await refreshGlobal();
      toast({ title: "Audience updated", description: `${ids.length} user(s)` });
    } catch (err) {
      toast({ title: "Couldn't update audience", description: `${err}`, variant: "destructive" });
    }
  };

  const filtered = (flags ?? []).filter((f) => {
    const matchesSearch =
      !search ||
      f.key.toLowerCase().includes(search.toLowerCase()) ||
      f.description.toLowerCase().includes(search.toLowerCase());
    const matchesState = stateFilter === "all" || f.state === stateFilter;
    return matchesSearch && matchesState;
  });

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Flag className="w-5 h-5" />
              Feature flags
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Five states per flag: off / founder-only / beta / tier / on. Changes
              apply globally on save and sync to all clients on next reload.
            </p>
          </div>
        </div>

        {error && (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {!flags && !error && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-card" />
            ))}
          </div>
        )}

        {flags && !error && (
          <>
            <Card>
              <CardContent className="py-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by key or description…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                      data-testid="input-flag-search"
                    />
                  </div>
                  <Select value={stateFilter} onValueChange={setStateFilter}>
                    <SelectTrigger className="w-full sm:w-48" data-testid="select-state-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All states</SelectItem>
                      {STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {filtered.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No flags match the current filter.
                  </CardContent>
                </Card>
              )}
              {filtered.map((flag) => (
                <Card key={flag.key} data-testid={`flag-row-${flag.key}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-mono bg-muted/60 px-1.5 py-0.5 rounded">
                            {flag.key}
                          </code>
                          <Badge
                            variant="outline"
                            className={STATE_BADGE_TONE[flag.state] ?? STATE_BADGE_TONE.off}
                          >
                            {flag.state}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-1">
                          <span className="font-medium text-foreground">{flag.label}</span>
                          {flag.description && (
                            <> — {flag.description}</>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">State</label>
                      <Select
                        value={flag.state}
                        onValueChange={(v) => setState(flag.key, v)}
                      >
                        <SelectTrigger
                          className="w-56"
                          data-testid={`select-state-${flag.key}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              <span className="flex flex-col">
                                <span>{s.label}</span>
                                <span className="text-xs text-muted-foreground">{s.description}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground ml-auto">
                        Last changed {fmtChanged(flag.changedAt)}
                        {flag.changedBy ? ` by ${flag.changedBy}` : ""}
                      </span>
                    </div>

                    {flag.state === "beta" && (
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="text-xs text-muted-foreground whitespace-nowrap">
                          Beta user IDs
                        </label>
                        <Input
                          defaultValue={(flag.audience.betaUserIds ?? []).join(", ")}
                          onBlur={(e) => setBetaUsers(flag.key, e.currentTarget.value)}
                          placeholder="user_abc, user_def, user_ghi"
                          className="flex-1 max-w-md font-mono text-xs"
                          data-testid={`input-beta-${flag.key}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {(flag.audience.betaUserIds ?? []).length} user(s)
                        </span>
                      </div>
                    )}

                    {flag.controlledRoutes.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Controls routes:</span>
                        {flag.controlledRoutes.map((r) => (
                          <code key={r} className="font-mono bg-muted/60 px-1.5 py-0.5 rounded">
                            {r}
                          </code>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
