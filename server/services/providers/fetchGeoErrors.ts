/**
 * fetchGeo's typed refusal, in its own module so a caller can tell it apart
 * from a failed request without importing (or being blinded by a test double
 * of) fetchGeo itself.
 *
 * FetchGeoUrlRefused: the URL was refused BEFORE any request was sent — it
 * does not parse, or the SSRF guard blocked it (private/loopback/metadata
 * address, non-https). That is the source's configuration, not the source
 * failing: retrying cannot help and it is no evidence the server is down.
 */
export class FetchGeoUrlRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchGeoUrlRefused";
  }
}
