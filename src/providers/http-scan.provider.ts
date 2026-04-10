import axios, { type AxiosInstance } from "axios";
import { ApiResponseSchema, type RawScan } from "../types/api.js";
import { logger } from "../utils/logger.js";
import type { ScanProvider, ScanWindow } from "./scan-provider.js";

export interface HttpScanProviderOptions {
  apiUrl: string;
  apiToken: string;
  timeoutMs: number;
  pageSize: number;
  /** Injectable for tests. */
  client?: AxiosInstance;
}

const MS_PER_SECOND = 1000;

/**
 * Builds the `scanDateGT` / `scanDateLT` query values.
 *
 * The upstream API reports and accepts whole-second timestamps, so a window
 * whose bounds fall mid-second has to be rounded. It is rounded **outwards** —
 * the lower bound down, the upper bound up — so the query always covers at
 * least the requested window. Rounding inwards would silently drop the scans
 * in the rounded-off fraction of a second, whereas rounding outwards only
 * re-fetches a little, and re-fetching is free: the insert is idempotent.
 *
 * Once the poller has bisected down inside a single second, whole seconds can
 * no longer separate the two halves, so the exact millisecond bounds are sent.
 */
export function boundsToQueryParams(
  fromMs: number,
  toMs: number,
): { scanDateGT: string; scanDateLT: string } {
  if (fromMs >= toMs) {
    throw new RangeError("scanDateGT must be strictly less than scanDateLT");
  }

  const flooredFrom = Math.floor(fromMs / MS_PER_SECOND) * MS_PER_SECOND;
  const ceiledTo = Math.ceil(toMs / MS_PER_SECOND) * MS_PER_SECOND;

  if (ceiledTo - flooredFrom <= MS_PER_SECOND) {
    return {
      scanDateGT: new Date(fromMs).toISOString().slice(0, 23),
      scanDateLT: new Date(toMs).toISOString().slice(0, 23),
    };
  }

  return {
    scanDateGT: new Date(flooredFrom).toISOString().slice(0, 19),
    scanDateLT: new Date(ceiledTo).toISOString().slice(0, 19),
  };
}

export function buildScanUrl(apiUrl: string, scanDateGT: string, scanDateLT: string): string {
  const url = new URL(apiUrl);
  url.searchParams.set("scanDateGT", scanDateGT);
  url.searchParams.set("scanDateLT", scanDateLT);
  return url.toString();
}

/** Talks to the live EventsCloud scan endpoint. Requires API_TOKEN. */
export function createHttpScanProvider(options: HttpScanProviderOptions): ScanProvider {
  const { apiUrl, apiToken, timeoutMs, pageSize, client = axios } = options;

  return {
    name: "http",
    pageSize,

    async fetchScans({ fromMs, toMs }: ScanWindow): Promise<RawScan[]> {
      const { scanDateGT, scanDateLT } = boundsToQueryParams(fromMs, toMs);
      const url = buildScanUrl(apiUrl, scanDateGT, scanDateLT);

      const response = await client.post<unknown>(
        url,
        { token: apiToken },
        {
          headers: { "Content-Type": "application/json" },
          timeout: timeoutMs,
          validateStatus: () => true,
        },
      );

      if (response.status !== 200) {
        logger.error(
          { status: response.status, scanDateGT, scanDateLT },
          "Scan API non-200 response",
        );
        throw new Error(`Scan API returned status ${response.status}`);
      }

      const contentType = String(response.headers["content-type"] ?? "");
      if (!contentType.includes("application/json")) {
        logger.error({ contentType, scanDateGT, scanDateLT }, "Scan API response is not JSON");
        throw new Error("Scan API response must be application/json");
      }

      const parsed = ApiResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        logger.error({ issues: parsed.error.issues }, "Scan API response failed schema validation");
        throw new Error("Invalid API response shape");
      }

      return parsed.data;
    },
  };
}
