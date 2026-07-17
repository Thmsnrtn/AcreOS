/**
 * ProductShots — simulated product screenshots as RENDERED UI, not images.
 *
 * The landing benchmark pass (2026-07-17) found the one hero pattern elite
 * pages share that we lacked: showing the actual product. Real screenshots
 * wait for a key-lit, populated account; until then these frames depict the
 * three surfaces a customer lives in — the Map door's parcel-intelligence
 * panel, the Today decision queue, and a Pax thread — rebuilt in landing CSS
 * so they stay crisp at any DPI and can never rot into a stale PNG.
 *
 * HOUSE RULE (no fabricated data shown as real): every value below is a
 * hand-authored illustration of the SHAPE of product output, same contract as
 * HERO_DEMO_FIXTURES in Hero.tsx. Each frame carries a visible
 * "Example · representative output" chip, the section subline says so in
 * plain words, and the whole visual band is aria-hidden decoration — the
 * section's accessible content is its heading, subline, and CTA.
 */

import type { ReactNode } from "react";
import { Link } from "wouter";
import { LANDING_COPY } from "./copy";
import { emitMarketingTouch } from "@/lib/marketing-touch";

/** Same quiet chip as the hero cards — one honest label per frame. */
function ExampleChip() {
  return <span className="lp-shot-chip">Example · representative output</span>;
}

/** Browser-style chrome so each depiction reads instantly as "the app". */
function Frame({
  url,
  label,
  children,
  wide,
}: {
  url: string;
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <figure className={wide ? "lp-shot lp-shot-wide" : "lp-shot"}>
      <div className="lp-shot-chrome">
        <span className="lp-shot-dot" />
        <span className="lp-shot-dot" />
        <span className="lp-shot-dot" />
        <span className="lp-shot-url">{url}</span>
      </div>
      <div className="lp-shot-body">
        <ExampleChip />
        {children}
      </div>
      <figcaption className="lp-shot-caption">{label}</figcaption>
    </figure>
  );
}

/** The Map door — parcel map + the intelligence panel with the LCS read. */
function MapShot() {
  return (
    <Frame url="app.acreos.io/maps" label="Map — every parcel carries its Land Credit Score" wide>
      <div className="lp-shot-map-layout">
        <div className="lp-shot-map">
          <svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="300" height="190" className="lp-shot-map-bg" />
            <g className="lp-shot-map-parcels">
              <path d="M 18 40 L 96 34 L 102 96 L 24 102 Z" />
              <path d="M 96 34 L 176 30 L 184 92 L 102 96 Z" />
              <path d="M 24 102 L 102 96 L 108 158 L 30 164 Z" />
              <path d="M 184 92 L 262 88 L 268 150 L 190 154 Z" />
            </g>
            <path d="M 102 96 L 184 92 L 190 154 L 108 158 Z" className="lp-shot-map-active" />
            <circle cx="146" cy="125" r="5" className="lp-shot-map-pin" />
          </svg>
        </div>
        <div className="lp-shot-panel">
          <div className="lp-shot-panel-head">
            <span className="lp-shot-apn">APN 304-12-456 · 11.3 ac</span>
            <span className="lp-shot-lcs">
              742 <em>B+</em>
            </span>
          </div>
          <div className="lp-shot-row"><span>Est. value</span><b>$31,900</b></div>
          <div className="lp-shot-row"><span>$ / acre</span><b>$2,840</b></div>
          <div className="lp-shot-row"><span>Flood zone</span><b>X — minimal</b></div>
          <div className="lp-shot-row"><span>Soil class</span><b>Class III · well drained</b></div>
          <div className="lp-shot-row"><span>Road access</span><b>County-maintained</b></div>
        </div>
      </div>
    </Frame>
  );
}

/** The Today door — the decision queue the operator clears each morning. */
function TodayShot() {
  return (
    <Frame url="app.acreos.io/today" label="Today — the work, already triaged">
      <div className="lp-shot-queue">
        <div className="lp-shot-queue-item">
          <span className="lp-shot-queue-tag lp-shot-tag-reply">Reply drafted</span>
          <p>Janet R. asked for your best offer — draft ready to approve.</p>
        </div>
        <div className="lp-shot-queue-item">
          <span className="lp-shot-queue-tag lp-shot-tag-offer">Offer ready</span>
          <p>12.6 ac in Coconino priced from comps — send or edit.</p>
        </div>
        <div className="lp-shot-queue-item">
          <span className="lp-shot-queue-tag lp-shot-tag-mail">Mail queued</span>
          <p>214-piece batch scrubbed and scheduled for Thursday.</p>
        </div>
        <div className="lp-shot-queue-done">2 items finished overnight — logged with receipts</div>
      </div>
    </Frame>
  );
}

/** The Pax door — the seller thread with a draft waiting for one tap. */
function PaxShot() {
  return (
    <Frame url="app.acreos.io/ai" label="Pax — drafts wait for your tap, nothing sends itself">
      <div className="lp-shot-thread">
        <div className="lp-shot-msg lp-shot-msg-in">
          <span>Seller</span>
          <p>“Would you take $16,000 if we close this month?”</p>
        </div>
        <div className="lp-shot-msg lp-shot-msg-out">
          <span>Pax draft</span>
          <p>“I can do $15,400 cash with a 14-day close — that's above the county median for your acreage. Want a written offer today?”</p>
        </div>
        <div className="lp-shot-thread-actions">
          <span className="lp-shot-action-primary">Send as-is</span>
          <span className="lp-shot-action">Edit</span>
          <span className="lp-shot-action">Why this price?</span>
        </div>
      </div>
    </Frame>
  );
}

export function ProductShots() {
  const c = LANDING_COPY.productShots;
  return (
    <section className="lp-section lp-shots-section" id="product">
      <div className="lp-section-inner">
        <div className="lp-eyebrow">{c.eyebrow}</div>
        <h2 className="lp-h2">{c.title}</h2>
        <p className="lp-section-sub">{c.sub}</p>

        {/* Decorative depictions — the honest labels are baked into each
            frame; assistive tech gets the heading + subline + CTA instead. */}
        <div className="lp-shots" aria-hidden="true">
          <MapShot />
          <TodayShot />
          <PaxShot />
        </div>

        <div className="lp-shots-cta">
          <Link
            href="/tools/parcel-check?utm_source=landing&utm_medium=internal&utm_campaign=product_shots"
            className="lp-btn lp-btn-secondary"
            onClick={() =>
              emitMarketingTouch({
                surface: "landing:product-shots",
                eventType: "cta_click",
                payload: { ctaId: "product_shots_parcel_check" },
              })
            }
          >
            {c.proofCta}
          </Link>
        </div>
      </div>
    </section>
  );
}
