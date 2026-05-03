/**
 * Phase 3 Week 11 — Founder legal-hold operator UI.
 *
 * Lists every FRCP 37(e) legal hold (active + released), surfaces the
 * "place a hold" form, and gates release behind a 2-step confirmation
 * (long-form justification + literal confirm string).
 *
 * Every action audit-logs server-side via `/api/founder/legal-holds*`.
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
import { ShieldAlert, Lock, Unlock, AlertTriangle } from "lucide-react";

type LegalHoldScope = "org_wide" | "lead_specific" | "property_specific" | "user_specific";
type LegalHoldStatus = "active" | "released";

interface LegalHold {
  id: string;
  organizationId: number;
  caseRef: string;
  scope: LegalHoldScope;
  scopeIds: string[];
  placedAt: string;
  placedBy: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  notes: string | null;
  status: LegalHoldStatus;
}

const SCOPE_LABEL: Record<LegalHoldScope, string> = {
  org_wide: "Org-wide",
  lead_specific: "Specific leads",
  property_specific: "Specific properties",
  user_specific: "Specific users",
};

const STATUS_VARIANT: Record<LegalHoldStatus, "default" | "destructive" | "outline"> = {
  active: "destructive",
  released: "outline",
};

interface PlaceForm {
  organizationId: string;
  caseRef: string;
  scope: LegalHoldScope;
  scopeIds: string;
  notes: string;
}

interface ReleaseForm {
  reason: string;
  confirm: string;
}

const RELEASE_CONFIRM_PHRASE = "RELEASE LEGAL HOLD";

export default function FounderLegalHoldsPage() {
  const { toast } = useToast();
  const [placeForm, setPlaceForm] = useState<PlaceForm>({
    organizationId: "",
    caseRef: "",
    scope: "org_wide",
    scopeIds: "",
    notes: "",
  });
  const [releaseFormById, setReleaseFormById] = useState<Record<string, ReleaseForm>>({});
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ holds: LegalHold[] }>({
    queryKey: ["/api/founder/legal-holds"],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/founder/legal-holds"] });

  const placeMutation = useMutation({
    mutationFn: async (body: {
      organizationId: number;
      caseRef: string;
      scope: LegalHoldScope;
      scopeIds: string[];
      notes?: string;
    }) => {
      const res = await apiRequest("POST", "/api/founder/legal-holds", body);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? "Place failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Legal hold placed" });
      setPlaceForm({ organizationId: "", caseRef: "", scope: "org_wide", scopeIds: "", notes: "" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Place failed", description: err.message, variant: "destructive" });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async ({ id, reason, confirm }: { id: string; reason: string; confirm: string }) => {
      const res = await apiRequest("POST", `/api/founder/legal-holds/${id}/release`, { reason, confirm });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? "Release failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Hold released" });
      setReleasingId(null);
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Release failed", description: err.message, variant: "destructive" });
    },
  });

  const handlePlaceSubmit = () => {
    const orgId = Number(placeForm.organizationId);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      toast({ title: "Invalid organization id", variant: "destructive" });
      return;
    }
    if (placeForm.caseRef.trim().length < 2) {
      toast({ title: "caseRef is required", variant: "destructive" });
      return;
    }
    const scopeIds = placeForm.scopeIds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (placeForm.scope !== "org_wide" && scopeIds.length === 0) {
      toast({ title: "scopeIds required for non-org-wide holds", variant: "destructive" });
      return;
    }
    placeMutation.mutate({
      organizationId: orgId,
      caseRef: placeForm.caseRef.trim(),
      scope: placeForm.scope,
      scopeIds,
      notes: placeForm.notes.trim() || undefined,
    });
  };

  const handleReleaseSubmit = (id: string) => {
    const form = releaseFormById[id] ?? { reason: "", confirm: "" };
    if (form.reason.trim().length < 20) {
      toast({ title: "Justification must be at least 20 characters", variant: "destructive" });
      return;
    }
    if (form.confirm !== RELEASE_CONFIRM_PHRASE) {
      toast({
        title: "Confirmation phrase incorrect",
        description: `Type "${RELEASE_CONFIRM_PHRASE}" to confirm`,
        variant: "destructive",
      });
      return;
    }
    releaseMutation.mutate({ id, reason: form.reason.trim(), confirm: form.confirm });
  };

  const holds = data?.holds ?? [];
  const activeHolds = holds.filter((h) => h.status === "active");
  const releasedHolds = holds.filter((h) => h.status === "released");

  return (
    <PageShell
      title="Legal Holds"
      description="FRCP 37(e) data-preservation orders. Active holds block automatic retention sweeps and storage-layer deletes."
    >
      {/* Place new hold */}
      <Card className="mb-6 border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" aria-hidden="true" />
            Place new legal hold
          </CardTitle>
          <CardDescription>
            Placing a hold immediately blocks deletion of covered data. Every retention sweep, soft-delete, and
            permadelete path will refuse to fire until the hold is released.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="lh-org">
                Organization id
              </label>
              <Input
                id="lh-org"
                type="number"
                inputMode="numeric"
                placeholder="e.g. 42"
                value={placeForm.organizationId}
                onChange={(e) => setPlaceForm((f) => ({ ...f, organizationId: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="lh-case">
                Case reference
              </label>
              <Input
                id="lh-case"
                placeholder="Court docket / matter # / internal ticket"
                value={placeForm.caseRef}
                onChange={(e) => setPlaceForm((f) => ({ ...f, caseRef: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="lh-scope">
                Scope
              </label>
              <Select
                value={placeForm.scope}
                onValueChange={(v) => setPlaceForm((f) => ({ ...f, scope: v as LegalHoldScope }))}
              >
                <SelectTrigger id="lh-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCOPE_LABEL) as LegalHoldScope[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="lh-ids">
                Scope ids (comma-separated, ignored for org-wide)
              </label>
              <Input
                id="lh-ids"
                placeholder="123,456,789"
                disabled={placeForm.scope === "org_wide"}
                value={placeForm.scopeIds}
                onChange={(e) => setPlaceForm((f) => ({ ...f, scopeIds: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="lh-notes">
              Notes (optional)
            </label>
            <Textarea
              id="lh-notes"
              placeholder="Brief context — counsel, anticipated litigation, retention scope rationale."
              value={placeForm.notes}
              onChange={(e) => setPlaceForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
            />
          </div>
          <Button
            onClick={handlePlaceSubmit}
            disabled={placeMutation.isPending}
            variant="destructive"
            aria-label="Place legal hold"
          >
            <Lock className="h-4 w-4 mr-2" aria-hidden="true" />
            {placeMutation.isPending ? "Placing…" : "Place legal hold"}
          </Button>
        </CardContent>
      </Card>

      {/* Active holds */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
            Active holds ({activeHolds.length})
          </CardTitle>
          <CardDescription>
            Releasing a hold requires a written justification and the confirmation phrase{" "}
            <code className="px-1 rounded bg-muted">{RELEASE_CONFIRM_PHRASE}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <Skeleton className="h-24 w-full" />}
          {error && (
            <div className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Failed to load holds.
            </div>
          )}
          {!isLoading && activeHolds.length === 0 && (
            <p className="text-sm text-muted-foreground">No active legal holds.</p>
          )}
          {activeHolds.map((h) => {
            const isReleasing = releasingId === h.id;
            const form = releaseFormById[h.id] ?? { reason: "", confirm: "" };
            return (
              <div key={h.id} className="border rounded p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={STATUS_VARIANT[h.status]}>{h.status}</Badge>
                    <span className="font-medium">{h.caseRef}</span>
                    <Badge variant="outline">{SCOPE_LABEL[h.scope]}</Badge>
                    <span className="text-sm text-muted-foreground">org #{h.organizationId}</span>
                    <span className="text-sm text-muted-foreground">
                      placed {new Date(h.placedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {!isReleasing && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReleasingId(h.id)}
                      aria-label={`Release legal hold ${h.caseRef}`}
                    >
                      <Unlock className="h-4 w-4 mr-1" aria-hidden="true" />
                      Release
                    </Button>
                  )}
                </div>
                {h.scope !== "org_wide" && h.scopeIds.length > 0 && (
                  <p className="text-xs text-muted-foreground break-all">ids: {h.scopeIds.join(", ")}</p>
                )}
                {h.notes && <p className="text-sm">{h.notes}</p>}
                {isReleasing && (
                  <div className="border-t pt-3 space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor={`reason-${h.id}`}>
                        Justification (≥ 20 chars)
                      </label>
                      <Textarea
                        id={`reason-${h.id}`}
                        rows={3}
                        value={form.reason}
                        onChange={(e) =>
                          setReleaseFormById((s) => ({
                            ...s,
                            [h.id]: { ...form, reason: e.target.value },
                          }))
                        }
                        placeholder="Counsel cleared. Litigation resolved. Document retention obligation has ended."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor={`confirm-${h.id}`}>
                        Type{" "}
                        <code className="px-1 rounded bg-muted">{RELEASE_CONFIRM_PHRASE}</code> to confirm
                      </label>
                      <Input
                        id={`confirm-${h.id}`}
                        value={form.confirm}
                        onChange={(e) =>
                          setReleaseFormById((s) => ({
                            ...s,
                            [h.id]: { ...form, confirm: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        onClick={() => handleReleaseSubmit(h.id)}
                        disabled={releaseMutation.isPending}
                      >
                        {releaseMutation.isPending ? "Releasing…" : "Confirm release"}
                      </Button>
                      <Button variant="ghost" onClick={() => setReleasingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Released holds */}
      <Card>
        <CardHeader>
          <CardTitle>Released holds ({releasedHolds.length})</CardTitle>
          <CardDescription>Historical record. Released rows are append-only and never re-opened.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isLoading && releasedHolds.length === 0 && (
            <p className="text-sm text-muted-foreground">No released holds yet.</p>
          )}
          {releasedHolds.map((h) => (
            <div key={h.id} className="border rounded p-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge variant="outline">released</Badge>
                <span className="font-medium">{h.caseRef}</span>
                <Badge variant="outline">{SCOPE_LABEL[h.scope]}</Badge>
                <span className="text-muted-foreground">org #{h.organizationId}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                placed {new Date(h.placedAt).toLocaleDateString()} · released{" "}
                {h.releasedAt ? new Date(h.releasedAt).toLocaleDateString() : "—"}
              </p>
              {h.releaseReason && <p className="mt-1">{h.releaseReason}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
