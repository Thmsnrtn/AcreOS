/**
 * DataProvenance — landing band that makes the free open-data moat visible.
 *
 * Names the government sources behind the free tier (FEMA / USDA / USGS /
 * USFWS / Census), tells the "premium government data, free; paid data when
 * you scale" story, and links to the live /tools/parcel-check widget as proof
 * a stranger can run themselves.
 *
 * Voice: mechanics-first, third-person (copy lives in copy.ts, voice-linted).
 * Styling reuses landing.css --acr-* tokens; no hardcoded color.
 *
 * Soren, 2026-06-06 — docs/internal/roadmap/_lenses/soren.md §3.
 */

import { Link } from "wouter";
import { LANDING_COPY } from "./copy";
import { emitMarketingTouch } from "@/lib/marketing-touch";

export function DataProvenance() {
  const c = LANDING_COPY.data;
  return (
    <section className="lp-section" id="data">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <p className="lp-section-sub">{c.sub}</p>

      <div className="lp-data-sources">
        {c.sources.map((s) => (
          <div key={s.agency} className="lp-data-source">
            <p className="lp-data-source-agency">{s.agency}</p>
            <p className="lp-data-source-what">{s.what}</p>
          </div>
        ))}
      </div>

      <div className="lp-data-promise">
        <p className="lp-data-promise-text">
          <strong>{c.promise}</strong>
        </p>
        <Link
          href="/tools/parcel-check?utm_source=landing&utm_medium=internal&utm_campaign=data_band"
          onClick={() =>
            emitMarketingTouch({
              surface: "landing:data-band",
              eventType: "cta_click",
              payload: { ctaId: "parcel_check_proof" },
            })
          }
          className="lp-btn lp-btn-primary lp-btn-lg"
        >
          {c.proofCta}
        </Link>
      </div>
    </section>
  );
}
