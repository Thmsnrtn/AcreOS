/**
 * /servicer — Note Servicer foundation surface (Pillar K, Ursa persona).
 *
 * Persona-gated: only users with `persona === "note_servicer"` see this
 * route in the sidebar; non-servicer personas hitting the URL directly
 * are redirected to /today.
 *
 * Three tabs ship in the foundation PR:
 *   - Owners of Record: list active third-party legal owners per note.
 *   - Remittances: per-month statements with status pills.
 *   - Licenses: per-state coverage matrix with expiring-soon highlights.
 *
 * The actual 1099-INT-on-behalf-of-owner generator and Reg AB report
 * surface are deferred (state-by-state filing requirements need counsel;
 * Reg AB report is fund-administrator-grade work).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { AlertTriangle, FileText, Landmark, ShieldCheck, Users } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useDocumentTitle } from "@/hooks/use-document-title";
import { usePersona } from "@/hooks/use-persona";

// ─────────────────────────────────────────────────────────────────────
// API response shapes (mirror the server routes-servicer.ts contracts).
// ─────────────────────────────────────────────────────────────────────
interface OwnerRow {
  id: string;
  noteId: string;
  noteNumber: string;
  ownerOrgId: number;
  ownerType: "org" | "lp" | "ira_custodian" | "trust";
  basisPercentage: string;
  effectiveAt: string;
  supersededAt: string | null;
}

interface RemittanceRow {
  id: string;
  ownerOrgId: number;
  periodStart: string;
  periodEnd: string;
  grossCents: number;
  servicerFeeCents: number;
  netCents: number;
  status: "draft" | "sent" | "paid";
  generatedAt: string;
}

interface LicenseRow {
  id: string;
  state: string;
  licenseType: "sub_servicer" | "master_servicer" | "rmlo" | "none_required";
  licenseNumber: string | null;
  expiresAt: string | null;
}

interface OwnersResponse {
  owners: OwnerRow[];
}
interface RemittancesResponse {
  remittances: RemittanceRow[];
  pagination: { limit: number; offset: number; total: number };
}
interface LicensesResponse {
  licenses: LicenseRow[];
}

// ─────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────
function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ownerTypeLabel(t: OwnerRow["ownerType"]): string {
  switch (t) {
    case "org":
      return "Org";
    case "lp":
      return "LP";
    case "ira_custodian":
      return "IRA custodian";
    case "trust":
      return "Trust";
  }
}

function licenseTypeLabel(t: LicenseRow["licenseType"]): string {
  switch (t) {
    case "sub_servicer":
      return "Sub-servicer";
    case "master_servicer":
      return "Master servicer";
    case "rmlo":
      return "RMLO";
    case "none_required":
      return "None required";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tab: Owners of Record
// ─────────────────────────────────────────────────────────────────────
function OwnersTab() {
  const { data, isLoading, isError } = useQuery<OwnersResponse>({
    queryKey: ["/api/servicer/owners"],
  });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        We couldn&apos;t load owners of record. Try refreshing the page.
      </Card>
    );
  }
  const rows = data?.owners ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No owners of record yet"
        description="Add the third-party legal owner — fund LP, IRA custodian, family-office trust — for each serviced note."
        actionLabel="Add owner of record"
        actionIcon={null}
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Note</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Basis %</TableHead>
            <TableHead>Effective</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`owner-row-${r.id}`}>
              <TableCell className="font-medium">{r.noteNumber}</TableCell>
              <TableCell>Org #{r.ownerOrgId}</TableCell>
              <TableCell>
                <Badge variant="secondary">{ownerTypeLabel(r.ownerType)}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {Number(r.basisPercentage).toFixed(2)}%
              </TableCell>
              <TableCell>{fmtDate(r.effectiveAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab: Remittances
// ─────────────────────────────────────────────────────────────────────
function remittanceBadgeVariant(s: RemittanceRow["status"]): "default" | "secondary" | "outline" {
  if (s === "paid") return "default";
  if (s === "sent") return "secondary";
  return "outline";
}

function RemittancesTab() {
  const { data, isLoading, isError } = useQuery<RemittancesResponse>({
    queryKey: ["/api/servicer/remittances"],
  });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        We couldn&apos;t load remittances. Try refreshing the page.
      </Card>
    );
  }
  const rows = data?.remittances ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No remittances yet"
        description="Monthly remittances are generated per beneficial owner after the month closes. Add an owner of record and post payments to see statements here."
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Fee</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`remittance-row-${r.id}`}>
              <TableCell className="font-medium">
                {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
              </TableCell>
              <TableCell>Org #{r.ownerOrgId}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtUsd(r.grossCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtUsd(r.servicerFeeCents)}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {fmtUsd(r.netCents)}
              </TableCell>
              <TableCell>
                <Badge variant={remittanceBadgeVariant(r.status)}>{r.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab: Licenses
// ─────────────────────────────────────────────────────────────────────
function LicensesTab() {
  const { data, isLoading, isError } = useQuery<LicensesResponse>({
    queryKey: ["/api/servicer/licenses"],
  });

  const expiringSoon = useMemo(() => {
    if (!data?.licenses) return new Set<string>();
    const horizon = Date.now() + 60 * 24 * 60 * 60 * 1000; // 60 days
    const set = new Set<string>();
    for (const lic of data.licenses) {
      if (!lic.expiresAt) continue;
      const ts = new Date(lic.expiresAt).getTime();
      if (!Number.isNaN(ts) && ts <= horizon) set.add(lic.id);
    }
    return set;
  }, [data?.licenses]);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        We couldn&apos;t load licenses. Try refreshing the page.
      </Card>
    );
  }
  const rows = data?.licenses ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No licenses on file"
        description="Reg AB-style obligations vary by state. Record sub-servicer, master-servicer, or RMLO licenses you hold per jurisdiction."
        actionLabel="Add license"
        actionIcon={null}
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>State</TableHead>
            <TableHead>License type</TableHead>
            <TableHead>Number</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isExpiringSoon = expiringSoon.has(r.id);
            return (
              <TableRow key={r.id} data-testid={`license-row-${r.id}`}>
                <TableCell className="font-medium">{r.state}</TableCell>
                <TableCell>{licenseTypeLabel(r.licenseType)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.licenseNumber ?? "—"}
                </TableCell>
                <TableCell>{fmtDate(r.expiresAt)}</TableCell>
                <TableCell className="text-right">
                  {isExpiringSoon ? (
                    <Badge variant="destructive" className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      Expiring soon
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Active</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
export default function ServicerPage() {
  useDocumentTitle("Servicer — AcreOS");
  const persona = usePersona();
  const [tab, setTab] = useState<"owners" | "remittances" | "licenses">("owners");

  // Persona gate — non-servicer personas redirect to /today.
  if (persona !== "note_servicer") {
    return <Redirect to="/today" />;
  }

  return (
    <PageShell label="Note Servicer">
      <div className="space-y-6">
        <header className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2" aria-hidden="true">
            <Landmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Note Servicer</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Service notes owned by others. Track owners of record, generate per-owner
              monthly remittances, and keep per-state licensing posture current.
            </p>
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="owners" data-testid="tab-owners">
              Owners of Record
            </TabsTrigger>
            <TabsTrigger value="remittances" data-testid="tab-remittances">
              Remittances
            </TabsTrigger>
            <TabsTrigger value="licenses" data-testid="tab-licenses">
              Licenses
            </TabsTrigger>
          </TabsList>

          <TabsContent value="owners" className="mt-6">
            <OwnersTab />
          </TabsContent>
          <TabsContent value="remittances" className="mt-6">
            <RemittancesTab />
          </TabsContent>
          <TabsContent value="licenses" className="mt-6">
            <LicensesTab />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
