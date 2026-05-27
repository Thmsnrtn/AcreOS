/**
 * /leases — lease list (BH-2).
 *
 * Renewal-as-addendum lineage tracked via parent_lease_id; status flips
 * to 'renewed' when superseded.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, PlusCircle } from "lucide-react";

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
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

interface Lease {
  id: string;
  propertyId: number;
  unitLabel: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  monthlyRentCents: number;
  isSection8: boolean;
  state: string;
  versionNumber: number;
}

const STATUSES = ["draft", "pending_signature", "active", "ended", "terminated", "renewed"] as const;

function fmtUsd(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function statusTone(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "active") return "secondary";
  if (s === "terminated") return "destructive";
  if (s === "renewed" || s === "ended") return "outline";
  return "default";
}

export default function LeasesPage() {
  useDocumentTitle("Leases — AcreOS");
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rent, setRent] = useState("");
  const [securityDeposit, setSecurityDeposit] = useState("");
  const [state, setState] = useState("TX");
  const [unitLabel, setUnitLabel] = useState("");
  const [isSection8, setIsSection8] = useState(false);
  const [hapPortion, setHapPortion] = useState("");
  const [tenantPortion, setTenantPortion] = useState("");

  const list = useQuery<{ leases: Lease[] }>({
    queryKey: ["/api/leases"],
    queryFn: async () => {
      const res = await fetch("/api/leases", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/leases", {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({
          propertyId: parseInt(propertyId, 10),
          startDate, endDate: endDate || undefined,
          unitLabel: unitLabel || undefined,
          monthlyRentCents: Math.round(parseFloat(rent) * 100),
          securityDepositCents: Math.round(parseFloat(securityDeposit || "0") * 100),
          state, status: "draft",
          isSection8,
          hapPortionCents: isSection8 && hapPortion ? Math.round(parseFloat(hapPortion) * 100) : undefined,
          tenantPortionCents: isSection8 && tenantPortion ? Math.round(parseFloat(tenantPortion) * 100) : undefined,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lease created" });
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      setShowCreate(false);
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  return (
    <PageShell label="Leases">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" aria-hidden="true" />
            Leases
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            One row per lease. Renewals reference the original via parent_lease_id; the original status flips to 'renewed' so versions stay intact.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
          {showCreate ? "Cancel" : "New lease"}
        </Button>
      </div>

      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New lease</CardTitle>
            <CardDescription>Tie to an existing property. Add tenants to the lease after it's created.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><Label className="text-xs">Property ID *</Label><Input value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Unit label</Label><Input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className="h-9" placeholder="3B" /></div>
            <div><Label className="text-xs">State *</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TX">TX</SelectItem><SelectItem value="CA">CA</SelectItem>
                  <SelectItem value="NY">NY</SelectItem><SelectItem value="FL">FL</SelectItem>
                  <SelectItem value="GA">GA</SelectItem><SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Start date *</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">End date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Monthly rent ($) *</Label><Input type="number" value={rent} onChange={(e) => setRent(e.target.value)} className="h-9" placeholder="1400" /></div>
            <div><Label className="text-xs">Security deposit ($)</Label><Input type="number" value={securityDeposit} onChange={(e) => setSecurityDeposit(e.target.value)} className="h-9" /></div>
            <div className="col-span-2 flex items-end">
              <label className="text-xs flex items-center gap-2">
                <input type="checkbox" checked={isSection8} onChange={(e) => setIsSection8(e.target.checked)} />
                Section 8 / housing voucher
              </label>
            </div>
            {isSection8 && (
              <>
                <div><Label className="text-xs">HAP portion ($)</Label><Input type="number" value={hapPortion} onChange={(e) => setHapPortion(e.target.value)} className="h-9" placeholder="1100" /></div>
                <div><Label className="text-xs">Tenant portion ($)</Label><Input type="number" value={tenantPortion} onChange={(e) => setTenantPortion(e.target.value)} className="h-9" placeholder="300" /></div>
              </>
            )}
            <div className="col-span-full">
              <Button disabled={!propertyId || !startDate || !rent || !state || create.isPending} onClick={() => create.mutate()}>Create lease</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : list.data && list.data.leases.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Property / Unit</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Start</th>
                  <th className="px-3 py-2 text-left font-medium">End</th>
                  <th className="px-3 py-2 text-right font-medium">Rent</th>
                  <th className="px-3 py-2 text-left font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {list.data.leases.map((l) => (
                  <tr key={l.id} className="border-b border-border/40">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/parcels/${l.propertyId}`} className="hover:underline">#{l.propertyId}</Link>
                      {l.unitLabel && <span className="text-muted-foreground"> · {l.unitLabel}</span>}
                    </td>
                    <td className="px-3 py-2"><Badge variant={statusTone(l.status)} className="text-xs">{l.status.replace(/_/g, " ")}</Badge></td>
                    <td className="px-3 py-2">{l.startDate}</td>
                    <td className="px-3 py-2">{l.endDate ?? "month-to-month"}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(l.monthlyRentCents)}</td>
                    <td className="px-3 py-2 text-xs space-x-1">
                      {l.isSection8 && <Badge variant="default" className="text-micro">Sec 8</Badge>}
                      {l.versionNumber > 1 && <Badge variant="outline" className="text-micro">v{l.versionNumber}</Badge>}
                      <Badge variant="outline" className="text-micro">{l.state}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No leases yet. Create the first one to start tracking rent and tenants.
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
