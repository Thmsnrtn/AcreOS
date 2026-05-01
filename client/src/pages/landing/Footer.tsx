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
 * - mailto:thomas@acreos.io for contact
 * - In-page anchors for #features, #pricing, #faq, #founder
 *
 * Anchor links to features that don't exist yet (#atlas, #pax, #sophie
 * page subroutes) point at #agents instead — they'll get dedicated
 * routes in Phase 9 if desired.
 */

import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-brand">
          <a href="#" className="lp-footer-logo">
            <span className="lp-footer-logo-mark">A</span>AcreOS
          </a>
          <p className="lp-footer-tag">
            The operating system for land investors. Built by an investor.
          </p>
        </div>
        <div className="lp-footer-cols">
          <div className="lp-footer-col">
            <div className="lp-footer-h">Product</div>
            <a href="#agents">Atlas</a>
            <a href="#agents">Pax</a>
            <a href="#agents">Sophie</a>
            <a href="#features">Automation</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Company</div>
            <Link href="/why">From the founder</Link>
            <Link href="/careers">Careers</Link>
            <Link href="/press">Press</Link>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Resources</div>
            <Link href="/academy">Academy</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/calculator">Land deal calculator</Link>
            <Link href="/api-docs">API docs</Link>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-h">Contact</div>
            <a href="mailto:thomas@acreos.io">thomas@acreos.io</a>
            <Link href="/support">Support</Link>
            <a href="https://status.acreos.io" target="_blank" rel="noreferrer">
              Status
            </a>
          </div>
        </div>
      </div>
      <div className="lp-footer-bottom">
        <span>© {new Date().getFullYear()} AcreOS, Inc.</span>
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
