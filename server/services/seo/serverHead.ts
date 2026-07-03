/**
 * Server-rendered <head> for public SPA routes (free-distribution work,
 * 2026-07-03).
 *
 * THE HOLE THIS CLOSES: every public URL served the same static index.html
 * head — so every social share (Twitter/FB/LinkedIn/Slack unfurls never
 * execute JS) showed the homepage card, and crawlers' first pass saw
 * identical titles/descriptions on every field note, learn page, and compare
 * lander. The client-side SeoPageShell fixes what JS-rendering crawlers
 * eventually see; this fixes what EVERYTHING sees first.
 *
 * Pure string surgery on the built shell: swap <title>, meta description,
 * OG/Twitter tags, add canonical + optional JSON-LD. No SSR framework, no
 * hydration risk — the SPA still owns the body; only the head is per-route.
 */

export interface HeadSpec {
  /** Full document title (already includes the "· AcreOS" suffix if wanted). */
  title: string;
  /** Search-snippet description (~140-160 chars ideal; will be escaped). */
  description: string;
  /** Path for the canonical URL, e.g. "/field-notes/my-slug". */
  canonicalPath: string;
  ogType?: "website" | "article";
  /** Optional JSON-LD object appended before </head>. */
  jsonLd?: Record<string, unknown>;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip tags + collapse whitespace; cap length at a word boundary. */
export function stripHtmlToText(html: string, maxLen = 300): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxLen * 0.6 ? lastSpace : maxLen)}…`;
}

function upsertMeta(html: string, matcher: RegExp, replacement: string): string {
  if (matcher.test(html)) return html.replace(matcher, replacement);
  return html.replace(/<\/head>/i, `    ${replacement}\n  </head>`);
}

/**
 * Inject a per-route head into the SPA shell. Idempotent-ish: existing tags
 * are replaced, missing ones inserted before </head>. Never throws — on any
 * surgery failure the original shell is returned (the SPA still works).
 */
export function injectHead(shellHtml: string, spec: HeadSpec, baseUrl: string): string {
  try {
    const title = escapeHtml(spec.title);
    const desc = escapeHtml(spec.description);
    const canonical = `${baseUrl.replace(/\/+$/, "")}${spec.canonicalPath}`;
    const ogType = spec.ogType ?? "website";

    let html = shellHtml;
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    html = upsertMeta(html, /<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${desc}" />`);
    html = upsertMeta(html, /<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${title}" />`);
    html = upsertMeta(html, /<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${desc}" />`);
    html = upsertMeta(html, /<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${escapeHtml(canonical)}" />`);
    html = upsertMeta(html, /<meta\s+property="og:type"[^>]*>/i, `<meta property="og:type" content="${ogType}" />`);
    html = upsertMeta(html, /<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${title}" />`);
    html = upsertMeta(html, /<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${desc}" />`);
    // Canonical: replace an existing one or insert fresh.
    const canonicalTag = `<link rel="canonical" href="${escapeHtml(canonical)}" />`;
    html = upsertMeta(html, /<link\s+rel="canonical"[^>]*>/i, canonicalTag);
    if (spec.jsonLd) {
      // </script> inside JSON would close the tag early — escape the slash.
      const json = JSON.stringify(spec.jsonLd).replace(/<\//g, "<\\/");
      html = html.replace(/<\/head>/i, `    <script type="application/ld+json">${json}</script>\n  </head>`);
    }
    return html;
  } catch {
    return shellHtml;
  }
}

// ─── Per-surface spec builders (pure) ────────────────────────────────────────

export function headForFieldNotesArchive(): HeadSpec {
  return {
    title: "Field Notes — land investing intel from the AcreOS desk · AcreOS",
    description:
      "Short, practical notes on land deals, county data, direct-mail response rates, and running a land business — published from the AcreOS operating desk.",
    canonicalPath: "/field-notes",
    ogType: "website",
  };
}

export function headForFieldNote(note: {
  slug: string;
  subject: string;
  plainBody: string | null;
  htmlBody: string;
  publishedAt: Date | null;
}): HeadSpec {
  const bodyText = note.plainBody?.trim() || stripHtmlToText(note.htmlBody, 5000);
  const description = stripHtmlToText(note.plainBody ?? note.htmlBody, 160);
  return {
    title: `${note.subject} · AcreOS Field Notes`,
    description: description || "A field note from the AcreOS land-investing desk.",
    canonicalPath: `/field-notes/${note.slug}`,
    ogType: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: note.subject,
      datePublished: note.publishedAt ? note.publishedAt.toISOString() : undefined,
      author: { "@type": "Organization", name: "AcreOS" },
      publisher: { "@type": "Organization", name: "AcreOS", url: "https://acreos.io" },
      mainEntityOfPage: `https://acreos.io/field-notes/${note.slug}`,
      // Full text in structured data — crawlers read this even though the
      // visible body is client-rendered.
      articleBody: bodyText.slice(0, 10_000),
    },
  };
}

/** "acreos-vs-propstream" → "PropStream" (best-effort competitor label). */
export function competitorFromSlug(slug: string): string {
  const raw = slug.replace(/^acreos-vs-/, "").replace(/-/g, " ").trim();
  return raw
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function headForCompare(slug: string): HeadSpec {
  const competitor = competitorFromSlug(slug);
  return {
    title: `AcreOS vs ${competitor} — land investing platform comparison · AcreOS`,
    description: `How AcreOS compares to ${competitor} for land investors: county data, direct mail, seller-response capture, deal pipeline, and pricing — feature by feature.`,
    canonicalPath: `/compare/${slug}`,
    ogType: "website",
  };
}

/** Derive a readable title from a /learn path's segments. */
export function headForLearnPath(path: string): HeadSpec {
  const segments = path.split("/").filter(Boolean).slice(1); // drop "learn"
  const pretty = (s: string) =>
    s
      .replace(/-/g, " ")
      .split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  const label = segments.length ? segments.map(pretty).reverse().join(" — ") : "Guides";
  return {
    title: `${label} · AcreOS Learn`,
    description: `${label}: statute-grade guidance, county data, and practical playbooks for land investors — free from AcreOS.`,
    canonicalPath: path,
    ogType: "article",
  };
}
