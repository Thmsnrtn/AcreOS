/**
 * Verified land facts for a parcel AcreOS keeps — the "Carfax for land"
 * section of the public parcel report (W3).
 *
 * Renders exactly what the server's accuracy-gated projection sent
 * (PublicLandFacts): each shown fact with its source, retrieval date and
 * confidence; every other fact as "Not available" with its reason; then the
 * data-truth warnings. It computes nothing itself.
 */
import { AlertTriangle, CheckCircle2, Info, MinusCircle } from "lucide-react";
import { NOT_AVAILABLE, type PublicLandFacts } from "@shared/landData/publicFactText";

function TruthIcon({ severity }: { severity: "info" | "caution" | "warning" }) {
  if (severity === "warning") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />;
  if (severity === "caution") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function LandFactsSection({ land }: { land: PublicLandFacts }) {
  return (
    <div className="space-y-8" data-testid="land-facts">
      <section aria-labelledby="land-facts-heading">
        <h2 id="land-facts-heading" className="text-lg font-semibold text-foreground">
          Verified land facts
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only facts that passed AcreOS's accuracy check on hand-checked parcels are shown, each with
          its source, date and confidence. Anything else says "{NOT_AVAILABLE}" — it is never estimated.
          Parcel record: {land.source.name}
          {land.source.retrievedOn ? `, retrieved ${land.source.retrievedOn}` : ""}.
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {land.rows.map((r) =>
            r.status === "shown" ? (
              <li key={r.key} className="rounded-lg border border-border bg-card p-4" data-testid={`land-fact-${r.key}`}>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  {r.label}
                </h3>
                <p className="mt-2 text-base font-medium leading-snug text-foreground">{r.text}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Confidence: {r.confidence}. Source:{" "}
                  {r.sources.map((s, i) => (
                    <span key={`${s.name}-${i}`}>
                      {i > 0 ? "; " : ""}
                      <a
                        href={s.url}
                        rel="nofollow noopener noreferrer"
                        target="_blank"
                        className="underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        {s.name}
                      </a>{" "}
                      (retrieved {s.retrievedOn}
                      {s.sourceAsOf ? `, edition ${s.sourceAsOf}` : ""})
                    </span>
                  ))}
                </p>
                {r.accuracy && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Accuracy check: {r.accuracy.agreed} of {r.accuracy.sampleSize} hand-checked parcels agreed
                    {r.accuracy.verifiedOn ? ` (${r.accuracy.verifiedOn})` : ""}.
                  </p>
                )}
              </li>
            ) : (
              <li key={r.key} className="rounded-lg border border-dashed border-border bg-muted/30 p-4" data-testid={`land-fact-${r.key}`}>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                  <MinusCircle className="h-4 w-4" aria-hidden="true" />
                  {r.label}
                </h3>
                <p className="mt-2 text-base font-medium text-muted-foreground">{NOT_AVAILABLE}</p>
                {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
              </li>
            ),
          )}
        </ul>
      </section>

      <section aria-labelledby="land-truths-heading">
        <h2 id="land-truths-heading" className="text-lg font-semibold text-foreground">
          What this data cannot tell you
        </h2>
        <ul className="mt-3 space-y-3">
          {land.truths.map((t) => (
            <li key={t.key} className="flex gap-2 text-sm text-foreground" data-testid={`land-truth-${t.key}`}>
              <TruthIcon severity={t.severity} />
              <span>
                {t.message}{" "}
                {t.link && (
                  <a
                    href={t.link.url}
                    rel="nofollow noopener noreferrer"
                    target="_blank"
                    className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {t.link.label}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {land.taxSaleSources.length > 0 && (
        <section aria-labelledby="land-taxsale-heading">
          <h2 id="land-taxsale-heading" className="text-lg font-semibold text-foreground">
            Tax-sale and delinquency pages for {land.countyLabel} County
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {land.taxSaleSources.map((t) => (
              <li key={t.url}>
                <a
                  href={t.url}
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                  className="text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {t.office}
                </a>{" "}
                <span className="text-muted-foreground">
                  — {t.pageSays} (checked {t.checkedOn}
                  {t.reachable ? "" : "; refused an automated request"})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
