/**
 * 404 — re-exports the homestead-styled NotFoundPage from
 * coverage-page.tsx so the App.tsx fallback gets the new editorial
 * treatment. (A feature-flag-disabled route no longer lands here — it renders
 * the "not available" state in components/flagged-route.tsx.)
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
