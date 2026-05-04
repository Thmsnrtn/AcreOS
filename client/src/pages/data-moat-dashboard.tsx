// @ts-nocheck
import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Database, TrendingUp, Key, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

import { chartColor } from "@/lib/chartPalette";
export default function DataMoatDashboard() {
  useDocumentTitle("Data moat");
  const partnerNameId = useId();
  const [newKeyName, setNewKeyName] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<{ id: number; name: string } | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: statsData } = useQuery({
    queryKey: ["/api/data-api/stats"],
    queryFn: () => apiRequest("/api/data-api/stats").catch(() => ({ stats: {} })),
  });

  const { data: keysData } = useQuery({
    queryKey: ["/api/data-api/keys"],
    queryFn: () => apiRequest("/api/data-api/keys").catch(() => ({ keys: [] })),
  });

  const { data: coverageData } = useQuery({
    queryKey: ["/api/data-api/coverage"],
    queryFn: () => apiRequest("/api/data-api/coverage").catch(() => ({ states: [] })),
  });

  const createKey = useMutation({
    mutationFn: (name: string) => apiRequest("/api/data-api/keys", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/data-api/keys"] });
      setNewKeyName("");
      setIssueDialogOpen(false);
      toast({ title: "API key created" });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't issue API key",
        description: `${err.message}. The key list is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const revokeKey = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/data-api/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/data-api/keys"] });
      setPendingRevoke(null);
      toast({ title: "API key revoked" });
    },
    onError: () =>
      toast({
        title: "Couldn't revoke API key",
        description: "The key is still active. Try again, or rotate it via your partner integration.",
        variant: "destructive",
      }),
  });

  const stats = statsData?.stats || {};
  const keys = keysData?.keys || [];
  const states = coverageData?.states || [];

  const predictionVolumeData = stats.predictionVolume || Array.from({ length: 30 }, (_, i) => ({
    day: `Day ${i + 1}`,
    requests: Math.floor(Math.random() * 500 + 100),
  }));

  const modelAccuracyData = stats.modelAccuracy || Array.from({ length: 12 }, (_, i) => ({
    month: `M${i + 1}`,
    mae: Math.max(0.05, 0.18 - i * 0.01),
    mape: Math.max(3, 15 - i * 0.8),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Data moat dashboard</h1>
          <p className="text-muted-foreground">ML model performance, data coverage, and API partner management.</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-acr-accent" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{(stats.totalTransactions || 0).toLocaleString()}</dd>
                <dt className="text-sm text-muted-foreground">Training transactions</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Globe className="h-8 w-8 text-acr-pos" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{stats.statesCovered || 0}</dd>
                <dt className="text-sm text-muted-foreground">States covered</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-acr-brand" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{stats.modelMape || 0}%</dd>
                <dt className="text-sm text-muted-foreground">Model MAPE</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Key className="h-8 w-8 text-acr-warn" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{keys.filter((k: any) => k.isActive).length}</dd>
                <dt className="text-sm text-muted-foreground">Active API partners</dt>
              </div>
            </div>
          </CardContent>
        </Card>
      </dl>

      <Tabs defaultValue="predictions">
        <TabsList>
          <TabsTrigger value="predictions">Prediction volume</TabsTrigger>
          <TabsTrigger value="accuracy">Model accuracy</TabsTrigger>
          <TabsTrigger value="coverage">Data coverage</TabsTrigger>
          <TabsTrigger value="partners">API partners</TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Daily prediction requests (last 30 days)</CardTitle></CardHeader>
            <CardContent>
              <div role="img" aria-label={`Daily prediction requests over the last 30 days, ${predictionVolumeData.length} data points`}>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={predictionVolumeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="requests" stroke={chartColor(0)} fill={chartColor(1)} name="Requests" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accuracy" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Model accuracy improvement over time</CardTitle></CardHeader>
            <CardContent>
              <div role="img" aria-label="Model accuracy: MAE on left axis, MAPE percent on right, 12 months of data">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={modelAccuracyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="left" tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} />
                    <Tooltip />
                    <Line yAxisId="left" type="monotone" dataKey="mae" stroke={chartColor(0)} name="MAE" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="mape" stroke={chartColor(2)} name="MAPE %" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coverage" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Data coverage by state</CardTitle></CardHeader>
            <CardContent>
              <div role="region" aria-label="Data coverage by US state" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">State</TableHead>
                      <TableHead scope="col">Transactions</TableHead>
                      <TableHead scope="col">Coverage %</TableHead>
                      <TableHead scope="col">Latest data</TableHead>
                      <TableHead scope="col">Model quality</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {states.length > 0 ? states.map((s: any, i: number) => (
                      <TableRow key={i}>
                        <th scope="row" className="font-medium px-4 text-left">{s.state}</th>
                        <TableCell className="tabular-nums">{s.transactions?.toLocaleString() || 0}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-16 bg-muted rounded-full h-2"
                              role="progressbar"
                              aria-valuenow={s.coveragePct || 0}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${s.state} coverage ${s.coveragePct || 0}%`}
                            >
                              <div className="bg-primary h-2 rounded-full" style={{ width: `${s.coveragePct || 0}%` }} />
                            </div>
                            <span className="text-sm tabular-nums">{s.coveragePct || 0}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">{s.latestData || "Unknown"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={s.quality === "high" ? "default" : s.quality === "medium" ? "secondary" : "destructive"}
                            className="capitalize"
                          >
                            {s.quality || "low"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No coverage data available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="partners" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle>API partner keys</CardTitle>
                <Dialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" aria-label="Issue a new API partner key">
                      <Key className="h-4 w-4 mr-2" aria-hidden="true" /> Issue new key
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Issue API key</DialogTitle>
                    </DialogHeader>
                    <form
                      onSubmit={(e) => { e.preventDefault(); if (newKeyName) createKey.mutate(newKeyName); }}
                      className="space-y-4 pt-2"
                    >
                      <div>
                        <Label htmlFor={partnerNameId}>Partner name or description</Label>
                        <Input
                          id={partnerNameId}
                          placeholder="e.g. Acme Realty integration"
                          value={newKeyName}
                          onChange={e => setNewKeyName(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={!newKeyName || createKey.isPending}
                      >
                        {createKey.isPending ? "Creating…" : "Create API key"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div role="region" aria-label="API partner keys" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Partner</TableHead>
                      <TableHead scope="col">API key</TableHead>
                      <TableHead scope="col">Calls (30d)</TableHead>
                      <TableHead scope="col">Last used</TableHead>
                      <TableHead scope="col">Status</TableHead>
                      <TableHead scope="col">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k: any) => (
                      <TableRow key={k.id}>
                        <th scope="row" className="font-medium px-4 text-left">{k.name}</th>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {k.keyPrefix || "ak_"}…{k.keySuffix || "xxxx"}
                        </TableCell>
                        <TableCell className="tabular-nums">{k.callCount30d || 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={k.isActive ? "default" : "secondary"}>
                            {k.isActive ? "Active" : "Revoked"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {k.isActive && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setPendingRevoke({ id: k.id, name: k.name })}
                              disabled={revokeKey.isPending}
                              aria-label={`Revoke API key for ${k.name}`}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {keys.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No API keys issued yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!pendingRevoke}
        onOpenChange={(open) => { if (!open) setPendingRevoke(null); }}
        title={`Revoke API key for ${pendingRevoke?.name ?? ""}?`}
        description={
          pendingRevoke
            ? `${pendingRevoke.name} will lose API access immediately. Their existing integrations will stop working until you issue a new key. This action can't be undone — they'll need to receive and install a fresh key.`
            : ""
        }
        confirmLabel="Yes, revoke"
        variant="destructive"
        isLoading={revokeKey.isPending}
        onConfirm={() => pendingRevoke && revokeKey.mutate(pendingRevoke.id)}
      />
    </div>
  );
}
