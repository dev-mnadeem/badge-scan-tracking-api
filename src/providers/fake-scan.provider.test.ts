import { describe, it, expect } from "vitest";
import type { RawScan } from "../types/api.js";
import { createFakeScanProvider, loadScanFixture } from "./fake-scan.provider.js";
import { toUtcMs } from "../config/time.js";

function scan(scanDate: string, badgeId = "badge-001"): RawScan {
  return { badgeId, scanDate, customFields: [{ "Booth Name": "Cisco Showcase" }] };
}

describe("createFakeScanProvider", () => {
  const scans = [
    scan("2026-02-04T09:00:00"),
    scan("2026-02-04T10:00:00"),
    scan("2026-02-04T11:00:00"),
  ];
  const provider = createFakeScanProvider({ scans, pageSize: 2 });

  it("treats both window bounds as exclusive", async () => {
    const rows = await provider.fetchScans({
      fromMs: toUtcMs("2026-02-04T09:00:00"),
      toMs: toUtcMs("2026-02-04T11:00:00"),
    });
    expect(rows.map((r) => r.scanDate)).toEqual(["2026-02-04T10:00:00"]);
  });

  it("never returns more than the page size", async () => {
    const rows = await provider.fetchScans({
      fromMs: toUtcMs("2026-02-04T00:00:00"),
      toMs: toUtcMs("2026-02-05T00:00:00"),
    });
    expect(rows).toHaveLength(2);
  });

  it("is deterministic across calls", async () => {
    const window = { fromMs: toUtcMs("2026-02-04T00:00:00"), toMs: toUtcMs("2026-02-05T00:00:00") };
    expect(await provider.fetchScans(window)).toEqual(await provider.fetchScans(window));
  });

  it("rejects an inverted window the way the live provider does", async () => {
    await expect(provider.fetchScans({ fromMs: 10, toMs: 10 })).rejects.toThrow(RangeError);
  });
});

describe("loadScanFixture", () => {
  it("loads the checked-in fixture and validates it against the upstream schema", () => {
    const scans = loadScanFixture("./fixtures/sample-scans.json");
    expect(scans.length).toBeGreaterThan(0);
    expect(
      scans.every((s) => typeof s.badgeId === "string" && typeof s.scanDate === "string"),
    ).toBe(true);
  });
});
