import { Router } from "express";
import type Database from "better-sqlite3";
import { syncHandler } from "../middleware/async-handler.js";
import { sendSuccess } from "../utils/respond.js";
import { createScanRepository } from "../../repositories/scan.repository.js";
import { createCheckpointRepository } from "../../repositories/checkpoint.repository.js";
import type { PollMetrics } from "../../metrics/registry.js";
import type { Broadcaster } from "../../websocket/broadcaster.js";

export interface MetricsRouterOptions {
  db: Database.Database;
  metrics: PollMetrics;
  broadcaster: Broadcaster;
  scanProviderName: string;
}

/**
 * Answers the question a reviewer or an on-call operator actually asks: is the
 * poller running, is it succeeding, and where has it got to?
 */
export function createMetricsRouter(options: MetricsRouterOptions): Router {
  const { db, metrics, broadcaster, scanProviderName } = options;
  const router = Router();

  const scanRepo = createScanRepository(db);
  const checkpointRepo = createCheckpointRepository(db);

  router.get(
    "/metrics",
    syncHandler((_req, res) => {
      sendSuccess(res, {
        uptimeSeconds: Math.round(process.uptime()),
        scanProvider: scanProviderName,
        poll: metrics.snapshot(),
        checkpoint: {
          lastScanDate: checkpointRepo.getLastScanDate(),
          updatedAt: checkpointRepo.getLastScanDateUpdatedAt(),
        },
        storage: { scansStored: scanRepo.countScans() },
        websocket: { connectedClients: broadcaster.clientCount() },
      });
    }),
  );

  return router;
}
