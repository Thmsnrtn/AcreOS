/**
 * Listing photos as entered on the listing form: one URL per non-blank line,
 * in the order entered, the first being the cover. The form used to take a
 * single URL, so a listing could carry one photo at most.
 */
export function photoUrlsFromText(text: string | undefined): { url: string; isPrimary: boolean; order: number }[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((url, i) => ({ url, isPrimary: i === 0, order: i }));
}
