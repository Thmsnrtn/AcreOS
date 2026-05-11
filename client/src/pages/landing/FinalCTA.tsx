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
import { SupportFeedbackModal } from "@/components/support-feedback-modal";

export function FinalCTA() {
  const c = LANDING_COPY.cta;
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  // 2026-05-11: replaced dead `mailto:thomas@acreos.io` with the
  // SupportFeedbackModal that pipes into /founder/feedback.
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="lp-btn lp-btn-ghost"
          data-testid="final-cta-contact"
        >
          {c.cta2} →
        </button>
        <SupportFeedbackModal
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          source="landing_final_cta"
          defaultCategory="question"
        />

        <div className="lp-cta-trust">
          <span>14 days free</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>No credit card</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>SOC 2 Type 1 in progress · 2026-Q3 target</span>
          <span className="lp-cta-sep" aria-hidden="true">·</span>
          <span>Cancel anytime</span>
        </div>
      </div>
    </section>
  );
}
