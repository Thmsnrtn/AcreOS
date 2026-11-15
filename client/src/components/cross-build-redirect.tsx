/**
 * Cross-build-aware `Redirect` (P1-9 / X-2).
 *
 * The customer and founder bundles are separate Vite outputs. wouter's own
 * <Redirect> can only move within ONE bundle, so a redirect whose target
 * belongs to the other build would land on that bundle's NotFound. This
 * component closes that gap: it is a drop-in for wouter's <Redirect to="…">.
 * A same-build target uses wouter exactly as before; a target owned by the
 * other build is a full page load (the server answers that path with the other
 * shell — server/static.ts).
 *
 * It is deliberately NAMED `Redirect` so route parsing (tests/helpers/
 * clientRoutes.ts classifies a route as an alias by the `Redirect` tag) and
 * every existing `<Redirect to=…>` call site keep their meaning.
 *
 * The other half of the hand-off — a plain link or navigation into the other
 * build's path, which wouter resolves to the Switch's last route — is handled
 * by pages/not-found.tsx, using the same `HardNavigate`.
 */
import { useEffect, useState } from "react";
import { Redirect as WouterRedirect } from "wouter";
import { NotFoundPage } from "@/pages/coverage-page";
import { PageLoader } from "@/components/page-loader";
import { crossesBuilds, handOffToOtherBuild } from "@/lib/cross-build";

export function HardNavigate({ to }: { to: string }) {
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    // handOffToOtherBuild refuses a repeat of the same target within seconds
    // (loop guard) — render NotFound rather than reload forever.
    if (!handOffToOtherBuild(to)) setRefused(true);
  }, [to]);
  return refused ? <NotFoundPage /> : <PageLoader />;
}

export function Redirect({ to }: { to: string }) {
  if (crossesBuilds(to)) return <HardNavigate to={to} />;
  return <WouterRedirect to={to} />;
}
