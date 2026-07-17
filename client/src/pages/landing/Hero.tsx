/**
 * Prototype reference: /acreos-landing/sections-1.jsx → Hero + HeroVisual
 *
 * Key patterns from prototype:
 * - 80px serif title with italic brand-color middle line, opsz 144
 * - Eyebrow pill with pulsing brand-color dot
 * - Sub copy at 19px max-width 580px
 * - Primary + secondary CTA buttons; "→" arrow on primary
 * - Trust pill with green dot + proof copy
 * - Three floating cards on right (Pax surfaces — analysis, drafts,
 *   servicing) with rotation + staggered fade-in animation
 * - SVG parcel-grid + radial-glow + parcel-polygon backdrop
 *
 * Patterns extrapolated:
 * - Mobile (<1100px) hides the floating cards (the prototype is desktop-only;
 *   stacking three rotated cards under the hero copy on a phone would be
 *   overwhelming; follow-up sections illustrate the agents instead)
 * - Title font-size scales with clamp(48px, 7vw, 80px) for responsive
 *
 * CTA links wire to production routes: primary → /auth?mode=register;
 * secondary → /tools/parcel-check (the public streaming proof — a stranger
 * watches real government data resolve source-by-source, no signup. The proof
 * sells; the result page carries the signup CTA). The old secondary "#how"
 * anchor promised a demo the product can't deliver as video — the parcel-check
 * IS the demo.
 */

import { Link } from "wouter";
import { LANDING_COPY } from "./copy";
import { emitMarketingTouch } from "@/lib/marketing-touch";

export function Hero() {
  const c = LANDING_COPY.hero;
  return (
    <section className="lp-hero">
      {/* Backdrop: parcel grid + radial brand glow + parcel polygons */}
      <div className="lp-hero-bg" aria-hidden="true">
        <svg
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 1200 700"
        >
          <defs>
            <pattern id="parcel-grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path
                d="M 60 0 L 0 0 0 60"
                fill="none"
                stroke="rgba(80,40,15,0.06)"
                strokeWidth="0.5"
              />
            </pattern>
            <radialGradient id="hero-glow" cx="50%" cy="20%" r="60%">
              <stop offset="0%" stopColor="rgba(194,83,28,0.08)" />
              <stop offset="100%" stopColor="rgba(194,83,28,0)" />
            </radialGradient>
          </defs>
          <rect width="1200" height="700" fill="url(#parcel-grid)" />
          <rect width="1200" height="700" fill="url(#hero-glow)" />
          <g opacity="0.18" fill="none" stroke="#C2531C" strokeWidth="1">
            <path d="M 120 420 L 280 410 L 290 540 L 130 550 Z" />
            <path d="M 280 410 L 460 405 L 475 545 L 290 540 Z" />
            <path d="M 900 380 L 1080 390 L 1070 510 L 890 500 Z" />
            <path d="M 720 200 L 880 195 L 890 320 L 730 325 Z" />
          </g>
        </svg>
      </div>

      <div className="lp-hero-inner">
        <div className="lp-hero-eyebrow">
          <span className="lp-hero-pulse" aria-hidden="true" />
          {c.eyebrow}
        </div>
        <h1 className="lp-hero-title">
          <span className="lp-hero-line" style={{ animationDelay: "0.1s" }}>
            {c.title[0]}
          </span>
          <span className="lp-hero-line" style={{ animationDelay: "0.18s" }}>
            {c.title[1]}
          </span>
        </h1>
        <p className="lp-hero-wedge">{c.wedge}</p>
        <div className="lp-hero-cta">
          <Link
            href="/auth?mode=register"
            className="lp-btn lp-btn-primary lp-btn-lg lp-btn-arrow"
            onClick={() =>
              emitMarketingTouch({
                surface: "landing:hero",
                eventType: "cta_click",
                payload: { ctaId: "hero_primary" },
              })
            }
          >
            {c.cta1}
          </Link>
          <Link
            href="/tools/parcel-check?utm_source=landing&utm_medium=internal&utm_campaign=hero_proof"
            className="lp-btn lp-btn-secondary lp-btn-lg"
            onClick={() =>
              emitMarketingTouch({
                surface: "landing:hero",
                eventType: "cta_click",
                payload: { ctaId: "hero_secondary_parcel_check" },
              })
            }
          >
            {c.cta2}
          </Link>
        </div>
        <div className="lp-hero-ctasub">{c.ctaSub}</div>
        {c.proof ? (
          <div className="lp-hero-proof">
            <span className="lp-hero-dot" aria-hidden="true" />
            {c.proof}
          </div>
        ) : null}
        {/* The honest trust band — the category leads with user counts and
            press logos; pre-launch we lead with the verifiable data spine. */}
        <div className="lp-hero-agencies" data-testid="hero-agency-band">
          <span className="lp-hero-agencies-label">{c.agenciesLabel}</span>
          <ul className="lp-hero-agencies-list" role="list">
            {c.agencies.map((a) => (
              <li key={a} className="lp-hero-agency">{a}</li>
            ))}
          </ul>
        </div>
      </div>

      <HeroVisual />
    </section>
  );
}

