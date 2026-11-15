/**
 * PAD HOME & METERS — the mobile-home side of ONE pad.
 *
 * Opened from a pad's row on the Units tab of /leases (UnitsPanel): a dialog
 * behind an existing tab, never a route or a nav entry — the five customer
 * doors are fixed.
 *
 * It is the first client caller of three mobile-home endpoints that shipped in
 * Wave 5 with none (W2-MHP, 2026-11-06):
 *   PATCH /api/rentals/units/:id/mobile-home  who owns the home (POH/TOH) + its title record
 *   GET   /api/rentals/units/:id/meter-reads  the pad's recorded submeter reads
 *   POST  /api/rentals/units/:id/meter-reads  record one (same utility + date replaces it)
 *
 * RECORD-ONLY. Every field is what the operator enters, stored as entered: a
 * title is never checked against a DMV or registry, and a meter read is a face
 * value with its date. Nothing here computes or posts a utility charge or a
 * lot-vs-home rent split — those engines have no screen (stopped in W2-MHP), so
 * this dialog must not imply either. A blank is a real answer ("not recorded")
 * and goes on the wire as null, never as a guessed value.
 *
 * Native labelled <select>s rather than Radix: the bundle sits at its ceiling,
 * and a native select is accessible and keyboard-operable by construction.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

/** The pad facts this dialog edits — the units list already returns them. */
export interface PadHome {
  id: string;
  label: string;
  homeOwnership?: string | null;
  chattelTitleType?: string | null;
  chattelVin?: string | null;
  chattelTitleStatus?: string | null;
  chattelTitleNotes?: string | null;
}

interface MeterRead {
  id: string;
  utilityKind: string;
  readOn: string;
  /** numeric column — arrives as a string and is shown exactly as recorded. */
  reading: string;
  notes: string | null;
}

const UTILITIES = ["water", "sewer", "trash", "electric", "gas"];
const SELECT =
  "mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Blank → null: "not recorded", never a stand-in value. */
const orNull = (s: string) => s.trim() || null;

