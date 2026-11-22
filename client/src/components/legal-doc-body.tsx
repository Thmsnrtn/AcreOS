/**
 * LegalDocBody — renders a legal document's section body from its static
 * HTML asset (client/src/legal/*.html, served under /legal/).
 *
 * The body used to be inline JSX in the page; it is data, not code, so it
 * ships as an asset the bundle gate does not sum (the #524 pattern) and is
 * fetched when the page renders — shell first, text on arrival, the BD-6
 * discipline. The fetched HTML is first-party, authored in this repo, and
 * is still run through DOMPurify before it touches the DOM (the same
 * sanitize-before-innerHTML pattern as the mail and assignment previews),
 * so a future edit that smuggles markup into the asset cannot execute it.
 *
 * Three behaviours of the old JSX are preserved deliberately:
 *   - {{TOKEN}} placeholders are substituted from their single sources of
 *     truth (see lib/legal-doc.ts) before sanitizing.
 *   - Internal links carry data-internal-link and are routed through
 *     wouter on click, exactly as the <Link> components they replaced —
 *     no full page load.
 *   - The <span data-support-feedback-slot> in the contact section is
 *     filled, via portal, with the page's real SupportFeedbackButton
 *     (same props as the inline original), so the support modal opens
 *     from the same sentence it always did.
 *
 * A failed fetch renders a visible failure line with the document named —
 * never a silently shorter legal document (empty-on-failure discipline).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "isomorphic-dompurify";
import { useLocation } from "wouter";
import { fetchLegalDoc, substituteLegalTokens } from "@/lib/legal-doc";

interface LegalDocBodyProps {
  /** The served asset URL (see lib/legal-doc.ts). */
  url: string;
  /** {{TOKEN}} values from their single sources of truth. */
  substitutions: Record<string, string>;
  /** The SupportFeedbackButton element to portal into the body's slot. */
  supportFeedbackButton: ReactNode;
  /** data-testid for the body container (E2E / test hooks). */
  testId: string;
}

export function LegalDocBody({
  url,
  substitutions,
  supportFeedbackButton,
  testId,
}: LegalDocBodyProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [slot, setSlot] = useState<Element | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchLegalDoc(url)
      .then((raw) => {
        if (cancelled) return;
        // The asset opens with an editor-facing HTML comment; DOMPurify
        // drops comment nodes, so it never reaches the DOM.
        setHtml(substituteLegalTokens(raw, substitutions));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // substitutions are module constants at every call site (legal-entity
    // and glossary-core values); the fetch is keyed on the URL alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Find the support-button slot once the body is in the DOM. Keyed off
  // the substituted `html` state: the sanitize call lives inline at the
  // sink below (the sink gate's legible shape), so there is no memoised
  // sanitized value to key off — this effect runs after that render, so
  // the container already holds the sanitized body when it queries.
  useEffect(() => {
    if (html === null) return;
    setSlot(
      containerRef.current?.querySelector("[data-support-feedback-slot]") ??
        null,
    );
  }, [html]);

  const onClick = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest?.(
      'a[data-internal-link="true"]',
    );
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    setLocation(href);
  };

  if (failed) {
    return (
      <p
        className="text-muted-foreground leading-relaxed"
        data-testid={`${testId}-load-error`}
      >
        This document&rsquo;s text couldn&rsquo;t load just now. Refresh the
        page to try again — if it keeps failing, the document is unavailable
        rather than shortened, and no part of it has been hidden from you.
      </p>
    );
  }
  if (html === null) return null;
  return (
    <>
      <div
        ref={containerRef}
        data-testid={testId}
        onClick={onClick}
        // The sections used to be direct children of the page's
        // space-y-8 CardContent; the wrapper carries the same spacing
        // so the section rhythm is unchanged.
        className="space-y-8"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
      {slot ? createPortal(supportFeedbackButton, slot) : null}
    </>
  );
}
