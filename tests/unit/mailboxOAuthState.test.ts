/**
 * Mailbox OAuth state — the stateless CSRF nonce guarding the connect flow
 * (R1c). The app has no express-session, so this signed state is the whole
 * CSRF defense: it must accept exactly what we issued and reject everything
 * else (forged sig, malformed, empty).
 */

import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../../server/routes-mailbox";

describe("mailbox OAuth signed state", () => {
  it("accepts a freshly issued state", () => {
    expect(verifyState(signState())).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const s = signState();
    const [b64] = s.split(".");
    expect(verifyState(`${b64}.deadbeef`)).toBe(false);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const s = signState();
    const [, sig] = s.split(".");
    const forgedPayload = Buffer.from("forged.123").toString("base64url");
    expect(verifyState(`${forgedPayload}.${sig}`)).toBe(false);
  });

  it("rejects empty / malformed states", () => {
    expect(verifyState(undefined)).toBe(false);
    expect(verifyState("")).toBe(false);
    expect(verifyState("nodot")).toBe(false);
    expect(verifyState("...")).toBe(false);
  });

  it("issues a distinct nonce each time", () => {
    expect(signState()).not.toBe(signState());
  });
});
