/**
 * Circuit Breaker Unit Tests
 * Tasks #376-377: Redis circuit breaker, OpenAI circuit breaker
 */

import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../../server/utils/circuitBreaker";

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CircuitBreaker", () => {
  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker("test");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("passes through successful calls", async () => {
    const cb = new CircuitBreaker("test");
    const result = await cb.call(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("remains CLOSED below failure threshold", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 5 });
    for (let i = 0; i < 4; i++) {
      await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    }
    expect(cb.currentState).toBe("CLOSED");
  });

  it("opens after reaching failure threshold", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    }
    expect(cb.currentState).toBe("OPEN");
  });

  it("throws CircuitOpenError when OPEN", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1 });
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("OPEN");

    await expect(cb.call(async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("transitions to HALF_OPEN after reset timeout", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 50 });
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("OPEN");

    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next call should attempt HALF_OPEN
    const result = await cb.call(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("re-opens from HALF_OPEN on failure", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1, resetTimeoutMs: 50 });
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("OPEN");

    await new Promise((resolve) => setTimeout(resolve, 60));

    // Fail again in HALF_OPEN
    await cb.call(async () => { throw new Error("fail again"); }).catch(() => {});
    expect(cb.currentState).toBe("OPEN");
  });

  it("resets failure count on success", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 5 });
    // 4 failures
    for (let i = 0; i < 4; i++) {
      await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    }
    // 1 success — resets counter
    await cb.call(async () => "ok");
    // 4 more failures should not open (threshold is 5, counter reset)
    for (let i = 0; i < 4; i++) {
      await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    }
    expect(cb.currentState).toBe("CLOSED");
  });

  it("calls onStateChange callback", async () => {
    const onStateChange = vi.fn();
    const cb = new CircuitBreaker("test", { failureThreshold: 1, onStateChange });
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(onStateChange).toHaveBeenCalledWith("test", "CLOSED", "OPEN");
  });

  it("reset() closes an open circuit", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1 });
    await cb.call(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.currentState).toBe("OPEN");
    cb.reset();
    expect(cb.currentState).toBe("CLOSED");
    const result = await cb.call(async () => "after reset");
    expect(result).toBe("after reset");
  });
});
