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
