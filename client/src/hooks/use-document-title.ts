import { useEffect } from "react";

const BASE_TITLE = "AcreOS — The AI-Powered Platform for Land Investors";

/**
 * Set document.title for the lifetime of a page component.
 * On unmount, restores the base title.
 *
 *   useDocumentTitle("Pricing");        // "Pricing · AcreOS"
 *   useDocumentTitle("Pricing", true);  // "Pricing" (bare — no base)
 */
export function useDocumentTitle(title: string | null | undefined, bare = false) {
  useEffect(() => {
    if (!title) return;
    const next = bare ? title : `${title} · AcreOS`;
    const prev = document.title;
    document.title = next;
    return () => {
      // Only restore if nothing else claimed the title in between.
      if (document.title === next) {
        document.title = prev || BASE_TITLE;
      }
    };
  }, [title, bare]);
}

/**
 * Set the <meta name="description"> for the lifetime of a page component.
 * Link previews (Slack, iMessage, Twitter) and search snippets pull from
 * this tag — good per-page descriptions meaningfully lift CTR.
 * On unmount, restores the previous value so the base landing-page
 * description survives back-nav.
 */
export function usePageDescription(description: string | null | undefined) {
  useEffect(() => {
    if (!description) return;
    let tag = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      document.head.appendChild(tag);
    }
    const prev = tag.getAttribute("content") || "";
    tag.setAttribute("content", description);
    return () => {
      if (tag && tag.getAttribute("content") === description) {
        tag.setAttribute("content", prev);
      }
    };
  }, [description]);
}

/**
 * Combined helper — most pages want both at once.
 */
export function usePageMeta(title: string, description?: string) {
  useDocumentTitle(title);
  usePageDescription(description);
}
