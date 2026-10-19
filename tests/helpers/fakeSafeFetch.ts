/**
 * A stand-in for server/services/mail/safeFetch.ts `safeHttpsGet` that keeps
 * the REAL address checks (resolvePublicAddress / isBlockedAddress, with a
 * resolver that maps every name to a public address) and serves a real PDF of
 * `fakeSafeFetch.pdfPages` pages for any https …pdf URL — no network.
 *
 * Use:
 *   vi.mock("../../server/services/mail/safeFetch", async () => (await import("../helpers/fakeSafeFetch")).fakeSafeFetchModule());
 */
import { makePdf } from "./pdfFixture";

interface FakeSafeFetchState {
  /** Pages of the PDF served; null = the fetch fails. */
  pdfPages: number | null;
  /** URLs that passed the address checks and were "fetched". */
  fetched: string[];
  reset(): void;
}

const g = globalThis as { __fakeSafeFetch?: FakeSafeFetchState };
export const fakeSafeFetch: FakeSafeFetchState = (g.__fakeSafeFetch ??= {
  pdfPages: 1,
  fetched: [],
  reset() {
    this.pdfPages = 1;
    this.fetched = [];
  },
});

export async function fakeSafeFetchModule() {
  const actual = await import("../../server/services/mail/safeFetch");
  return {
    ...actual,
    safeHttpsGet: async (rawUrl: string) => {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return null;
      }
      if (url.protocol !== "https:") return null;
      const pinned = await actual.resolvePublicAddress(url.hostname, async () => [{ address: "93.184.216.34", family: 4 }]);
      if (!pinned) return null;
      fakeSafeFetch.fetched.push(rawUrl);
      if (fakeSafeFetch.pdfPages === null || !/\.pdf$/.test(url.pathname)) return { status: 404, contentType: "text/plain", body: Buffer.from("nope") };
      return { status: 200, contentType: "application/pdf", body: await makePdf(fakeSafeFetch.pdfPages) };
    },
  };
}
