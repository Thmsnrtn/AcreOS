import { useState, useEffect, useCallback } from "react";
import { usePWA } from "@/hooks/use-pwa";
import { Button } from "@/components/ui/button";
import { X, Share, Plus, Check } from "lucide-react";

/**
 * The "get the app" moment.
 *
 * AcreOS is an installable PWA — once it's on the home screen it opens
 * full-screen with its own icon and splash, indistinguishable from an App
 * Store app, with none of the App Store overhead. This surface is what makes
 * that discoverable and easy:
 *
 *   - iOS Safari: iOS has no programmatic install, so we render a clear,
 *     correctly-ordered walkthrough of the share-sheet flow, with the real
 *     AcreOS icon shown so the person can picture what lands on their home
 *     screen. Gated to real Safari (isIOSSafari) — other iOS browsers and
 *     in-app webviews can't add to the home screen, so we never show them
 *     dead-end steps.
 *   - Android / desktop Chromium: fires the native beforeinstallprompt.
 *
 * Opens automatically once (after a short delay, respecting a 7-day
 * dismissal), and on demand whenever something dispatches the
 * `acreos:show-install` event — e.g. the "Add to Home Screen" row in
 * Settings, so a person who dismissed can always find it again.
 */
export const SHOW_INSTALL_EVENT = "acreos:show-install";
const DISMISS_KEY = "pwa-install-dismissed";
const DISMISS_DAYS = 7;

export function PWAInstallPrompt() {
  const { canInstall, isInstalled, isIOS, isIOSSafari, promptInstall } = usePWA();
  const [showPrompt, setShowPrompt] = useState(false);
  // `manual` opens (from Settings) bypass the auto-show gates: no delay, no
  // cookie-banner deference, and they show even after a prior dismissal.
  const [manual, setManual] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [cookieBannerVisible, setCookieBannerVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("acreos_cookie_consent") === null;
  });

  useEffect(() => {
    const recheck = () => {
      setCookieBannerVisible(localStorage.getItem("acreos_cookie_consent") === null);
    };
    window.addEventListener("acreos:cookieconsent", recheck);
    window.addEventListener("storage", recheck);
    return () => {
      window.removeEventListener("acreos:cookieconsent", recheck);
      window.removeEventListener("storage", recheck);
    };
  }, []);

  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISS_KEY);
    if (wasDismissed) {
      const days = (Date.now() - parseInt(wasDismissed)) / (1000 * 60 * 60 * 24);
      if (days < DISMISS_DAYS) setDismissed(true);
    }
  }, []);

  // On-demand open (Settings → "Add to Home Screen"). Works even if already
  // dismissed. On a platform with a native prompt, fire it directly instead
  // of rendering the sheet.
  useEffect(() => {
    const open = async () => {
      if (canInstall) {
        await promptInstall();
        return;
      }
      setManual(true);
      setShowPrompt(true);
    };
    window.addEventListener(SHOW_INSTALL_EVENT, open);
    return () => window.removeEventListener(SHOW_INSTALL_EVENT, open);
  }, [canInstall, promptInstall]);

  // Auto-show: only for installable platforms (native prompt available, or
  // real iOS Safari), once, after a beat, if not dismissed.
  useEffect(() => {
    const installable = canInstall || isIOSSafari;
    if (installable && !isInstalled && !dismissed) {
      const timer = setTimeout(() => setShowPrompt(true), 4000);
      return () => clearTimeout(timer);
    }
  }, [canInstall, isIOSSafari, isInstalled, dismissed]);

  const handleDismiss = useCallback(() => {
    setShowPrompt(false);
    setManual(false);
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  }, []);

  const handleInstall = async () => {
    const installed = await promptInstall();
    if (installed) {
      setShowPrompt(false);
      setManual(false);
    }
  };

  // Auto-opens defer to the cookie banner (they compete for the bottom of the
  // viewport); manual opens do not.
  if (!showPrompt || isInstalled) return null;
  if (!manual && cookieBannerVisible) return null;

  // iOS but NOT Safari (Chrome/Firefox/in-app webview): only reachable via a
  // manual open, since auto-show is gated to isIOSSafari. Tell the truth
  // instead of showing steps that won't work here.
  if (isIOS && !isIOSSafari) {
    return (
      <InstallShell onDismiss={handleDismiss}>
        <p className="text-sm font-semibold">Open in Safari to install</p>
        <p className="text-xs text-muted-foreground mt-1">
          Adding AcreOS to your Home Screen works from Safari. Open{" "}
          <span className="font-medium">acreos.io</span> in Safari, then tap
          Share → &ldquo;Add to Home Screen.&rdquo;
        </p>
      </InstallShell>
    );
  }

  if (isIOS) {
    return (
      <InstallShell onDismiss={handleDismiss}>
        <p className="text-sm font-semibold">Add AcreOS to your Home Screen</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Opens full-screen and launches like an app — no App Store needed.
        </p>
        <ol className="mt-3 space-y-2">
          <Step n={1}>
            Tap the{" "}
            <Share className="inline h-3.5 w-3.5 align-text-bottom text-primary" aria-label="Share" role="img" />{" "}
            <span className="font-medium">Share</span> button in Safari&rsquo;s toolbar
          </Step>
          <Step n={2}>
            Scroll down and tap{" "}
            <span className="font-medium">Add to Home Screen</span>{" "}
            <Plus className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
          </Step>
          <Step n={3}>
            Tap <span className="font-medium">Add</span> — AcreOS lands on your
            Home Screen
          </Step>
        </ol>
      </InstallShell>
    );
  }

  // Android / desktop Chromium — native install available.
  return (
    <InstallShell onDismiss={handleDismiss}>
      <p className="text-sm font-semibold">Install AcreOS</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        Opens full-screen and launches like an app, with offline access — no
        App Store needed.
      </p>
      <ul className="mt-3 space-y-1.5">
        <Benefit>Its own icon on your home screen</Benefit>
        <Benefit>Full-screen, no browser chrome</Benefit>
        <Benefit>Works offline for what you&rsquo;ve already opened</Benefit>
      </ul>
      <div className="flex gap-2 mt-4">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={handleDismiss}
          data-testid="button-not-now-pwa"
        >
          Not now
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={handleInstall}
          data-testid="button-install-pwa"
        >
          Install
        </Button>
      </div>
    </InstallShell>
  );
}

/** Shared bottom-anchored card with the app icon + dismiss affordance. */
function InstallShell({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <aside
      aria-label="Install AcreOS"
      role="dialog"
      aria-modal="false"
      className="fixed bottom-[88px] md:bottom-4 left-4 right-4 z-floating md:left-auto md:right-4 md:w-96 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="rounded-2xl border border-primary/20 bg-card shadow-level-3 p-4">
        <div className="flex items-start gap-3">
          <img
            src="/apple-touch-icon.png"
            width={44}
            height={44}
            alt=""
            aria-hidden="true"
            className="h-11 w-11 shrink-0 rounded-[10px] shadow-sm"
          />
          <div className="flex-1 min-w-0">{children}</div>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 -mt-1 -mr-1"
            onClick={onDismiss}
            aria-label="Dismiss install prompt"
            data-testid="button-dismiss-pwa"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-xs text-foreground">
      <span
        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
        aria-hidden="true"
      >
        {n}
      </span>
      <span className="leading-5">{children}</span>
    </li>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs text-muted-foreground">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acr-pos" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
