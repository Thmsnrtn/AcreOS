import { useEffect } from "react";

/**
 * JsonLd — injects a `<script type="application/ld+json">` tag into the
 * document head for the lifetime of the component. Used to attach
 * Schema.org structured data to public pages so search engines can
 * surface rich results (Organization knowledge panels, Product cards,
 * BlogPosting article cards, etc.).
 *
 * The tag is keyed by `id` so multiple pages can co-exist and so the
 * crawler-visible markup deduplicates on hot reloads. On unmount the
 * tag is removed.
 *
 * Usage:
 *
 *   <JsonLd id="org" data={{ "@context": "https://schema.org", ... }} />
 *
 * For the SSR / pre-render path the same JSON payload is injected at
 * build time by `script/prerender.ts` so search engines that don't run
 * JS still see the structured data.
 */
export function JsonLd({ id, data }: { id: string; data: unknown }) {
  useEffect(() => {
    const tagId = `ld-json-${id}`;
    let tag = document.getElementById(tagId) as HTMLScriptElement | null;
    if (!tag) {
      tag = document.createElement("script");
      tag.type = "application/ld+json";
      tag.id = tagId;
      document.head.appendChild(tag);
    }
    try {
      tag.textContent = JSON.stringify(data);
    } catch {
      tag.textContent = "{}";
    }
    return () => {
      const t = document.getElementById(tagId);
      if (t) t.remove();
    };
  }, [id, data]);

  return null;
}

export default JsonLd;
