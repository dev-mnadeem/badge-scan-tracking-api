import type { AppConfig } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { createFakeScanProvider, loadScanFixture } from "./fake-scan.provider.js";
import { createHttpScanProvider } from "./http-scan.provider.js";
import type { ScanProvider } from "./scan-provider.js";

export type { ScanProvider, ScanWindow } from "./scan-provider.js";
export { createFakeScanProvider, loadScanFixture } from "./fake-scan.provider.js";
export { createHttpScanProvider } from "./http-scan.provider.js";

/** Binds the scan provider named by SCAN_PROVIDER. */
export function createScanProvider(config: AppConfig): ScanProvider {
  if (config.SCAN_PROVIDER === "fake") {
    const scans = loadScanFixture(config.SCAN_FIXTURE_PATH);
    logger.info(
      { provider: "fake", fixture: config.SCAN_FIXTURE_PATH, scans: scans.length },
      "Scan provider bound",
    );
    return createFakeScanProvider({ scans, pageSize: config.SCAN_PAGE_SIZE });
  }

  logger.info({ provider: "http", apiUrl: config.API_URL }, "Scan provider bound");
  return createHttpScanProvider({
    apiUrl: config.API_URL,
    // Guaranteed present for SCAN_PROVIDER=http by the config schema's refinement.
    apiToken: config.API_TOKEN as string,
    timeoutMs: config.API_TIMEOUT_MS,
    pageSize: config.SCAN_PAGE_SIZE,
  });
}
