/**
 * PublicFooter — shared footer used across customer-trust pages
 * (/security, /changelog, /pricing, /privacy, /terms, /status, etc).
 *
 * Centralized so adding a new public link (e.g. founder letter, when
 * one exists publicly) means editing one file, not five. Discoverability
 * for /security and /changelog (P1-5) lives here.
 */
import { Link } from "wouter";

export function PublicFooter() {
  return (
    <footer className="border-t py-8 px-6" aria-label="Site footer">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-muted-foreground">
        <span>
          &copy; <span className="tabular-nums">{new Date().getFullYear()}</span>{" "}
          AcreOS. All rights reserved.
        </span>
        <nav className="flex flex-wrap gap-x-2 gap-y-1" aria-label="Footer links">
          <Link
            href="/"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Home
          </Link>
          <Link
            href="/security"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Security
          </Link>
          <Link
            href="/changelog"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Changelog
          </Link>
          <Link
            href="/pricing"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Pricing
          </Link>
          <Link
            href="/status"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Status
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Privacy
          </Link>
          <Link
            href="/auth"
            className="hover:text-foreground inline-flex items-center min-h-11 px-2"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
