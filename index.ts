import "dotenv/config";
import http from "node:http";
import { loadConfig } from "./src/config/env.js";
import { openDatabase } from "./src/db/client.js";
import { createApp } from "./src/app.js";
import { createWsServer } from "./src/websocket/server.js";
import { createScanProvider } from "./src/providers/index.js";
import { createScanFetcher } from "./src/services/poller.service.js";
import { createPollMetrics } from "./src/metrics/registry.js";
import { startScheduler } from "./src/scheduler/index.js";
import { createPlayerRepository } from "./src/repositories/player.repository.js";
import {
  createAnthropicInsightProvider,
  createInsightService,
  createLocalInsightProvider,
  type InsightProvider,
} from "./src/services/insight.service.js";
import { logger } from "./src/utils/logger.js";

const config = loadConfig();

const db = openDatabase(config.DB_PATH);
const metrics = createPollMetrics();
const playerRepo = createPlayerRepository(db);
const scanProvider = createScanProvider(config);

// The HTTP server must exist before the WebSocket server, which attaches to it.
const httpServer = http.createServer();

const ws = createWsServer({
  httpServer,
  getSnapshot: () => playerRepo.getLeaderboard(config.WS_LEADERBOARD_LIMIT),
  heartbeatMs: config.WS_HEARTBEAT_MS,
  maxBufferedBytes: config.WS_MAX_BUFFERED_BYTES,
});

const localInsights = createLocalInsightProvider();
const primaryInsights: InsightProvider =
  config.INSIGHTS_PROVIDER === "anthropic"
    ? createAnthropicInsightProvider({
        apiKey: config.ANTHROPIC_API_KEY as string,
        model: config.ANTHROPIC_MODEL,
      })
    : localInsights;

const insights = createInsightService({
  db,
  primary: primaryInsights,
  fallback: localInsights,
  onPrimaryError: (err) =>
    logger.warn({ err }, "Insight provider failed, falling back to the local briefing"),
});

httpServer.on(
  "request",
  createApp({
    db,
    metrics,
    broadcaster: ws.broadcaster,
    insights,
    scanProviderName: scanProvider.name,
  }),
);

const scheduler = startScheduler({
  cronExpression: config.POLL_INTERVAL_CRON,
  runOnStartup: config.POLL_ON_STARTUP,
  metrics,
  cycle: {
    db,
    fetcher: createScanFetcher({
      provider: scanProvider,
      retry: {
        maxAttempts: config.RETRY_MAX_ATTEMPTS,
        baseDelayMs: config.RETRY_BASE_DELAY_MS,
        maxDelayMs: config.RETRY_MAX_DELAY_MS,
      },
    }),
    broadcaster: ws.broadcaster,
    eventStartDate: config.EVENT_START_DATE,
    leaderboardLimit: config.WS_LEADERBOARD_LIMIT,
  },
});

httpServer.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, scanProvider: scanProvider.name, insights: config.INSIGHTS_PROVIDER },
    "HTTP and WebSocket server listening",
  );
});

let shuttingDown = false;

/** Stops the poll timer and the heartbeat before closing sockets, so nothing schedules work mid-shutdown. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  scheduler.stop();
  await ws.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  db.close();

  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
