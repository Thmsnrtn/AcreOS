/**
 * /leases — lease list (BH-2).
 *
 * Renewal-as-addendum lineage tracked via parent_lease_id; status flips
 * to 'renewed' when superseded.
 *
 * UNIT LABEL (BH-9). The free-text field is unchanged in shape, but it is no
 * longer inert: POST /api/leases now find-or-creates the `rental_units` row for
 * (org, property, label) and links the lease to it, so a lease entered here
 * finally reaches the occupancy denominator. Two consequences for this form:
 *
 *   1. The label is the unit's IDENTITY, so " 3B" and "3B" would be two
 *      different units on one building. The server trims, and the datalist
 *      below offers the property's existing labels so the operator picks the
 *      one that already exists instead of typing a near-miss.
 *   2. Leaving it blank is a real answer — the whole property is the rentable
 *      slot (the SFR case), matching migration 0219's 'Whole property' unit.
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

interface RentalUnit {
  id: string;
  label: string;
  kind: string;
  status: string;
  activeLeaseCount: number;
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

  // Existing units at the chosen property, offered as suggestions on the unit
  // label field. Suggestion-only: a label the operator types that isn't here
  // still creates a new unit server-side, which is exactly how a landlord adds
  // the first unit of a building from this form.
  const propertyIdNum = Number.parseInt(propertyId, 10);
  const units = useQuery<{ units: RentalUnit[] }>({
    queryKey: ["/api/rentals/properties", propertyIdNum, "units"],
    enabled: showCreate && Number.isFinite(propertyIdNum) && propertyIdNum > 0,
    queryFn: async () => {
      const res = await fetch(`/api/rentals/properties/${propertyIdNum}/units`, { credentials: "include" });
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
      if (!res.ok) {
        // Surface the server's own message. The lease POST can refuse for
        // reasons the operator has to read — the federal lead-paint gate, or a
        // unit that could not be resolved — and "Failed (400)" hides all of it.
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || body?.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lease created" });
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      // A lease creates its unit when the label is new, so the suggestion list
      // and every occupancy read are now stale.
      queryClient.invalidateQueries({ queryKey: ["/api/rentals/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-roll/occupancy"] });
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
            <div>
              <Label className="text-xs" htmlFor="lease-unit-label">Unit label</Label>
              <Input
                id="lease-unit-label"
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                className="h-9"
                placeholder="3B"
                list="lease-unit-label-options"
                autoComplete="off"
                aria-describedby="lease-unit-label-help"
              />
              <datalist id="lease-unit-label-options">
                {(units.data?.units ?? []).map((u) => (
                  <option key={u.id} value={u.label} />
                ))}
              </datalist>
              <p id="lease-unit-label-help" className="text-micro text-muted-foreground mt-1">
                {units.data && units.data.units.length > 0
                  ? `Matches one of ${units.data.units.length} unit(s) already on this property, or creates a new one. Leave blank for a whole-property tenancy.`
                  : "Creates the unit if it doesn't exist yet. Leave blank for a whole-property tenancy."}
              </p>
            </div>
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
