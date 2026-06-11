/**
 * Prototype reference: /acreos-landing/sections-3.jsx → Footer (lines 182-221)
 *
 * Two-row footer on bg-sunken: brand mark + tagline on left, four
 * link columns on right (Product / Company / Resources / Contact).
 * Bottom row: copyright + legal-fine links.
 *
 * Production wouter routes:
 * - /pricing, /academy, /blog → existing routes
 * - /privacy, /terms, /security → existing routes
 * - Contact opens SupportFeedbackModal (form-only — no mailto)
 * - In-page anchors for #features, #pricing, #faq, #agents
 *
 * Internal agent names (Atlas/Sophie/Forge) are not surfaced here —
 * customers only know Pax.
 */

import { useState } from "react";
import { Link } from "wouter";
import { SupportFeedbackModal } from "@/components/support-feedback-modal";
import { LEGAL_ENTITY_NAME } from "@/lib/legal-entity";

export function Footer() {
  // 2026-05-11: replaced dead `mailto:` contact link with the
  // SupportFeedbackModal that pipes into /founder/feedback.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-brand">
          {/* Brand mark scrolls to top of the landing page — the only
              page Footer renders on. Avoids a dead `href="#"`. */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="lp-footer-logo"
            aria-label="Back to top"
          >
            <span className="lp-footer-logo-mark">A</span>AcreOS
          </a>
          <p className="lp-footer-tag">
            The operating system for Land Investors.
          </p>
        </div>
        <div className="lp-footer-cols">
          <div className="lp-footer-col">
            <div className="lp-footer-h">Product</div>
            <a href="#how">How it works</a>
            <a href="#agents">Meet Pax</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
          </div>
          {/* Tier 2C — internal-link surfacing. The parcel-check tool and
              the Land Credit Score page were orphaned (zero internal links
              → crawlers can't find them, prospects can't either), and /why
              had no path from the landing page. Free tools and Learn are
              separate columns because they serve different intents: "try
              something now" vs "understand the approach". */}
          <div className="lp-footer-col">
            <div className="lp-footer-h">Free tools</div>
            <Link href="/tools/parcel-check">Parcel check</Link>
            <Link href="/tools/calculator">Land deal calculator</Link>
            <Link href="/land-credit-score">Land Credit Score</Link>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Learn</div>
            <Link href="/learn">Guides by state &amp; county</Link>
            <Link href="/why">Why AcreOS</Link>
            <Link href="/glossary">Glossary</Link>
            <a href="https://acreos.substack.com" target="_blank" rel="noreferrer">Field notes</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Contact</div>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="lp-footer-link-btn"
              data-testid="footer-contact"
            >
              Contact us
            </button>
            <Link href="/help#support">Support</Link>
            <Link href="/status">Status</Link>
          </div>
        </div>
      </div>
      <SupportFeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        source="landing_footer"
        defaultCategory="question"
      />
      <div className="lp-footer-bottom">
        <span>© {new Date().getFullYear()} {LEGAL_ENTITY_NAME}</span>
        <span className="lp-footer-fine">
          <Link href="/privacy">Privacy</Link>
          {" · "}
          <Link href="/terms">Terms</Link>
          {" · "}
          <Link href="/security">Security</Link>
        </span>
      </div>
    </footer>
  );
}
