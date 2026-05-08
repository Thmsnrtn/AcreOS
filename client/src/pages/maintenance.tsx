/**
 * /maintenance — landlord maintenance ticket queue (BH-6).
 *
 * Imelda §3 today: "did anyone's rent hit overnight, are any maintenance
 * tickets sitting older than 48 hours."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Wrench, PlusCircle, AlertTriangle, CheckCircle2 } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Ticket {
  id: string;
  propertyId: number;
  title: string;
  description: string | null;
  category: string | null;
  severity: string;
  status: string;
  submittedAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  assignedContractorId: string | null;
  invoiceCents: number | null;
}

interface Contractor {
  id: string;
  name: string;
  businessName: string | null;
  trades: string[] | null;
}

const STATUSES = ["open", "triaging", "dispatched", "in_progress", "awaiting_parts", "completed", "cancelled"] as const;
const SEVERITIES = ["emergency", "urgent", "standard", "cosmetic"] as const;

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function severityTone(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "emergency") return "destructive";
  if (s === "urgent") return "default";
  if (s === "cosmetic") return "outline";
  return "secondary";
}

function fmtUsd(c: number | null): string {
  if (c === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function MaintenancePage() {
  useDocumentTitle("Maintenance — AcreOS");
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>("standard");
  const [statusFilter, setStatusFilter] = useState("all");

  const tickets = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["/api/maintenance-tickets", statusFilter],
    queryFn: async () => {
      const url = statusFilter === "all" ? "/api/maintenance-tickets" : `/api/maintenance-tickets?status=${statusFilter}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const contractorsQuery = useQuery<{ contractors: Contractor[] }>({
    queryKey: ["/api/contractors"],
    queryFn: async () => {
      const res = await fetch("/api/contractors", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/maintenance-tickets", {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({
          propertyId: parseInt(propertyId, 10),
          title, description, severity,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ticket created" });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-tickets"] });
      setShowCreate(false);
      setPropertyId(""); setTitle(""); setDescription(""); setSeverity("standard");
    },
  });

  const dispatch = useMutation({
    mutationFn: async (vars: { ticketId: string; contractorId: string }) => {
      const res = await fetch(`/api/maintenance-tickets/${vars.ticketId}/dispatch`, {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({ contractorId: vars.contractorId }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dispatched" });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-tickets"] });
    },
  });

  const complete = useMutation({
    mutationFn: async (ticketId: string) => {
      const res = await fetch(`/api/maintenance-tickets/${ticketId}/complete`, {
        method: "POST", credentials: "include", headers: csrf(), body: "{}",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/maintenance-tickets"] }),
  });

  return (
    <PageShell label="Maintenance">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wrench className="w-6 h-6 text-primary" aria-hidden="true" />
            Maintenance
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Tenant request → triage → dispatch → vendor → invoice. Vendors come from your contractor bench.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate((v) => !v)}>
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
            {showCreate ? "Cancel" : "New ticket"}
          </Button>
        </div>
      </div>

      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New maintenance ticket</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><Label className="text-xs">Property ID *</Label><Input value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" placeholder="No hot water" /></div>
            <div><Label className="text-xs">Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as any)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-full"><Label className="text-xs">Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9" /></div>
            <div className="col-span-full">
              <Button disabled={!propertyId || !title || create.isPending} onClick={() => create.mutate()}>Create ticket</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {tickets.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : tickets.data && tickets.data.tickets.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Title</th>
                  <th className="px-3 py-2 text-left font-medium">Property</th>
                  <th className="px-3 py-2 text-left font-medium">Severity</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Age</th>
                  <th className="px-3 py-2 text-right font-medium">Invoice</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tickets.data.tickets.map((t) => {
                  const age = ageDays(t.submittedAt);
                  const stale = age > 2 && t.status !== "completed" && t.status !== "cancelled";
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="px-3 py-2 font-medium">{t.title}</td>
                      <td className="px-3 py-2 font-mono text-xs">#{t.propertyId}</td>
                      <td className="px-3 py-2"><Badge variant={severityTone(t.severity)} className="text-xs">{t.severity}</Badge></td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{t.status.replace(/_/g, " ")}</Badge></td>
                      <td className={`px-3 py-2 text-right ${stale ? "text-acr-warning font-semibold" : ""}`}>
                        {age}d {stale && <AlertTriangle className="w-3 h-3 inline" aria-hidden="true" />}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{fmtUsd(t.invoiceCents)}</td>
                      <td className="px-3 py-2 text-right">
                        {t.status === "open" || t.status === "triaging" ? (
                          <Select onValueChange={(cId) => dispatch.mutate({ ticketId: t.id, contractorId: cId })}>
                            <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue placeholder="Dispatch…" /></SelectTrigger>
                            <SelectContent>
                              {contractorsQuery.data?.contractors.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.businessName ?? c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : t.status === "completed" ? (
                          <Badge variant="secondary" className="text-xs"><CheckCircle2 className="w-3 h-3 mr-1" /> done</Badge>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => complete.mutate(t.id)}>
                            Mark done
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No maintenance tickets yet.
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
