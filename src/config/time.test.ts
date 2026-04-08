import { describe, it, expect } from "vitest";
import { hasTimeZoneDesignator, laterOf, toUtcIso, toUtcMs } from "./time.js";

describe("toUtcMs", () => {
  it("reads a naive upstream timestamp as UTC, not as host-local time", () => {
    // Regression: the upstream API returns "2026-02-12T18:58:15" with no
    // designator. Date.parse resolves that in the host timezone, so a poll
    // cursor round-tripping through the database shifted by the host's UTC
    // offset — re-fetching hours of scans west of UTC and skipping them east
    // of it. Both forms must now mean the same instant on every machine.
    expect(toUtcMs("2026-02-12T18:58:15")).toBe(toUtcMs("2026-02-12T18:58:15Z"));
    expect(toUtcMs("2026-02-12T18:58:15")).toBe(Date.UTC(2026, 1, 12, 18, 58, 15));
  });

  it("honours an explicit offset when one is present", () => {
    expect(toUtcMs("2026-02-12T18:58:15+05:00")).toBe(Date.UTC(2026, 1, 12, 13, 58, 15));
    expect(toUtcMs("2026-02-12T18:58:15.250Z")).toBe(Date.UTC(2026, 1, 12, 18, 58, 15, 250));
  });

  it("treats a bare date as midnight UTC", () => {
    expect(toUtcMs("2026-02-12")).toBe(Date.UTC(2026, 1, 12));
  });

  it("rejects values it cannot parse", () => {
    expect(() => toUtcMs("not-a-date")).toThrow(RangeError);
    expect(() => toUtcMs("   ")).toThrow(RangeError);
  });
});

describe("hasTimeZoneDesignator", () => {
  it("distinguishes naive timestamps from pinned ones", () => {
    expect(hasTimeZoneDesignator("2026-02-12T18:58:15")).toBe(false);
    expect(hasTimeZoneDesignator("2026-02-12T18:58:15Z")).toBe(true);
    expect(hasTimeZoneDesignator("2026-02-12T18:58:15-08:00")).toBe(true);
  });
});

describe("toUtcIso / laterOf", () => {
  it("normalises a naive timestamp to a full UTC ISO string", () => {
    expect(toUtcIso("2026-02-12T18:58:15")).toBe("2026-02-12T18:58:15.000Z");
  });

  it("compares timestamps as instants rather than as raw strings", () => {
    // Lexicographically "2026-02-12T09:00:00.000Z" sorts before "2026-02-12T09:00:00",
    // even though they are the same instant and the second is not earlier.
    expect(laterOf("2026-02-12T10:00:00", "2026-02-12T09:00:00.000Z")).toBe("2026-02-12T10:00:00");
    expect(laterOf("2026-02-12T08:00:00", "2026-02-12T09:00:00.000Z")).toBe(
      "2026-02-12T09:00:00.000Z",
    );
  });
});
