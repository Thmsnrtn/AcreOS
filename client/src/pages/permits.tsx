/**
 * /permits — org-wide permit tracker (SD-3).
 *
 * Brigid §2: "Knowing whether Earl's stormwater plan got submitted to TDEC
 * three weeks ago and is now stuck on a reviewer's desk — that I'd pay for
 * tomorrow."
 *
 * Surfaces all stalled gates (past expected_return_at) across the org plus
 * a quick-select checklist per parent parcel. Per-checklist editing happens
 * inline on /parcels/:id (Subdivision tab → Permits sub-section). This page
 * is the org-wide "where am I behind today?" dashboard.
 */

import { useQuery } from "@tanstack/react-query";
import { ClipboardList, AlertTriangle, ArrowRight, Calendar } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface StalledGate {
  id: string;
  gateKey: string;
  label: string;
  status: string;
  submittedAt: string | null;
  expectedReturnAt: string | null;
  checklistId: string;
  contactName: string | null;
}

interface StalledResponse {
  count: number;
  stalled: StalledGate[];
  asOf: string;
}

interface Template {
  templateKey: string;
  state: string;
  county: string;
  description: string;
  gateCount: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function daysOverdue(expected: string | null): number | null {
  if (!expected) return null;
  const exp = new Date(expected).getTime();
  if (Number.isNaN(exp)) return null;
  return Math.floor((Date.now() - exp) / 86_400_000);
}

export default function PermitsPage() {
  useDocumentTitle("Permits — AcreOS");

  const stalled = useQuery<StalledResponse>({
    queryKey: ["/api/permits/stalled"],
    queryFn: async () => {
      const res = await fetch("/api/permits/stalled", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const templates = useQuery<{ templates: Template[] }>({
    queryKey: ["/api/permit-templates"],
    queryFn: async () => {
      const res = await fetch("/api/permit-templates", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="Permits">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-primary" aria-hidden="true" />
          Permits
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          County-by-county subdivision permit checklists. Open a parent parcel and
          attach a checklist from the Subdivision tab to start tracking gates.
        </p>
      </div>

      {/* Stalled gates */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-acr-warning" aria-hidden="true" />
            Stalled gates {stalled.data ? `(${stalled.data.count})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stalled.isLoading ? (
            <Skeleton className="h-20" />
          ) : stalled.data && stalled.data.count > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">Gate</th>
                  <th className="px-2 py-2 text-left font-medium">Submitted</th>
                  <th className="px-2 py-2 text-left font-medium">Expected back</th>
                  <th className="px-2 py-2 text-right font-medium">Days late</th>
                  <th className="px-2 py-2 text-left font-medium">Contact</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {stalled.data.stalled.map((g) => {
                  const od = daysOverdue(g.expectedReturnAt);
                  return (
                    <tr key={g.id} className="border-b border-border/40">
                      <td className="px-2 py-2 font-medium">{g.label}</td>
                      <td className="px-2 py-2 text-muted-foreground">{fmtDate(g.submittedAt)}</td>
                      <td className="px-2 py-2 text-muted-foreground">{fmtDate(g.expectedReturnAt)}</td>
                      <td className="px-2 py-2 text-right">
                        <Badge variant="destructive">{od === null ? "—" : `${od}d`}</Badge>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{g.contactName ?? "—"}</td>
                      <td className="px-2 py-2 text-right">
                        <Badge variant="outline" className="text-xs">{g.status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground py-3">
              Nothing stalled. Either no checklists yet — or every gate is moving on time. Brigid would say: it's the latter on a good day, the former before the first project lands.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="w-4 h-4" aria-hidden="true" />
            Available templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {templates.isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="grid gap-2">
              {templates.data?.templates.map((t) => (
                <div key={t.templateKey} className="flex items-start justify-between gap-3 py-2 border-b border-border/40 last:border-0">
                  <div>
                    <p className="text-sm font-medium">
                      {t.state === "*" ? "Generic" : `${t.county}, ${t.state}`}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <Badge variant="outline" className="whitespace-nowrap">{t.gateCount} gates</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-6">
        Attach a checklist from /parcels/:id → Subdivision tab. Once gates are
        submitted with an expected-return date, they'll appear above when stalled.
        <ArrowRight className="w-3 h-3 inline" aria-hidden="true" />
      </p>
    </PageShell>
  );
}
