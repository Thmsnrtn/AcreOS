/**
 * Blank-render sentinel.
 *
 * Some failures leave a page fully mounted but painted with NOTHING the
 * person can see — e.g. framer-motion entrances stranded at inline
 * `opacity: 0` when a long-lived iOS Safari tab throttles the animation
 * engine. React sees a healthy tree, the error boundary never trips, and
 * telemetry stays silent while the user stares at a blank page (exactly
 * the founder's Decisions/Controls/Story reports of 2026-07).
 *
 * This hook runs a cheap check ~2.5s after each route change: if the main
 * content region has a real subtree but ZERO visibly-painted descendants,
 * it (1) self-heals by landing stuck inline opacities at 1, (2) reports
 * one BlankRenderDetected trip per route per session to the same ledger
 * the ErrorBoundary uses (Solene's morning brief surfaces it), and
 * (3) if healing didn't help, offers a plain-DOM reload banner — built
 * without any of the animation/glass machinery that may be broken.
 *
 * CSS-first cousin: the `acr-render-rescue` rule in index.css lands
 * stuck elements even when JS timers are throttled; this hook is the
 * telemetry + last-resort layer on top.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";

const reportedRoutes = new Set<string>();
const CHECK_DELAY_MS = 2500;
const MIN_SUBTREE_SIZE = 8;

function isVisiblyPainted(el: Element): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  if (parseFloat(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function reportBlankRender(routePath: string, detail: string): void {
  if (reportedRoutes.has(routePath)) return;
  reportedRoutes.add(routePath);
  const errorId = `blank_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  try {
    void fetch("/api/client/error-boundary-trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        errorId,
        errorName: "BlankRenderDetected",
        errorMessageExcerpt: detail.slice(0, 500),
        routePath,
        componentStackExcerpt: "",
        clientMeta: {
          userAgent: navigator.userAgent,
          url: window.location.href,
          viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        },
      }),
    }).catch(() => {});
  } catch {
    // Telemetry must never break the page it's rescuing.
  }
}

function showReloadBanner(): void {
  if (document.getElementById("acr-blank-render-banner")) return;
  const banner = document.createElement("button");
  banner.id = "acr-blank-render-banner";
  banner.type = "button";
  banner.textContent = "This page didn't draw correctly — tap to reload";
  // Deliberately plain inline styles: no glass, no animation, no theme
  // tokens — nothing that could be part of the broken pipeline.
  banner.style.cssText = [
    "position:fixed", "left:16px", "right:16px", "bottom:96px", "z-index:2147483647",
    "padding:14px 16px", "border-radius:12px", "border:1px solid #b45309",
    "background:#fef3c7", "color:#78350f", "font:600 14px/1.3 system-ui,sans-serif",
    "box-shadow:0 4px 16px rgba(0,0,0,0.25)", "cursor:pointer",
  ].join(";");
  banner.addEventListener("click", () => window.location.reload());
  document.body.appendChild(banner);
}

export function useRenderSentinel(): void {
  const [location] = useLocation();

  useEffect(() => {
    // Remove any stale banner from the previous route.
    document.getElementById("acr-blank-render-banner")?.remove();

    const timer = window.setTimeout(() => {
      const main =
        document.getElementById("main-content") ?? document.querySelector("main");
      if (!main) return;
      const descendants = main.querySelectorAll("*");
      // Small subtrees are loading/empty states, not blank renders.
      if (descendants.length < MIN_SUBTREE_SIZE) return;

      let visible = 0;
      const stuck: HTMLElement[] = [];
      descendants.forEach((el) => {
        if (isVisiblyPainted(el)) {
          visible++;
        } else if (el instanceof HTMLElement && el.style.opacity === "0") {
          stuck.push(el);
        }
      });
      if (visible > 0) return;

      // Blank page: land anything held invisible by inline style.
      stuck.forEach((el) => {
        el.style.opacity = "1";
      });

      reportBlankRender(
        location,
        `main has ${descendants.length} descendants, 0 visibly painted; ` +
          `${stuck.length} stuck at inline opacity 0 (self-healed)`,
      );

      // Re-check after the heal has had a frame to land.
      window.setTimeout(() => {
        const stillBlank = ![...main.querySelectorAll("*")].some(isVisiblyPainted);
        if (stillBlank) showReloadBanner();
      }, 400);
    }, CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [location]);
}
