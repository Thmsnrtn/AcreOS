export type TabValue = "campaigns" | "ab-tests" | "sequences" | "buyer-blasts";

/**
 * Every `?channel=` value a link or redirect into this hub uses, and the tab
 * it opens. /sequences, /buyer-blasts and /direct-mail-campaigns redirect to
 * /campaigns?channel=…, and the sidebar links there too, but this page read
 * only the URL HASH — so every one of them landed on generic Campaigns, and
 * the buyer-blast list and composer were unreachable (best-in-class audit
 * 2026-10-20). Direct mail lives inside the Campaigns tab.
 */
export const CHANNEL_TABS: Readonly<Record<string, TabValue>> = {
  campaigns: "campaigns",
  "direct-mail": "campaigns",
  sequences: "sequences",
  "ab-tests": "ab-tests",
  "buyer-blasts": "buyer-blasts",
};

/** The tab a URL opens: `?channel=` first, then the legacy `#hash`. */
export function tabForLocation(search: string, hash: string): TabValue {
  const channel = new URLSearchParams(search).get("channel");
  if (channel && CHANNEL_TABS[channel]) return CHANNEL_TABS[channel];
  const h = hash.replace("#", "");
  return CHANNEL_TABS[h] ?? "campaigns";
}
