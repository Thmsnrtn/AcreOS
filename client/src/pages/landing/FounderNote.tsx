/**
 * Prototype reference: /acreos-landing/sections-3.jsx → FounderNote (lines 6-40)
 *
 * Two-column layout: sticky founder portrait SVG on left (180×216
 * placeholder with terracotta silhouette + name plate), serif italic
 * 44px section title + body paragraphs + signature on right. Stacks
 * to single column at <880px.
 *
 * Body paragraphs are verbatim from copy.ts (letter tone). The body
 * is the founder explaining why he built this — it's the most
 * personal piece of copy on the landing.
 */

import { LANDING_COPY } from "./copy";

export function FounderNote() {
  const c = LANDING_COPY.founder;
  return (
    <section className="lp-section lp-founder" id="founder">
      <div className="lp-founder-inner">
        <div className="lp-founder-portrait" aria-hidden="true">
          <svg viewBox="0 0 200 240" width="180" height="216">
            <defs>
              <linearGradient id="port-bg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#F1E9D6" />
                <stop offset="100%" stopColor="#E5D7B5" />
              </linearGradient>
            </defs>
            <rect width="200" height="240" rx="12" fill="url(#port-bg)" />
            <circle cx="100" cy="95" r="38" fill="#C2531C" opacity="0.85" />
            <path
              d="M30 240 Q30 160 100 160 Q170 160 170 240 Z"
              fill="#C2531C"
              opacity="0.85"
            />
            <rect x="10" y="200" width="180" height="40" fill="#FAF4E8" opacity="0.5" />
            <text
              x="100"
              y="225"
              textAnchor="middle"
              fontFamily="Fraunces, serif"
              fontSize="11"
              fill="#5A4424"
              letterSpacing="0.1em"
            >
              THOMAS NORTON
            </text>
          </svg>
        </div>
        <div className="lp-founder-text">
          <div className="lp-eyebrow">{c.eyebrow}</div>
          <h2 className="lp-founder-title">{c.title}</h2>
          {c.body.map((p, i) => (
            <p key={i} className="lp-founder-p">
              {p}
            </p>
          ))}
          <div className="lp-founder-sig">
            <div className="lp-founder-sig-name">{c.sig}</div>
            <div className="lp-founder-sig-sub">{c.sigSub}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