export function PadHomeDialog({ pad, onClose }: { pad: PadHome; onClose: () => void }) {
  const { toast } = useToast();
  const fail = (e: unknown) =>
    toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" });

  const [owner, setOwner] = useState(pad.homeOwnership ?? "");
  const [titleType, setTitleType] = useState(pad.chattelTitleType ?? "");
  const [vin, setVin] = useState(pad.chattelVin ?? "");
  const [titleStatus, setTitleStatus] = useState(pad.chattelTitleStatus ?? "");
  const [titleNotes, setTitleNotes] = useState(pad.chattelTitleNotes ?? "");
  const [utility, setUtility] = useState("");
  const [readOn, setReadOn] = useState("");
  const [reading, setReading] = useState("");
  const [readNotes, setReadNotes] = useState("");

  const readsUrl = `/api/rentals/units/${pad.id}/meter-reads`;
  const reads = useQuery<{ reads: MeterRead[] }>({ queryKey: [readsUrl] });
  const list = reads.data?.reads ?? [];

  const save = useMutation({
    mutationFn: async (): Promise<{ record?: string }> =>
      (
        await apiRequest("PATCH", `/api/rentals/units/${pad.id}/mobile-home`, {
          homeOwnership: orNull(owner),
          chattelTitleType: orNull(titleType),
          chattelVin: orNull(vin),
          chattelTitleStatus: orNull(titleStatus),
          chattelTitleNotes: orNull(titleNotes),
        })
      ).json(),
    onSuccess: (r) => {
      // The pad's row shows POH/TOH, so every unit list is stale now.
      queryClient.invalidateQueries({ queryKey: ["/api/rentals/properties"] });
      // The server's own sentence: a record, not a verification.
      toast({ title: "Home record saved", description: r.record });
    },
    onError: fail,
  });

  const value = Number(reading);
  const canRecord = utility !== "" && readOn !== "" && reading.trim() !== "" && Number.isFinite(value) && value >= 0;
  const record = useMutation({
    mutationFn: () =>
      apiRequest("POST", readsUrl, { utilityKind: utility, readOn, reading: value, notes: orNull(readNotes) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [readsUrl] });
      setReading("");
      setReadNotes("");
      toast({ title: "Meter read recorded" });
    },
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="pad-home-dialog">
        <DialogHeader>
          <DialogTitle>{pad.label}: home and meters</DialogTitle>
          <DialogDescription>
            Your record of the home on this pad and its meter reads, kept exactly as you enter them.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-3 sm:grid-cols-2">
          <h3 className="sm:col-span-2 text-sm font-medium">Home on this pad</h3>
          <div>
            <Label htmlFor="pad-owner" className="text-xs">Who owns the home</Label>
            <select id="pad-owner" className={SELECT} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Not recorded</option>
              <option value="park_owned">The park (POH)</option>
              <option value="tenant_owned">The resident (TOH)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="pad-title-type" className="text-xs">Title</Label>
            <select id="pad-title-type" className={SELECT} value={titleType} onChange={(e) => setTitleType(e.target.value)}>
              <option value="">Not recorded</option>
              <option value="dmv_vin">DMV title (VIN)</option>
              <option value="real_property">Real-property title</option>
            </select>
          </div>
          <div>
            <Label htmlFor="pad-vin" className="text-xs">VIN</Label>
            <Input id="pad-vin" value={vin} onChange={(e) => setVin(e.target.value)} className="h-9 mt-1" maxLength={64} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="pad-title-status" className="text-xs">Title status</Label>
            <Input id="pad-title-status" value={titleStatus} onChange={(e) => setTitleStatus(e.target.value)} className="h-9 mt-1" maxLength={120} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pad-title-notes" className="text-xs">Title notes</Label>
            <Textarea id="pad-title-notes" value={titleNotes} onChange={(e) => setTitleNotes(e.target.value)} className="mt-1" rows={2} maxLength={2000} />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-micro text-muted-foreground">Not checked against any DMV or title registry.</p>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} data-testid="pad-home-save">
              Save home record
            </Button>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Meter reads</h3>
          {reads.isLoading ? (
            <div className="space-y-2" data-testid="meter-reads-loading">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : reads.isError ? (
            <QueryErrorState
              error={reads.error instanceof Error ? reads.error : null}
              onRetry={() => reads.refetch()}
              isRetrying={reads.isRefetching}
              compact
              title="Couldn't load this pad's meter reads"
              testId="meter-reads-error"
            />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Gauge}
              headline="No meter reads recorded"
              subtitle="Record each read with its date and the number on the meter's face."
              /* TODO(cta): the record form sits directly below this state. */
              cta={{ label: "", _noOp: true }}
              testId="meter-reads-empty"
            />
          ) : (
            <table className="w-full text-sm" data-testid="meter-reads-table">
              <caption className="sr-only">Meter reads for {pad.label}</caption>
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th scope="col" className="px-2 py-1 text-left font-medium">Read on</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Utility</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Reading</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-border/40" data-testid={`meter-read-${r.id}`}>
                    <td className="px-2 py-1 tabular-nums">{r.readOn}</td>
                    <td className="px-2 py-1">{cap(r.utilityKind)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.reading}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div>
              <Label htmlFor="read-utility" className="text-xs">Utility</Label>
              <select id="read-utility" className={SELECT} value={utility} onChange={(e) => setUtility(e.target.value)}>
                <option value="">Choose…</option>
                {UTILITIES.map((u) => (
                  <option key={u} value={u}>{cap(u)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="read-on" className="text-xs">Read on</Label>
              <Input id="read-on" type="date" value={readOn} onChange={(e) => setReadOn(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label htmlFor="read-value" className="text-xs">Reading</Label>
              <Input id="read-value" type="number" min={0} step="any" value={reading} onChange={(e) => setReading(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label htmlFor="read-notes" className="text-xs">Notes</Label>
              <Input id="read-notes" value={readNotes} onChange={(e) => setReadNotes(e.target.value)} className="h-9 mt-1" maxLength={2000} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-micro text-muted-foreground">Recording the same utility on the same date replaces that read.</p>
            <Button size="sm" disabled={!canRecord || record.isPending} onClick={() => record.mutate()} data-testid="meter-read-submit">
              Record read
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
