import { describe, expect, it } from "vitest";

import {
  CLERK_PROXY_URL,
  clerkProviderProxyProps,
  isClerkDirect,
  resolveClerkProxyUrl,
} from "../../client/src/lib/clerkDirect";

describe("clerkDirect", () => {
  it("omits proxyUrl from the client config when CLERK_DIRECT is \"1\"", () => {
    const props = clerkProviderProxyProps({ CLERK_DIRECT: "1" });

    expect(props).toEqual({});
    expect(props).not.toHaveProperty("proxyUrl");
    expect(isClerkDirect({ CLERK_DIRECT: "1" })).toBe(true);
    expect(resolveClerkProxyUrl({ CLERK_DIRECT: "1" })).toBeUndefined();
  });

  it("keeps proxyUrl \"/__clerk\" when CLERK_DIRECT is unset", () => {
    const props = clerkProviderProxyProps({});

    expect(props).toEqual({ proxyUrl: "/__clerk" });
    expect(props.proxyUrl).toBe(CLERK_PROXY_URL);
    expect(isClerkDirect({})).toBe(false);
    expect(resolveClerkProxyUrl({})).toBe("/__clerk");
  });

  it("keeps proxyUrl for values other than exactly \"1\"", () => {
    for (const value of ["0", "true", "yes", ""]) {
      expect(clerkProviderProxyProps({ CLERK_DIRECT: value })).toEqual({
        proxyUrl: "/__clerk",
      });
    }
  });
});
