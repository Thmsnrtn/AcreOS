/**
 * Client-side HTML sanitizer.
 * Strips <script>, <iframe>, <object>, <embed>, on* event handlers,
 * and javascript: hrefs from user-supplied HTML before rendering.
 *
 * This is a defense-in-depth measure. The primary protection is the
 * Content-Security-Policy header that blocks inline script execution.
 *
 * Usage:
 *   import { sanitizeHtml } from "@/lib/sanitize";
 *   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
 */

// Tags that should never appear in user content
const BLOCKED_TAGS = /(<\s*\/?\s*(script|iframe|object|embed|link|style|meta|base|form)[^>]*>)/gi;

// Event handler attributes (onclick, onload, onerror, etc.)
const EVENT_HANDLERS = /\s+on\w+\s*=\s*["'][^"']*["']/gi;

// javascript: protocol in href/src
const JS_PROTOCOL = /(href|src|action)\s*=\s*["']\s*javascript:[^"']*["']/gi;

// data: URI in src (can be used to load scripts)
const DATA_SRC = /src\s*=\s*["']\s*data:[^"']*["']/gi;

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(BLOCKED_TAGS, "")
    .replace(EVENT_HANDLERS, "")
    .replace(JS_PROTOCOL, "href=\"#\"")
    .replace(DATA_SRC, "src=\"\"");
}
