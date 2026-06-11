/**
 * Phase 3 Week 11 — Legal-hold red banner (Saskia/Lazlo/Margolis §1).
 *
 * Site-wide banner that surfaces when the current org is under an active
 * FRCP 37(e) legal hold. Backed by `/api/legal-hold/banner`, which returns
 * `{ banner: null }` when no hold is active.
 *
 * Margolis §1 directive: do NOT create a new banner system. The server
 * mirrors every legal-hold placement into `system_alerts` so the alert-tray
 * surface inherits the event automatically; this banner is the persistent
 * top-of-app indicator that retention is currently frozen.
 */

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { formatDate } from "@/lib/format";

interface BannerPayload {
  banner: {
    caseRef: string;
    scope: string;
    placedAt: string;
    message: string;
  } | null;
}

export function LegalHoldBanner() {
  const { data } = useQuery<BannerPayload>({
    queryKey: ["/api/legal-hold/banner"],
    // Hold state changes are rare but operationally critical; refetch every
    // 5 minutes so a release/placement propagates without a hard reload.
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    // 423 responses + missing org should never throw — the queryClient swallows.
    retry: false,
  });

  const banner = data?.banner;
  if (!banner) return null;

  return (
    <Alert
      variant="destructive"
      role="alert"
      aria-live="polite"
      className="mx-4 mt-2 border-red-500/60 bg-red-500/10"
      data-testid="legal-hold-banner"
    >
      <ShieldAlert className="h-4 w-4 text-red-500" aria-hidden="true" />
      <AlertTitle>Legal hold active</AlertTitle>
      <AlertDescription>
        {banner.message}
        {banner.placedAt && (
          <span className="ml-2 text-xs opacity-80">
            placed {formatDate(banner.placedAt)}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
