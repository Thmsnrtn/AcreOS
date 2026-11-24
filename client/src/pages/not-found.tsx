/**
 * 404 — re-exports the homestead-styled NotFoundPage from
 * coverage-page.tsx so the App.tsx fallback gets the new editorial
 * treatment. (A feature-flag-disabled route no longer lands here — it renders
 * the "not available" state in components/flagged-route.tsx.)
 *
 * Kept as a separate file because App.tsx + several other call-sites
 * import `NotFound` from "@/pages/not-found".
 *
 * Two builds, one fallback (P1-9 / X-2): this is also the last route of BOTH
 * route trees (App.tsx and founder-routes.tsx). A path that belongs to the
 * OTHER build — a sidebar link, a palette entry or a stale bookmark that
 * reached this bundle through a client-side navigation — is not "not found";
 * wouter simply cannot cross bundles. It is handed to the server with a full
 * page load, which answers with the right shell (client/src/lib/cross-build.ts).
 * Any other unknown path renders the 404.
 */
import { useLocation } from "wouter";
import { NotFoundPage } from "./coverage-page";
import { HardNavigate } from "@/components/cross-build-redirect";
import { crossesBuilds } from "@/lib/cross-build";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function NotFound() {
  useDocumentTitle("Page not found");
  const [location] = useLocation();

  if (crossesBuilds(location)) {
    return <HardNavigate to={`${location}${window.location.search}${window.location.hash}`} />;
  }

  return <NotFoundPage />;
}
