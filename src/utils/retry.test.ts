import { describe, it, expect, vi } from "vitest";
import { backoffDelayMs, retryWithBackoff } from "./retry.js";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const fastRetry = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 40, sleep: async () => {} };

describe("backoffDelayMs", () => {
  it("doubles per attempt", () => {
    expect(backoffDelayMs(1, 1000, 30_000)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 30_000)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 30_000)).toBe(4000);
  });

  it("clamps at the configured ceiling", () => {
    expect(backoffDelayMs(10, 1000, 30_000)).toBe(30_000);
  });
});

describe("retryWithBackoff", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(retryWithBackoff(fn, fastRetry)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a failing call and succeeds on a later attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream down"))
      .mockResolvedValue("recovered");
    await expect(retryWithBackoff(fn, fastRetry)).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows the last error once attempts are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still down"));
    await expect(retryWithBackoff(fn, fastRetry)).rejects.toThrow("still down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not sleep after the final attempt", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValue(new Error("down"));
    await expect(retryWithBackoff(fn, { ...fastRetry, sleep })).rejects.toThrow();
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
