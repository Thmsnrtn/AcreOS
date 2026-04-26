/**
 * Prototype reference: /acreos-landing/sections-1.jsx → Hero + HeroVisual
 *
 * Key patterns from prototype:
 * - 80px serif title with italic brand-color middle line, opsz 144
 * - Eyebrow pill with pulsing brand-color dot
 * - Sub copy at 19px max-width 580px
 * - Primary + secondary CTA buttons; "→" arrow on primary
 * - Trust pill with green dot + proof copy
 * - Three floating cards on right (Atlas/Pax/Sophie) with rotation +
 *   staggered fade-in animation
 * - SVG parcel-grid + radial-glow + parcel-polygon backdrop
 *
 * Patterns extrapolated:
 * - Mobile (<1100px) hides the floating cards (the prototype is desktop-only;
 *   stacking three rotated cards under the hero copy on a phone would be
 *   overwhelming; follow-up sections illustrate the agents instead)
 * - Title font-size scales with clamp(48px, 7vw, 80px) for responsive
 *
 * CTA links wire to production routes: /auth?mode=register and #how
 * (in-page anchor for the How It Works section landing later in 2A.3).
 */

import { Link } from "wouter";
import { LANDING_COPY } from "./copy";

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
          {c.title.map((line, i) => (
            <span
              key={i}
              className="lp-hero-line"
              style={{ animationDelay: `${0.1 + i * 0.08}s` }}
            >
              {line}
            </span>
          ))}
        </h1>
        <p className="lp-hero-sub">{c.sub}</p>
        <div className="lp-hero-cta">
          <Link href="/auth?mode=register" className="lp-btn lp-btn-primary lp-btn-lg lp-btn-arrow">
            {c.cta1}
          </Link>
          <a href="#founder" className="lp-btn lp-btn-secondary lp-btn-lg">
            {c.cta2}
          </a>
        </div>
        <div className="lp-hero-ctasub">{c.ctaSub}</div>
        <div className="lp-hero-proof">
          <span className="lp-hero-dot" aria-hidden="true" />
          {c.proof}
        </div>
      </div>

      <HeroVisual />
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="lp-hero-visual" aria-hidden="true">
      <div className="lp-hero-card lp-hv-atlas">
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-atlas-av">A</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Atlas</div>
            <div className="lp-hv-role">Comping APN 304-12-456</div>
          </div>
          <span className="lp-hv-badge lp-hv-badge-running">
            <span className="lp-hv-spin" />
            Running
          </span>
        </div>
        <div className="lp-hv-row"><span>Comparable sales found</span><b>14</b></div>
        <div className="lp-hv-row"><span>Median $/acre</span><b>$2,840</b></div>
        <div className="lp-hv-row"><span>Confidence</span><b className="lp-hv-conf-high">High · 87%</b></div>
        <div className="lp-hv-bar"><div className="lp-hv-bar-fill" style={{ width: "87%" }} /></div>
      </div>

      <div className="lp-hero-card lp-hv-pax">
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-pax-av">P</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Pax · Drafted reply</div>
            <div className="lp-hv-role">To: Janet Ruiz · Coconino County</div>
          </div>
        </div>
        <div className="lp-hv-msg">
          <span className="lp-hv-msg-from">Janet:</span>
          {`"What's your best offer? I have another buyer."`}
        </div>
        <div className="lp-hv-msg lp-hv-msg-out">
          <span className="lp-hv-msg-from">Pax draft:</span>
          {`"Hi Janet — I can do $14,200 cash, 14-day close. That's 12% above the median for parcels your size in Coconino. Happy to email a written offer."`}
        </div>
        <div className="lp-hv-actions">
          <span className="lp-hv-action">Send as-is</span>
          <span className="lp-hv-action lp-hv-action-soft">Edit</span>
          <span className="lp-hv-action lp-hv-action-soft">Why this price?</span>
        </div>
      </div>

      <div className="lp-hero-card lp-hv-sophie">
        <div className="lp-hv-head">
          <div className="lp-hv-avatar lp-hv-sophie-av">S</div>
          <div className="lp-hv-meta">
            <div className="lp-hv-name">Sophie</div>
            <div className="lp-hv-role">Note #2204-A · serviced</div>
          </div>
          <span className="lp-hv-badge lp-hv-badge-done">Done</span>
        </div>
        <div className="lp-hv-row"><span>Payment received</span><b>$487.50</b></div>
        <div className="lp-hv-row"><span>Receipt sent</span><b>2 min ago</b></div>
        <div className="lp-hv-row"><span>Next due</span><b>Jun 1</b></div>
      </div>
    </div>
  );
}
