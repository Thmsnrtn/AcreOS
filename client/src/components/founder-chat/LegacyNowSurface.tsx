/**
 * LegacyNowSurface — wrapper around the legacy tile-driven Now page so
 * the chat-first /founder route can still link to "View dashboard" and
 * render the pre-chat experience verbatim.
 *
 * This re-exports the existing FounderNowPage component (which renders
 * the bucket alarm, net-negative orgs, scale-up triggers tiles). When
 * Phase F deprecates the dashboard surface entirely, this wrapper goes
 * away — for now it keeps the legacy path under one named symbol so we
 * have a single grep target for the eventual removal.
 *
 * Phase E will refactor the SAME data into the morning brief artifact
 * that gets seeded as the first message of the day in the default
 * thread — at that point /founder/dashboard becomes redundant.
 */
import FounderNowPage from "@/pages/founder/now";

export function LegacyNowSurface() {
  return <FounderNowPage />;
}

export default LegacyNowSurface;
