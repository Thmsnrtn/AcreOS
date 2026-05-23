/**
 * atlas-discuss — tiny pub/sub helper that opens the Atlas Dock with a
 * prefilled question.
 *
 * Used by "Discuss with Atlas →" affordances on artifact cards rendered
 * OUTSIDE the chat (cost-event detail, steering tiles, etc.) so the
 * founder can ask Atlas about a specific entity without copy-pasting
 * its id into the composer.
 *
 * The Dock host (AtlasDockHost in App.tsx) listens for the
 * "atlas:discuss" CustomEvent and:
 *   1. Sets the dock's prefillMessage prop to event.detail.message.
 *   2. Opens the dock.
 *   3. Auto-sends the prefilled message once hydration completes.
 *
 * Using a global event (rather than React context) keeps the contract
 * decoupled — any component anywhere in the tree can publish without
 * needing a provider in scope.
 */

export interface AtlasDiscussDetail {
  /** The question to seed the composer with. */
  message: string;
  /**
   * Optional artifact metadata for logging / telemetry. Not used by
   * the chat itself today — placeholder for a future Phase E
   * "discussed artifact" trail.
   */
  artifactType?: string;
  artifactId?: string | number;
}

/**
 * Open the Atlas Dock with a prefilled question. Safe to call from
 * anywhere — if the Dock isn't mounted (non-founder user, or in tests),
 * the event is a no-op.
 */
export function discussWithAtlas(detail: AtlasDiscussDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AtlasDiscussDetail>("atlas:discuss", { detail }));
}
