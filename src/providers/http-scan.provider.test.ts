import { describe, it, expect, vi } from "vitest";
import type { AxiosInstance } from "axios";
import { boundsToQueryParams, buildScanUrl, createHttpScanProvider } from "./http-scan.provider.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const API_URL = "https://portal.example.com/api/scan";

function clientReturning(response: unknown): AxiosInstance {
  return { post: vi.fn().mockResolvedValue(response) } as unknown as AxiosInstance;
}

function provider(client: AxiosInstance) {
  return createHttpScanProvider({
    apiUrl: API_URL,
    apiToken: "test-token",
    timeoutMs: 1000,
    pageSize: 1000,
    client,
  });
}

const okJson = (data: unknown) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  data,
});

describe("boundsToQueryParams", () => {
  it("uses second precision for a window wider than one second", () => {
    const { scanDateGT, scanDateLT } = boundsToQueryParams(
      Date.UTC(2026, 1, 4, 9, 0, 0),
      Date.UTC(2026, 1, 4, 10, 0, 0),
    );
    expect(scanDateGT).toBe("2026-02-04T09:00:00");
    expect(scanDateLT).toBe("2026-02-04T10:00:00");
  });

  it("falls back to millisecond precision inside a single second", () => {
    const { scanDateGT, scanDateLT } = boundsToQueryParams(
      Date.UTC(2026, 1, 4, 9, 0, 0, 100),
      Date.UTC(2026, 1, 4, 9, 0, 0, 900),
    );
    expect(scanDateGT).toBe("2026-02-04T09:00:00.100");
    expect(scanDateLT).toBe("2026-02-04T09:00:00.900");
  });

  it("rounds a mid-second window outwards so no scan falls outside the query", () => {
    const { scanDateGT, scanDateLT } = boundsToQueryParams(
      Date.UTC(2026, 1, 4, 9, 0, 0, 500),
      Date.UTC(2026, 1, 4, 9, 0, 2, 500),
    );
    expect(scanDateGT).toBe("2026-02-04T09:00:00");
    expect(scanDateLT).toBe("2026-02-04T09:00:03");
  });

  it("refuses an inverted or empty window", () => {
    expect(() => boundsToQueryParams(10, 10)).toThrow(RangeError);
  });
});

describe("buildScanUrl", () => {
  it("puts both bounds on the query string", () => {
    const url = new URL(buildScanUrl(API_URL, "2026-02-04T09:00:00", "2026-02-04T10:00:00"));
    expect(url.searchParams.get("scanDateGT")).toBe("2026-02-04T09:00:00");
    expect(url.searchParams.get("scanDateLT")).toBe("2026-02-04T10:00:00");
  });
});

describe("createHttpScanProvider", () => {
  const window = { fromMs: Date.UTC(2026, 1, 4, 9), toMs: Date.UTC(2026, 1, 4, 10) };

  it("returns validated rows on a 200 JSON response", async () => {
    const rows = [{ badgeId: "badge-001", scanDate: "2026-02-04T09:30:00", customFields: [] }];
    await expect(provider(clientReturning(okJson(rows))).fetchScans(window)).resolves.toEqual(rows);
  });

  it("sends the token in the request body, never on the query string", async () => {
    const client = clientReturning(okJson([]));
    await provider(client).fetchScans(window);
    const [url, body] = vi.mocked(client.post).mock.calls[0]!;
    expect(url).not.toContain("test-token");
    expect(body).toEqual({ token: "test-token" });
  });

  it("throws on a non-200 status", async () => {
    const client = clientReturning({ status: 503, headers: {}, data: "" });
    await expect(provider(client).fetchScans(window)).rejects.toThrow(
      "Scan API returned status 503",
    );
  });

  it("throws when the response is not JSON", async () => {
    const client = clientReturning({
      status: 200,
      headers: { "content-type": "text/html" },
      data: "<html>",
    });
    await expect(provider(client).fetchScans(window)).rejects.toThrow(
      "Scan API response must be application/json",
    );
  });

  it("throws when the payload does not match the documented shape", async () => {
    const client = clientReturning(okJson([{ nope: true }]));
    await expect(provider(client).fetchScans(window)).rejects.toThrow("Invalid API response shape");
  });
});
