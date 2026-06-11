/**
 * Sticky homestead-styled top nav for the public landing page.
 * Prototype: acreos-landing/acreos-landing.html lines 149–166.
 *
 * Anchors point at section ids rendered by the sibling section
 * components (Hero/HowItWorks/Agents/Pricing). On <720px the anchor row
 * collapses; a hamburger button opens a full-width drop-down panel
 * with the same anchors + sign-in + CTA so mobile visitors can still
 * reach the section nav. The trigger collapses the panel on selection
 * (anchor click) and on Escape.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

const SECTION_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#agents", label: "Meet Pax" },
  { href: "#pricing", label: "Pricing" },
] as const;

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Close on Escape (returning focus to the trigger so keyboard users
  // aren't stranded), and lock body scroll while the sheet is open so the
  // page underneath doesn't scroll-jack as the user taps a link.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        burgerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

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
          {SECTION_LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
        <div className="lp-nav-cta">
          <Link href="/auth" className="lp-nav-signin">
            Sign in
          </Link>
          <Link href="/auth?mode=register" className="lp-nav-btn">
            Start free trial
          </Link>
        </div>
        <button
          type="button"
          ref={burgerRef}
          className="lp-nav-burger"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="lp-mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true" className={`lp-nav-burger-icon${open ? " is-open" : ""}`}>
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>

      <div
        id="lp-mobile-menu"
        className={`lp-nav-mobile${open ? " is-open" : ""}`}
        hidden={!open}
      >
        <ul>
          {SECTION_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            </li>
          ))}
          <li className="lp-nav-mobile-divider" aria-hidden="true" />
          <li>
            <Link href="/auth" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          </li>
          <li>
            <Link
              href="/auth?mode=register"
              className="lp-nav-mobile-cta"
              onClick={() => setOpen(false)}
            >
              Start free trial
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}
