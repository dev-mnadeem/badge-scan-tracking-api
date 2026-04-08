import { Router } from "express";
import type Database from "better-sqlite3";
import { syncHandler } from "../middleware/async-handler.js";
import { sendSuccess, sendFailure } from "../utils/respond.js";
import { logger } from "../../utils/logger.js";

export interface HealthRouterOptions {
  db: Database.Database;
}

/**
 * Liveness plus a real readiness signal: the database is actually queried, so a
 * corrupt or unwritable DB file surfaces as a 503 instead of a cheerful 200.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const { db } = options;
  const router = Router();

  router.get(
    "/health",
    syncHandler((_req, res) => {
      const ts = new Date().toISOString();
      try {
        db.prepare("SELECT 1 AS ok").get();
      } catch (err) {
        logger.error({ err }, "Health check database probe failed");
        sendFailure(res, 503, {
          code: "DB_UNAVAILABLE",
          message: "Database probe failed",
          details: null,
        });
        return;
      }
      sendSuccess(res, { ok: true, ts, database: "ok" });
    }),
  );

  return router;
}
