/**
 * Prototype reference: /acreos-landing/sections-1.jsx → HowItWorks
 *
 * Three-step grid with 02-style numerals, step title, body, and a
 * connector arrow between steps. Section eyebrow + serif title + sub.
 */

import { LANDING_COPY } from "./copy";

export function HowItWorks() {
  const c = LANDING_COPY.how;
  return (
    <section className="lp-section" id="how">
      <div className="lp-eyebrow">{c.eyebrow}</div>
      <h2 className="lp-section-title">{c.title}</h2>
      <div className="lp-how-grid">
        {c.steps.map((s, i) => (
          <div key={i} className="lp-how-card">
            <div className="lp-how-num">{String(s.n).padStart(2, "0")}</div>
            <h3 className="lp-how-title">{s.t}</h3>
            <p className="lp-how-body">{s.b}</p>
            {i < c.steps.length - 1 && (
              <div className="lp-how-connector" aria-hidden="true">
                →
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
