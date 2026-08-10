/**
 * Settings → Security & sessions — routed section (Wave 1.5, P2 §1).
 *
 * Moved intact from the settings.tsx monolith's Security tab.
 *
 * Password change is delegated to Clerk's UserProfile dialog (opened from
 * TwoFactorAuthSettings). The legacy PasswordChange card POSTed to
 * /api/auth/change-password which no longer exists — Clerk owns
 * credentials end-to-end.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, CheckCircle2 } from "lucide-react";
import { SecurityActivityLog } from "@/components/security-activity-log";
import { useState } from "react";
// R4: Clerk-native MFA management — replaces the deleted in-house TOTP flow.
import { UserProfile } from "@clerk/react";
import { useSafeUser, CLERK_AVAILABLE } from "@/lib/clerk-safe";

export default function SecuritySection() {
  return (
    <div className="space-y-6" data-testid="settings-section-security">
      <TwoFactorAuthSettings />
      <SecurityActivityLog />
    </div>
  );
}

// ── Two-Factor Authentication Settings (Clerk-native, R4) ────────────────────
// AcreOS used to ship its own TOTP implementation under /api/auth/2fa/*, but
// it was wired against express-session (not installed) and a `users` table
// that didn't actually have the 2FA columns — so the flow was non-functional
// end-to-end. R4 deletes that stack and delegates MFA enrollment / verify /
// disable to Clerk's hosted UserProfile UI. Clerk owns the TOTP secret, the
// SMS factor, and the backup codes; AcreOS just enforces verified-this-session
// at the API edge via requireClerkMFA.
//
// The `<UserProfile />` component shows the full Clerk account UI (email,
// password, MFA, connected accounts) inside a dialog — the cleanest way to
// give the user the security flows they expect without re-implementing TOTP.

function TwoFactorAuthSettings() {
  const { user, isLoaded } = useSafeUser();
  const [showProfile, setShowProfile] = useState(false);

  const twoFactorEnabled = Boolean(user?.twoFactorEnabled);

  return (
    <Card data-testid="card-2fa-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" aria-hidden="true" />
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          Manage your password, two-factor authentication (authenticator app or SMS), and connected accounts through your Clerk account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoaded ? (
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" announceText="Loading account security status" />
            <Skeleton className="h-4 w-36" announce={false} />
          </div>
        ) : twoFactorEnabled ? (
          <div className="flex items-center gap-2 text-acr-pos" role="status">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm font-medium">2FA is enabled</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            2FA is not enabled. Some admin areas (recovery console, ownership transfer) require it.
          </p>
        )}

        {CLERK_AVAILABLE ? (
          <Button
            size="sm"
            variant={twoFactorEnabled ? "outline" : "default"}
            className="min-h-11 pointer-fine:sm:min-h-9"
            onClick={() => setShowProfile(true)}
            data-testid="button-manage-2fa"
          >
            {twoFactorEnabled ? "Manage 2FA" : "Set up 2FA"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="text-2fa-unavailable">
            Account security is managed through your sign-in provider, which
            isn&apos;t loaded here.
          </p>
        )}

        <Dialog open={showProfile && CLERK_AVAILABLE} onOpenChange={setShowProfile}>
          <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>Account security</DialogTitle>
              <DialogDescription>
                Manage your password, two-factor authentication factors, and connected accounts through Clerk.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[80vh] overflow-y-auto">
              {/* TODO(tsc): Clerk's public UserProfileProps types `routing` as
                  'path' | 'hash' only — 'virtual' is runtime-valid (used by Clerk
                  for modal mounting) but not exposed on the component props.
                  Using 'hash' here keeps navigation off the app router (closest
                  type-valid equivalent to 'virtual' for this in-Dialog embed). */}
              <UserProfile routing="hash" />
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
