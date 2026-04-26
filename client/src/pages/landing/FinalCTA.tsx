/**
 * Prototype reference: /acreos-landing/sections-3.jsx → FinalCTA (lines 152-179)
 *
 * Dark contrast card (acr-ink bg with terracotta radial glow upper-right).
 * Brand-color eyebrow, large serif title, sub copy, email-capture form,
 * "or" divider, "Email me first" ghost link, trust microcopy bottom.
 *
 * The email submit currently routes to /auth?mode=register with the
 * email pre-filled in the query string — production already supports
 * this from the existing landing flow.
 */

import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { LANDING_COPY } from "./copy";

export function FinalCTA() {
  const c = LANDING_COPY.cta;
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    const qs = new URLSearchParams({ mode: "register", email });
    setLocation(`/auth?${qs.toString()}`);
  }

  return (
    <section className="lp-section lp-cta" id="cta">
      <div className="lp-cta-card">
        <div className="lp-eyebrow lp-eyebrow-brand">{c.eyebrow}</div>
        <h2 className="lp-cta-title">{c.title}</h2>
        <p className="lp-cta-sub">{c.sub}</p>
        <form className="lp-cta-form" onSubmit={handleSubmit}>
          <input
            type="email"
            required
            placeholder="you@yourbusiness.com"
            className="lp-cta-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address"
          />
          <button
            type="submit"
            className="lp-btn lp-btn-primary lp-btn-lg lp-btn-arrow"
          >
            {c.cta1}
          </button>
        </form>
        <div className="lp-cta-or">or</div>
        <a href="mailto:thomas@acreos.io" className="lp-btn lp-btn-ghost">
          {c.cta2} →
        </a>

        <div className="lp-cta-trust">
          <span>14 days free</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>No credit card</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>SOC2 Type II</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>Cancel anytime</span>
        </div>
      </div>
    </section>
  );
}
