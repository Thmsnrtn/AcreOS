/**
 * Dynamic Google Font loader.
 *
 * Instead of loading all theme/white-label fonts in a render-blocking
 * <link> tag at startup, this utility loads individual font families
 * on-demand when they are actually selected.
 */

const loadedFonts = new Set<string>();

/**
 * Dynamically load a Google Font family by injecting a non-blocking
 * <link> element into <head>.
 *
 * @param family  The Google Fonts family name, e.g. "Inter" or "DM Sans"
 * @param weights Optional weight spec, e.g. "400;500;600;700". Defaults to "400;500;600;700".
 */
export function loadGoogleFont(family: string, weights = "400;500;600;700"): void {
  if (loadedFonts.has(family)) return;
  loadedFonts.add(family);

  const encodedFamily = family.replace(/ /g, "+");
  const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${weights}&display=swap`;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  // Non-blocking: load as print, switch to all on load
  link.media = "print";
  link.onload = () => {
    link.media = "all";
  };
  document.head.appendChild(link);
}

/**
 * Preload fonts used by the white-label font picker so they render
 * in the dropdown preview.
 */
export function preloadWhiteLabelFonts(families: string[]): void {
  for (const family of families) {
    loadGoogleFont(family);
  }
}
