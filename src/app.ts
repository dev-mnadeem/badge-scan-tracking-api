import express, { type Express } from "express";
import type Database from "better-sqlite3";
import { createHealthRouter } from "./api/routes/health.js";
import { createPlayersRouter } from "./api/routes/players.js";
import { createScansRouter } from "./api/routes/scans.js";
import { createBoothsRouter } from "./api/routes/booths.js";
import { createMetricsRouter } from "./api/routes/metrics.js";
import { createInsightsRouter } from "./api/routes/insights.js";
import { errorHandler } from "./api/middleware/error-handler.js";
import { notFoundHandler } from "./api/middleware/not-found.js";
import type { PollMetrics } from "./metrics/registry.js";
import type { Broadcaster } from "./websocket/broadcaster.js";
import type { InsightService } from "./services/insight.service.js";

export interface AppDependencies {
  db: Database.Database;
  metrics: PollMetrics;
  broadcaster: Broadcaster;
  insights: InsightService;
  scanProviderName: string;
}

/**
 * Builds the Express app from explicit dependencies. Nothing here opens a
 * database, reads the environment or starts a timer, so a test can mount the
 * whole API over an in-memory database.
 */
export function createApp(deps: AppDependencies): Express {
  const { db, metrics, broadcaster, insights, scanProviderName } = deps;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use(createHealthRouter({ db }));
  app.use(createMetricsRouter({ db, metrics, broadcaster, scanProviderName }));
  app.use(createPlayersRouter(db));
  app.use(createScansRouter(db));
  app.use(createBoothsRouter(db));
  app.use(createInsightsRouter(insights));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
