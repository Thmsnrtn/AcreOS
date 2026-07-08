/**
 * StateUplBanner — the shared UPL / assignment-disclosure banner.
 *
 * Reads the single source-of-truth table in lib/upl-gating.ts and renders the
 * block-vs-warn banner. Consumed by BOTH the full blind-offer wizard and the
 * inline blind-offer composer on the Map door, so a Land Investor sees the
 * identical legal gate no matter which surface they start an offer from.
 */
import { AlertTriangle } from "lucide-react";
import { findStateWarning } from "@/lib/upl-gating";

export function StateUplBanner({ state }: { state: string }) {
  const warning = findStateWarning(state);
  if (!warning) return null;
  const isBlock = warning.severity === "block";
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-xl border p-4 ${
        isBlock
          ? "border-acr-neg/40 bg-acr-neg-soft dark:bg-acr-neg-soft/10"
          : "border-acr-warn/40 bg-acr-warn-soft dark:bg-acr-warn-soft/10"
      }`}
    >
      <div className="flex gap-3">
        <AlertTriangle
          className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isBlock ? "text-acr-neg" : "text-acr-warn"}`}
          aria-hidden="true"
        />
        <div className="text-sm">
          <p className={`font-bold mb-1 ${isBlock ? "text-acr-neg" : "text-acr-warn"}`}>
            {isBlock ? "STOP — license required in this state" : "Disclosure required before mailing"}
          </p>
          <p className={`mb-2 ${isBlock ? "text-acr-neg" : "text-acr-warn"}`}>
            {warning.headline}
          </p>
          <p className={`mb-2 text-xs ${isBlock ? "text-acr-neg/80" : "text-acr-warn/80"}`}>
            {warning.body}
          </p>
          <p className={`text-xs italic ${isBlock ? "text-acr-neg/70" : "text-acr-warn/70"}`}>
            Citation: {warning.citation}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Not legal advice. Confirm with state counsel before relying on
            this. See <a href={`/wholesaler-state-rules/${state}`} className="underline">/wholesaler-state-rules/{state}</a> for the full entry.
          </p>
        </div>
      </div>
    </div>
  );
}
