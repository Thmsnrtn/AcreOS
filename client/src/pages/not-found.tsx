/**
 * 404 — re-exports the homestead-styled NotFoundPage from
 * coverage-page.tsx so the App.tsx fallback (and any feature-flag
 * disabled-route fallback) gets the new editorial treatment.
 *
 * Kept as a separate file because App.tsx + several other call-sites
 * import `NotFound` from "@/pages/not-found".
 */
import { NotFoundPage } from "./coverage-page";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function NotFound() {
  useDocumentTitle("Page not found");

  return <NotFoundPage />;
}
