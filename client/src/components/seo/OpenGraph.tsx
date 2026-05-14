import { useEffect } from "react";

interface OpenGraphProps {
  /** Canonical URL for this page (absolute). */
  url: string;
  /** og:title — defaults to document.title if omitted. */
  title?: string;
  /** og:description — short, shareable. */
  description: string;
  /** og:type — "website" / "article" / "product". */
  type?: "website" | "article" | "product";
  /** Absolute image URL for og:image and twitter:image. */
  image?: string;
  /** Image alt text. */
  imageAlt?: string;
}

/**
 * OpenGraph — sets per-page og:* and twitter:* meta tags for the
 * lifetime of the component.
 *
 * The base index.html ships sensible defaults for the landing page; this
 * hook upgrades them per-route so Slack / iMessage / Twitter unfurl with
 * the correct title + description + canonical URL.
 *
 * Tags are upserted (created if missing, updated if present) so multiple
 * components can co-exist without duplicating tags.
 */
export function OpenGraph({
  url,
  title,
  description,
  type = "website",
  image = "https://acreos.io/images/aerial_view_wide_hor_0f1000c4.jpg",
  imageAlt = "Aerial view of open land — one of many asset types real-estate investors hunt, analyze, and close on AcreOS.",
}: OpenGraphProps) {
  useEffect(() => {
    const head = document.head;

    function upsertMeta(
      attr: "name" | "property",
      key: string,
      value: string,
    ) {
      let tag = head.querySelector<HTMLMetaElement>(
        `meta[${attr}="${key}"]`,
      );
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        head.appendChild(tag);
      }
      const prev = tag.getAttribute("content") || "";
      tag.setAttribute("content", value);
      return { tag, prev };
    }

    function upsertCanonical(href: string) {
      let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        head.appendChild(link);
      }
      const prev = link.getAttribute("href") || "";
      link.setAttribute("href", href);
      return { link, prev };
    }

    const resolvedTitle = title || document.title;

    const og = [
      upsertMeta("property", "og:url", url),
      upsertMeta("property", "og:title", resolvedTitle),
      upsertMeta("property", "og:description", description),
      upsertMeta("property", "og:type", type),
      upsertMeta("property", "og:image", image),
      upsertMeta("property", "og:image:alt", imageAlt),
      upsertMeta("name", "twitter:card", "summary_large_image"),
      upsertMeta("name", "twitter:title", resolvedTitle),
      upsertMeta("name", "twitter:description", description),
      upsertMeta("name", "twitter:image", image),
      upsertMeta("name", "twitter:image:alt", imageAlt),
    ];

    const canonical = upsertCanonical(url);

    return () => {
      // Restore prior values on unmount so a back-nav doesn't leave the
      // wrong card metadata in the head.
      og.forEach(({ tag, prev }) => {
        if (prev) tag.setAttribute("content", prev);
      });
      if (canonical.prev) canonical.link.setAttribute("href", canonical.prev);
    };
  }, [url, title, description, type, image, imageAlt]);

  return null;
}

export default OpenGraph;
