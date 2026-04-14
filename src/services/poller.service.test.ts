import { describe, it, expect, vi } from "vitest";
import type { RawScan } from "../types/api.js";
import { createFakeScanProvider } from "../providers/fake-scan.provider.js";
import type { ScanProvider } from "../providers/scan-provider.js";
import { createScanFetcher } from "./poller.service.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const retry = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 4, sleep: async () => {} };

function makeScans(count: number, isoPrefix: string): RawScan[] {
  return Array.from({ length: count }, (_, i) => ({
    badgeId: `badge-${i}`,
    // Spread across the hour so a bisection can actually separate them.
    scanDate: `${isoPrefix}T${String(9 + Math.floor(i / 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`,
    customFields: [{ "Booth Name": "Cisco Showcase" }],
  }));
}

async function drain(gen: AsyncGenerator<RawScan[]>): Promise<RawScan[][]> {
  const batches: RawScan[][] = [];
  for await (const batch of gen) {
    batches.push(batch);
  }
  return batches;
}

describe("createScanFetcher", () => {
  it("yields a single batch when the provider stays under its page size", async () => {
    const provider = createFakeScanProvider({ scans: makeScans(20, "2026-02-04"), pageSize: 1000 });
    const fetcher = createScanFetcher({ provider, retry });

    const batches = await drain(fetcher.fetchRange("2026-02-04T00:00:00Z", "2026-02-05T00:00:00Z"));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(20);
  });

  it("bisects the window until every response is under the page size", async () => {
    const scans = makeScans(60, "2026-02-04");
    const provider = createFakeScanProvider({ scans, pageSize: 10 });
    const fetcher = createScanFetcher({ provider, retry });

    const batches = await drain(fetcher.fetchRange("2026-02-04T00:00:00Z", "2026-02-05T00:00:00Z"));

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length < 10)).toBe(true);
    // Every scan is delivered exactly once, which is the point of bisecting
    // instead of paging by max-scanDate: duplicate scanDates cannot hide rows.
    const delivered = batches
      .flat()
      .map((s) => s.badgeId)
      .sort();
    expect(delivered).toEqual(scans.map((s) => s.badgeId).sort());
  });

  it("yields sub-batches in ascending window order so the cursor only moves forward", async () => {
    const provider = createFakeScanProvider({ scans: makeScans(60, "2026-02-04"), pageSize: 10 });
    const fetcher = createScanFetcher({ provider, retry });

    const batches = await drain(fetcher.fetchRange("2026-02-04T00:00:00Z", "2026-02-05T00:00:00Z"));
    const firstDates = batches.map((b) => b[0]!.scanDate);

    expect([...firstDates].sort()).toEqual(firstDates);
  });

  it("gives up when a full page will not fit in a 1ms window", async () => {
    const sameInstant: RawScan[] = Array.from({ length: 5 }, (_, i) => ({
      badgeId: `badge-${i}`,
      scanDate: "2026-02-04T09:00:00",
      customFields: [],
    }));
    const provider = createFakeScanProvider({ scans: sameInstant, pageSize: 5 });
    const fetcher = createScanFetcher({ provider, retry });

    await expect(
      drain(fetcher.fetchRange("2026-02-04T08:59:59.999Z", "2026-02-04T09:00:00.001Z")),
    ).rejects.toThrow(/cannot be subdivided further/);
  });

  it("yields nothing when the lower bound is not before the upper bound", async () => {
    const fetchScans = vi.fn();
    const provider = { name: "spy", pageSize: 10, fetchScans } as unknown as ScanProvider;
    const fetcher = createScanFetcher({ provider, retry });

    expect(
      await drain(fetcher.fetchRange("2026-02-05T00:00:00Z", "2026-02-04T00:00:00Z")),
    ).toHaveLength(0);
    expect(fetchScans).not.toHaveBeenCalled();
  });

  it("retries a provider that fails transiently", async () => {
    const inner = createFakeScanProvider({ scans: makeScans(3, "2026-02-04"), pageSize: 1000 });
    let calls = 0;
    const flaky: ScanProvider = {
      name: "flaky",
      pageSize: 1000,
      async fetchScans(window) {
        calls++;
        if (calls === 1) {
          throw new Error("ECONNRESET");
        }
        return inner.fetchScans(window);
      },
    };

    const batches = await drain(
      createScanFetcher({ provider: flaky, retry }).fetchRange(
        "2026-02-04T00:00:00Z",
        "2026-02-05T00:00:00Z",
      ),
    );

    expect(batches.flat()).toHaveLength(3);
    expect(calls).toBe(2);
  });
});
