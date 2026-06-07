/**
 * DataSnapshotBand — the "What the free data shows in [place]" section.
 *
 * Renders a verified open-data rollup (FEMA NFHL flood prevalence, USDA
 * SSURGO dominant soil classes, USGS 3DEP elevation bands) as a band of
 * source-stamped cards. Shared by both the state×vertical primer
 * (state-vertical.tsx) and the county pages (county.tsx) so every public
 * data figure renders the SAME way: value + label + inline named source +
 * `asOf` date. That inline provenance is the truth/voice gate made visible —
 * no bare number ever reaches a stranger without a source next to it.
 *
 * Voice doctrine (docs/internal/marketing-os/02-voice-linter.md §3.4):
 * every numeric data claim carries a named source. This component enforces
 * that structurally — a LearnDataFigure cannot be rendered without `source`
 * and `asOf` because the type makes them required.
 */

import { ExternalLink } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { LearnDataSnapshot } from "./types";

interface DataSnapshotBandProps {
  snapshot: LearnDataSnapshot;
  /** State or county name used in the heading, e.g. "Arizona" or "Cochise County". */
  placeName: string;
}

export function DataSnapshotBand({ snapshot, placeName }: DataSnapshotBandProps) {
  // No-silent-thin-content: if a snapshot somehow arrives with zero figures,
  // render nothing rather than an empty band shell.
  if (!snapshot.figures || snapshot.figures.length === 0) return null;

  return (
    <section className="mb-10" data-testid="section-learn-data-snapshot">
      <h2 className="text-2xl font-semibold mb-2">
        What the free data shows in {placeName}
      </h2>
      <p className="text-sm text-muted-foreground mb-4" data-testid="text-data-snapshot-scope">
        {snapshot.scope} — pulled from public government datasets, the same
        free sources AcreOS runs on every parcel.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {snapshot.figures.map((fig, idx) => (
          <Card key={`data-fig-${idx}`} className="border-border/50">
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {fig.label}
              </p>
              <p className="text-xl font-semibold mb-1" data-testid={`text-data-fig-value-${idx}`}>
                {fig.value}
              </p>
              {fig.note && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  {fig.note}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {fig.sourceUrl ? (
                  <a
                    href={fig.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline hover:text-foreground inline-flex items-center gap-1"
                  >
                    {fig.source}
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-medium text-foreground">{fig.source}</span>
                )}
                <span> · as of {fig.asOf}</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-4" data-testid="text-data-snapshot-disclaimer">
        {snapshot.disclaimer}
      </p>
    </section>
  );
}
