/**
 * SSRF guard on operator-contributed data-source URLs (Beatrice item 5).
 * Pins the private-IP / non-https rejection so the county-endpoint write path
 * can never point our server-side fetch at internal infrastructure.
 */
import { describe, it, expect } from "vitest";
import { checkOperatorUrl } from "./ssrf-guard";

describe("checkOperatorUrl — SSRF guard", () => {
  it("accepts a normal public https GIS endpoint", () => {
    expect(checkOperatorUrl("https://gis.example-county.gov/arcgis/rest/services").ok).toBe(true);
  });

  it("rejects non-https", () => {
    const r = checkOperatorUrl("http://gis.example-county.gov/arcgis");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/https/i);
  });

  it("rejects localhost + loopback", () => {
    expect(checkOperatorUrl("https://localhost/x").ok).toBe(false);
    expect(checkOperatorUrl("https://127.0.0.1/x").ok).toBe(false);
    expect(checkOperatorUrl("https://[::1]/x").ok).toBe(false);
  });

  it("rejects cloud-metadata link-local 169.254.169.254", () => {
    expect(checkOperatorUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(checkOperatorUrl("https://10.0.0.5/x").ok).toBe(false);
    expect(checkOperatorUrl("https://192.168.1.10/x").ok).toBe(false);
    expect(checkOperatorUrl("https://172.16.5.5/x").ok).toBe(false);
    expect(checkOperatorUrl("https://172.31.255.255/x").ok).toBe(false);
  });

  it("allows a public IP literal", () => {
    expect(checkOperatorUrl("https://8.8.8.8/x").ok).toBe(true);
    // 172.32 is outside the 172.16-31 private block.
    expect(checkOperatorUrl("https://172.32.0.1/x").ok).toBe(true);
  });

  it("rejects .local / .internal hostnames", () => {
    expect(checkOperatorUrl("https://gis.county.local/x").ok).toBe(false);
    expect(checkOperatorUrl("https://service.internal/x").ok).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(checkOperatorUrl("not a url").ok).toBe(false);
  });
});
