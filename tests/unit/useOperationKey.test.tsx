// @vitest-environment jsdom
/**
 * Audit of 0e54c75 — a retried payment must carry the SAME Idempotency-Key.
 * `apiRequest(…, { idempotent: true })` minted a new key per call, so a user
 * who saw a timeout and clicked again recorded the payment twice. The hook
 * holds one key per operation: same body → same key; a changed body (an
 * edited amount is a different payment) or a settled operation → a new key.
 */
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useOperationKey } from "../../client/src/hooks/use-operation-key";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function withHook(): ReturnType<typeof useOperationKey> {
  let api!: ReturnType<typeof useOperationKey>;
  function Probe() {
    api = useOperationKey();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(React.createElement(Probe)));
  return api;
}

describe("useOperationKey", () => {
  it("a retry of the same payment reuses the key", () => {
    const k = withHook();
    const a = k.keyFor({ amountCents: 140_000, receivedAt: "2026-07-05" });
    const b = k.keyFor({ amountCents: 140_000, receivedAt: "2026-07-05" });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it("an edited payment is a different operation — a new key", () => {
    const k = withHook();
    const a = k.keyFor({ amountCents: 140_000 });
    const b = k.keyFor({ amountCents: 150_000 });
    expect(a).not.toBe(b);
  });

  it("after the payment is recorded, the next one gets a new key even with the same body", () => {
    const k = withHook();
    const a = k.keyFor({ amountCents: 140_000 });
    k.settle();
    expect(k.keyFor({ amountCents: 140_000 })).not.toBe(a);
  });
});
