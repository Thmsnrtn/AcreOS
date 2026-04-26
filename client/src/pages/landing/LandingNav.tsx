/**
 * Sticky homestead-styled top nav for the public landing page.
 * Prototype: acreos-landing/acreos-landing.html lines 149–166.
 *
 * Anchors point at section ids rendered by the sibling section
 * components (Hero/HowItWorks/Agents/Pricing/FounderNote). On <720px
 * the anchor row collapses (CSS) and only brand + sign-in + CTA show.
 */
import { Link } from "wouter";

export function LandingNav() {
  return (
    <nav className="lp-nav" aria-label="Primary">
      <div className="lp-nav-row">
        <Link href="/" className="lp-logo" aria-label="AcreOS home">
          <span className="lp-logo-mark" aria-hidden="true">
            A
          </span>
          AcreOS
        </Link>
        <div className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#agents">The agents</a>
          <a href="#pricing">Pricing</a>
          <a href="#founder">Why we built it</a>
        </div>
        <div className="lp-nav-cta">
          <Link href="/auth" className="lp-nav-signin">
            Sign in
          </Link>
          <Link href="/auth?mode=register" className="lp-nav-btn">
            Start free trial
          </Link>
        </div>
      </div>
    </nav>
  );
}
