/**
 * Phase 3 Week 11 — Founder sub-processor (DPA) registry UI.
 *
 * Founder-only edit-in-place table over data_processing_agreements. The
 * eight known sub-processors (Stripe, Twilio, SendGrid, Clerk, Anthropic,
 * OpenAI, Lob, AWS) are seeded with status "pending" — outreach is a
 * manual workstream tracked here.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Building2, Save } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

type DpaStatus = "pending" | "negotiating" | "signed" | "expired";

interface Vendor {
  id: string;
  vendorName: string;
  status: DpaStatus;
  signedDate: string | null;
  expiresAt: string | null;
  contactEmail: string | null;
  scope: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_VARIANT: Record<DpaStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  negotiating: "secondary",
  signed: "default",
  expired: "destructive",
};

const STATUS_OPTIONS: DpaStatus[] = ["pending", "negotiating", "signed", "expired"];

export default function FounderSubProcessorsPage() {
  useDocumentTitle("Sub-processors");

  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, Partial<Vendor>>>({});

  const { data, isLoading, error } = useQuery<{ vendors: Vendor[] }>({
    queryKey: ["/api/founder/sub-processors"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Vendor> }) => {
      const res = await apiRequest("PATCH", `/api/founder/sub-processors/${id}`, patch);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? "Update failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/sub-processors"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const setDraftField = (id: string, key: keyof Vendor, value: unknown) => {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  };

  const handleSave = (vendor: Vendor) => {
    const patch = draft[vendor.id];
    if (!patch || Object.keys(patch).length === 0) {
      toast({ title: "No changes" });
      return;
    }
    updateMutation.mutate({ id: vendor.id, patch });
    setDraft((prev) => {
      const next = { ...prev };
      delete next[vendor.id];
      return next;
    });
  };

  const merged = (vendor: Vendor): Vendor => ({ ...vendor, ...(draft[vendor.id] ?? {}) });

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="w-7 h-7" aria-hidden="true" />
            Sub-processors (DPA registry)
          </h1>
          <p className="text-muted-foreground mt-1">
            Every external vendor that touches customer data. Update DPA status as outreach progresses;
            evidence URLs link to the executed agreement in document storage.
          </p>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-destructive text-sm">Failed to load sub-processor registry.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {(data?.vendors ?? []).map((v) => {
              const m = merged(v);
              return (
                <Card key={v.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <CardTitle>{v.vendorName}</CardTitle>
                      <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                    </div>
                    <CardDescription>{v.scope ?? "Scope not yet documented"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Status</span>
                        <Select
                          value={m.status}
                          onValueChange={(value) => setDraftField(v.id, "status", value as DpaStatus)}
                        >
                          <SelectTrigger aria-label={`Status for ${v.vendorName}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="block text-sm">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Contact email</span>
                        <Input
                          type="email"
                          value={m.contactEmail ?? ""}
                          onChange={(e) => setDraftField(v.id, "contactEmail", e.target.value)}
                          placeholder="privacy@vendor.com"
                          aria-label={`Contact email for ${v.vendorName}`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Signed date</span>
                        <Input
                          type="date"
                          value={m.signedDate ?? ""}
                          onChange={(e) => setDraftField(v.id, "signedDate", e.target.value || null)}
                          aria-label={`Signed date for ${v.vendorName}`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Expires</span>
                        <Input
                          type="date"
                          value={m.expiresAt ?? ""}
                          onChange={(e) => setDraftField(v.id, "expiresAt", e.target.value || null)}
                          aria-label={`Expiry date for ${v.vendorName}`}
                        />
                      </label>
                      <label className="block text-sm md:col-span-2">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Evidence URL</span>
                        <Input
                          type="url"
                          value={m.evidenceUrl ?? ""}
                          onChange={(e) => setDraftField(v.id, "evidenceUrl", e.target.value)}
                          placeholder="https://drive.google.com/…"
                          aria-label={`Evidence URL for ${v.vendorName}`}
                        />
                      </label>
                      <label className="block text-sm md:col-span-2">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Scope</span>
                        <Textarea
                          rows={2}
                          value={m.scope ?? ""}
                          onChange={(e) => setDraftField(v.id, "scope", e.target.value)}
                          aria-label={`Scope for ${v.vendorName}`}
                        />
                      </label>
                      <label className="block text-sm md:col-span-2">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Notes</span>
                        <Textarea
                          rows={2}
                          value={m.notes ?? ""}
                          onChange={(e) => setDraftField(v.id, "notes", e.target.value)}
                          aria-label={`Notes for ${v.vendorName}`}
                        />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => handleSave(v)}
                        disabled={!draft[v.id]}
                        aria-label={`Save changes to ${v.vendorName}`}
                      >
                        <Save className="w-4 h-4 mr-1" aria-hidden="true" />
                        Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
