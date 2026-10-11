/**
 * Buy the per-parcel due-diligence report (W3) — inside the Map door's land
 * facts panel. The price ships UNSET (founder decision), so until it is set
 * this shows the server's plain refusal and no buy button. When priced, the
 * purchase runs on the existing credit rail and returns the same gated facts.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Offer =
  | { available: false; reason: string; message: string }
  | { available: true; priceCents: number; rail: "credits"; alreadyPurchased: boolean };

export function DdReportPurchase({ parcelKey }: { parcelKey: string }) {
  const qc = useQueryClient();
  const key = ["dd-report-offer", parcelKey];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery<Offer>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/land-data/parcels/${encodeURIComponent(parcelKey)}/dd-report/offer`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the report offer (${res.status})`);
      return res.json();
    },
  });

  async function buy() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/land-data/parcels/${encodeURIComponent(parcelKey)}/dd-report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.message === "string" ? body.message : "The report could not be bought.");
      const blob = new Blob([JSON.stringify(body.report, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `acreos-dd-report-${parcelKey}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(body.charged ? "Report bought and downloaded." : "Report downloaded again (already bought, no charge).");
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "The report could not be bought.");
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading || q.isError || !q.data) return null;
  return (
    <div className="rounded-md border border-border p-3 text-xs" data-testid="dd-report-purchase">
      <p className="flex items-center gap-1.5 font-medium">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        Due-diligence report
      </p>
      {q.data.available ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={buy} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {q.data.alreadyPurchased
              ? "Download again"
              : `Buy for ${(q.data.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} in credits`}
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-muted-foreground" data-testid="dd-report-unavailable">
          {q.data.message}
        </p>
      )}
      {msg && (
        <p role="status" className="mt-2">
          {msg}
        </p>
      )}
    </div>
  );
}
