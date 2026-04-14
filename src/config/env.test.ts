import { describe, it, expect } from "vitest";
import { parseEnv } from "./env.js";

const base: NodeJS.ProcessEnv = { API_TOKEN: "test-token" };

describe("parseEnv", () => {
  it("requires API_TOKEN when the live HTTP provider is selected", () => {
    expect(() => parseEnv({ SCAN_PROVIDER: "http" })).toThrow(/API_TOKEN/);
  });

  it("needs no credentials at all when the fake provider is selected", () => {
    const config = parseEnv({ SCAN_PROVIDER: "fake" });
    expect(config.SCAN_PROVIDER).toBe("fake");
    expect(config.API_TOKEN).toBeUndefined();
  });

  it("applies documented defaults", () => {
    const config = parseEnv(base);
    expect(config.PORT).toBe(3000);
    expect(config.POLL_INTERVAL_CRON).toBe("*/5 * * * *");
    expect(config.SCAN_PAGE_SIZE).toBe(1000);
    expect(config.API_TIMEOUT_MS).toBe(30_000);
    expect(config.RETRY_MAX_ATTEMPTS).toBe(3);
    expect(config.INSIGHTS_PROVIDER).toBe("local");
  });

  it("coerces numeric variables from their string form", () => {
    const config = parseEnv({
      ...base,
      PORT: "7191",
      RETRY_MAX_ATTEMPTS: "5",
    });
    expect(config.PORT).toBe(7191);
    expect(config.RETRY_MAX_ATTEMPTS).toBe(5);
  });

  it("rejects a retry ceiling below the base delay", () => {
    expect(() =>
      parseEnv({
        ...base,
        RETRY_BASE_DELAY_MS: "5000",
        RETRY_MAX_DELAY_MS: "100",
      }),
    ).toThrow(/RETRY_MAX_DELAY_MS/);
  });

  it("requires an Anthropic key only when that insight provider is selected", () => {
    expect(() => parseEnv({ ...base, INSIGHTS_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});
