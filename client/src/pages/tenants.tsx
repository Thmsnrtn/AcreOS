/**
 * /tenants — tenant list (BH-2).
 *
 * Imelda §2.6: "When I'm talking to a tenant applicant, anything I write
 * down is FCRA-discoverable in an adverse-action dispute. I cannot write
 * 'seems unstable' in a tenant-applicant note. I can write 'credit score
 * 612, prior eviction 2022, denied per company criteria.'"
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, PlusCircle, AlertTriangle } from "lucide-react";

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
import { tenantDisplayName } from "@shared/rental/tenantName";

interface Tenant {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isEntity: boolean;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  smsConsent: boolean;
  screeningCreditScore: number | null;
  screeningCriteriaMet: boolean | null;
  screeningCompletedAt: string | null;
  adverseActionNoticeSentAt: string | null;
  updatedAt: string;
}

const STATUSES = ["applicant", "approved", "active", "former", "denied", "eviction"] as const;

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

function statusTone(s: string): "default" | "secondary" | "outline" | "destructive" {
  if (s === "active") return "secondary";
  if (s === "denied" || s === "eviction") return "destructive";
  if (s === "approved") return "default";
  return "outline";
}

export default function TenantsPage() {
  useDocumentTitle("Tenants — AcreOS");
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [isEntity, setIsEntity] = useState(false);
  const [company, setCompany] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // An entity (company) tenant is complete with a company name; a person needs
  // first + last. Mirrors the server's zod refinement so the button gates the
  // same way the API validates.
  const canSubmit = isEntity ? company.trim() !== "" : first.trim() !== "" && last.trim() !== "";

  const list = useQuery<{ tenants: Tenant[] }>({
    queryKey: ["/api/tenants", statusFilter],
    queryFn: async () => {
      const url = statusFilter === "all" ? "/api/tenants" : `/api/tenants?status=${statusFilter}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      // For an entity tenant send companyName + isEntity and OMIT the person
      // names; for a person send first/last. Never send an empty person name as
      // a placeholder — the server rejects a blank required field.
      const body = isEntity
        ? { isEntity: true, companyName: company, email, phone, smsConsent }
        : { firstName: first, lastName: last, email, phone, smsConsent };
      const res = await fetch("/api/tenants", {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Tenant added" });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setShowCreate(false);
      setIsEntity(false); setCompany("");
      setFirst(""); setLast(""); setEmail(""); setPhone(""); setSmsConsent(false);
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  return (
    <PageShell label="Tenants">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" aria-hidden="true" />
            Tenants
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Tenants live in their own CRM, separate from acquisition leads.
            FCRA-discoverable fields use structured outcomes only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate((v) => !v)}>
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
            {showCreate ? "Cancel" : "Add tenant"}
          </Button>
        </div>
      </div>

      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New tenant</CardTitle>
            <CardDescription>SMS consent is required before sending text reminders (TCPA).</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Organization / entity tenant toggle. When on, the tenant is a
                company (common for commercial leases) and is entered under a
                company name instead of a person's first/last. */}
            <div className="col-span-full">
              <label className="text-xs flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isEntity}
                  onChange={(e) => setIsEntity(e.target.checked)}
                  data-testid="tenant-is-entity"
                />
                Organization / entity tenant (a company, not a person)
              </label>
            </div>
            {isEntity ? (
              <div className="col-span-full md:col-span-2">
                <Label className="text-xs" htmlFor="tenant-company">Company name *</Label>
                <Input id="tenant-company" value={company} onChange={(e) => setCompany(e.target.value)} className="h-9" data-testid="tenant-company-name" />
              </div>
            ) : (
              <>
                <div><Label className="text-xs" htmlFor="tenant-first-name">First name *</Label><Input id="tenant-first-name" value={first} onChange={(e) => setFirst(e.target.value)} className="h-9" /></div>
                <div><Label className="text-xs" htmlFor="tenant-last-name">Last name *</Label><Input id="tenant-last-name" value={last} onChange={(e) => setLast(e.target.value)} className="h-9" /></div>
              </>
            )}
            <div><Label className="text-xs" htmlFor="tenant-email">Email</Label><Input id="tenant-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs" htmlFor="tenant-phone">Phone</Label><Input id="tenant-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" /></div>
            <div className="flex items-end">
              <label className="text-xs flex items-center gap-2">
                <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
                SMS consent given
              </label>
            </div>
            <div className="col-span-full">
              <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>Add tenant</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : list.data && list.data.tenants.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Phone</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-3 py-2 text-left font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {list.data.tenants.map((t) => (
                  <tr key={t.id} className="border-b border-border/40">
                    <td className="px-3 py-2 font-medium">
                      {tenantDisplayName(t) ?? "—"}
                      {t.isEntity && <Badge variant="outline" className="text-micro ml-2">entity</Badge>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{t.email ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.phone ?? "—"}</td>
                    <td className="px-3 py-2"><Badge variant={statusTone(t.status)} className="text-xs">{t.status}</Badge></td>
                    <td className="px-3 py-2 text-right">{t.screeningCreditScore ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground space-x-1">
                      {!t.smsConsent && <Badge variant="outline" className="text-micro">no SMS</Badge>}
                      {t.adverseActionNoticeSentAt && <Badge variant="destructive" className="text-micro"><AlertTriangle className="w-3 h-3 mr-1" />adverse-action sent</Badge>}
                      {t.screeningCriteriaMet === false && <Badge variant="destructive" className="text-micro">criteria not met</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No tenants yet. Add applicants from prospect inquiries; they convert to active when a lease starts.
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
