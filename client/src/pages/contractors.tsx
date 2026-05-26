/**
 * /contractors — bench list w/ YTD totals + 1099-NEC entry point (FF-3).
 *
 * Devon §4: "1099-NEC for every sub I paid >$600 — Fail. No contractor
 * entity, no W-9 storage, no YTD totals, no form generator."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, PlusCircle, FileText, AlertTriangle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

interface Contractor {
  id: string;
  name: string;
  businessName: string | null;
  legalEntityName: string | null;
  email: string | null;
  phone: string | null;
  ytdPaidCents: number;
  lifetimePaidCents: number;
  taxIdMasked: string;
  taxIdType: string | null;
  activeStatus: string;
  insuranceExpiresAt: string | null;
}

const NEC_THRESHOLD_CENTS = 60000;

function fmtUsd(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export default function ContractorsPage() {
  useDocumentTitle("Contractors — AcreOS");
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [taxIdType, setTaxIdType] = useState<"ein" | "ssn">("ein");

  const list = useQuery<{ contractors: Contractor[] }>({
    queryKey: ["/api/contractors"],
    queryFn: async () => {
      const res = await fetch("/api/contractors", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contractors", {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({
          name, businessName, email, phone,
          // Server-side encryption-at-rest is handled by the contractors
          // route handler (AES-256-GCM via ENCRYPTION_KEY). The wire field
          // name is preserved for API stability.
          taxIdEncrypted: taxId,
          taxIdType,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Contractor added" });
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      setShowCreate(false);
      setName(""); setBusinessName(""); setEmail(""); setPhone(""); setTaxId("");
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const total1099Eligible = (list.data?.contractors ?? []).filter((c) => c.ytdPaidCents >= NEC_THRESHOLD_CENTS).length;

  return (
    <PageShell label="Contractors">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" aria-hidden="true" />
            Contractors
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Sub bench with YTD payment totals. Auto-flags contractors over the
            $600 1099-NEC threshold so you're not chasing W-9s in December.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/contractors/1099-nec">
              <FileText className="w-4 h-4 mr-1" aria-hidden="true" />
              1099-NEC ({total1099Eligible})
            </Link>
          </Button>
          <Button onClick={() => setShowCreate((v) => !v)}>
            <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
            {showCreate ? "Cancel" : "Add contractor"}
          </Button>
        </div>
      </div>

      {showCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New contractor</CardTitle>
            <CardDescription>Tax ID is required to issue a 1099-NEC. Add now or fill in later before tax-time.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><Label className="text-xs">Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Business name</Label><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="h-9" placeholder="Marcus Construction LLC" /></div>
            <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">Tax ID type</Label>
              <select className="h-9 border rounded px-2 w-full" value={taxIdType} onChange={(e) => setTaxIdType(e.target.value as any)}>
                <option value="ein">EIN</option>
                <option value="ssn">SSN</option>
              </select>
            </div>
            <div><Label className="text-xs">Tax ID</Label><Input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="h-9" placeholder="XX-XXXXXXX" /></div>
            <div className="col-span-full">
              <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>Add contractor</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <Skeleton className="h-32 m-4" />
          ) : list.data && list.data.contractors.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Business</th>
                  <th className="px-3 py-2 text-left font-medium">Tax ID</th>
                  <th className="px-3 py-2 text-right font-medium">YTD paid</th>
                  <th className="px-3 py-2 text-right font-medium">Lifetime</th>
                  <th className="px-3 py-2 text-left font-medium">1099 status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.contractors.map((c) => (
                  <tr key={c.id} className="border-b border-border/40">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.businessName ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.taxIdMasked}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(c.ytdPaidCents)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{fmtUsd(c.lifetimePaidCents)}</td>
                    <td className="px-3 py-2">
                      {c.ytdPaidCents >= NEC_THRESHOLD_CENTS ? (
                        c.taxIdMasked === "—" ? (
                          <Badge variant="destructive" className="text-xs"><AlertTriangle className="w-3 h-3 mr-1" /> need W-9</Badge>
                        ) : (
                          <Badge variant="default" className="text-xs">1099 eligible</Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="text-xs">below threshold</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No contractors yet. Add your sub bench above so YTD totals + 1099-NEC tracking start working.
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