/**
 * HERO_DEMO_FIXTURES — ILLUSTRATIVE, NOT REAL DATA.
 *
 * Every value below is a hand-authored example of the *shape* of Pax output,
 * not a measurement, a real parcel, a real comp, or a real customer. The hero
 * cards exist to show "this is what a Pax result looks like," so each card
 * carries a visible "Example · representative output" chip and the whole visual
 * is `aria-hidden` (it is decoration, never announced to assistive tech). These
 * literals live here, clearly labeled, so no one mistakes them for live figures
 * or copies them into product surfaces as truth.
 */
const HERO_DEMO_FIXTURES = {
  comp: {
    apn: "APN 304-12-456",
    comparableSales: "14",
    medianPerAcre: "$2,840",
    confidence: "High · 87%",
    confidenceWidth: "87%",
  },
  reply: {
    to: "To: Janet Ruiz · Coconino County",
    inbound: `"What's your best offer? I have another buyer."`,
    draft: `"Hi Janet — I can do $14,200 cash, 14-day close. That's 12% above the median for parcels your size in Coconino. Happy to email a written offer."`,
  },
  servicing: {
    note: "Note #2204-A",
    paymentReceived: "$487.50",
    receiptSent: "Emailed to buyer",
    nextDue: "Jun 1",
  },
} as const;

/** Quiet "this is an example, not live data" chip for each hero card. */
function HeroExampleChip() {
  return (
    <span
      style={{
        font: "600 9px/1 var(--font-sans)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: "var(--acr-ink-3)",
        background: "var(--acr-line-soft)",
        borderRadius: "999px",
        padding: "3px 7px",
        alignSelf: "flex-start",
        marginBottom: "8px",
      }}
    >
      Example · representative output
    </span>
  );
}

function HeroVisual() {
  const f = HERO_DEMO_FIXTURES;
  return (
    <div className="lp-hero-visual" aria-hidden="true">
      <div className="lp-hero-card lp-hv-atlas" style={{ display: "flex", flexDirection: "column" }}>
        <HeroExampleChip />
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-pax-av">P</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Pax · Comp analysis</div>
            <div className="lp-hv-role">{f.comp.apn}</div>
          </div>
          <span className="lp-hv-badge lp-hv-badge-done">Example result</span>
        </div>
        <div className="lp-hv-row"><span>Comparable sales found</span><b>{f.comp.comparableSales}</b></div>
        <div className="lp-hv-row"><span>Median $/acre</span><b>{f.comp.medianPerAcre}</b></div>
        <div className="lp-hv-row"><span>Confidence</span><b className="lp-hv-conf-high">{f.comp.confidence}</b></div>
        <div className="lp-hv-bar"><div className="lp-hv-bar-fill" style={{ width: f.comp.confidenceWidth }} /></div>
      </div>

      <div className="lp-hero-card lp-hv-pax" style={{ display: "flex", flexDirection: "column" }}>
        <HeroExampleChip />
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-pax-av">P</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Pax · Drafted reply</div>
            <div className="lp-hv-role">{f.reply.to}</div>
          </div>
        </div>
        <div className="lp-hv-msg">
          <span className="lp-hv-msg-from">Janet:</span>
          {f.reply.inbound}
        </div>
        <div className="lp-hv-msg lp-hv-msg-out">
          <span className="lp-hv-msg-from">Pax draft:</span>
          {f.reply.draft}
        </div>
        <div className="lp-hv-actions">
          <span className="lp-hv-action">Send as-is</span>
          <span className="lp-hv-action lp-hv-action-soft">Edit</span>
          <span className="lp-hv-action lp-hv-action-soft">Why this price?</span>
        </div>
      </div>

      <div className="lp-hero-card lp-hv-sophie" style={{ display: "flex", flexDirection: "column" }}>
        <HeroExampleChip />
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-pax-av">P</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Pax · Note serviced</div>
            <div className="lp-hv-role">{f.servicing.note}</div>
          </div>
          <span className="lp-hv-badge lp-hv-badge-done">Done</span>
        </div>
        <div className="lp-hv-row"><span>Payment received</span><b>{f.servicing.paymentReceived}</b></div>
        <div className="lp-hv-row"><span>Receipt sent</span><b>{f.servicing.receiptSent}</b></div>
        <div className="lp-hv-row"><span>Next due</span><b>{f.servicing.nextDue}</b></div>
      </div>
    </div>
  );
}
