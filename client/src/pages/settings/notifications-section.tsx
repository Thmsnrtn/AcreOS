/**
 * Settings → Notifications & quiet hours — routed section (Wave 1.5, P2 §1).
 *
 * Quiet hours + the channel matrix, moved intact from the settings.tsx
 * monolith's Notifications tab (the provider/sender configuration that
 * shared that tab now lives in the Communications section).
 */
import { NotificationQuietHours } from "@/components/settings/notification-quiet-hours";
import { NotificationPreferences } from "@/components/notification-preferences";

export default function NotificationsSection() {
  return (
    <div className="space-y-8" data-testid="settings-section-notifications">
      <NotificationQuietHours />
      <NotificationPreferences />
    </div>
  );
}
