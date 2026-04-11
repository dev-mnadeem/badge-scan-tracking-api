import cron from "node-cron";
import { runPollCycle, type PollCycleOptions } from "../services/scan.service.js";
import type { PollMetrics } from "../metrics/registry.js";
import { logger } from "../utils/logger.js";

export interface SchedulerOptions {
  cronExpression: string;
  /** Run one cycle at startup instead of waiting a whole interval for the first data. */
  runOnStartup: boolean;
  metrics: PollMetrics;
  cycle: Omit<PollCycleOptions, "metrics">;
}

export interface SchedulerHandle {
  /** Runs a cycle now, unless one is already in flight. Resolves once it settles. */
  trigger(): Promise<void>;
  stop(): void;
}

/**
 * Drives `runPollCycle` on a cron expression. The overlap guard is per-handle
 * rather than module-global, so two schedulers (or two tests) never share state.
 */
export function startScheduler(options: SchedulerOptions): SchedulerHandle {
  const { cronExpression, runOnStartup, metrics, cycle } = options;

  if (!cron.validate(cronExpression)) {
    throw new Error(`POLL_INTERVAL_CRON is not a valid cron expression: ${cronExpression}`);
  }

  let inFlight: Promise<void> | null = null;

  async function runOnce(): Promise<void> {
    if (inFlight) {
      metrics.cycleSkipped();
      logger.warn("Poll cycle already in progress, skipping this tick");
      return inFlight;
    }

    const startedAt = Date.now();
    metrics.cycleStarted();

    inFlight = (async () => {
      try {
        await runPollCycle({ ...cycle, metrics });
        metrics.cycleSucceeded(Date.now() - startedAt);
      } catch (err) {
        // Retries are already exhausted at this point. The checkpoint was not
        // advanced, so the next tick resumes from the last committed position
        // and nothing is lost — a failed cycle is not a fatal condition.
        metrics.cycleFailed(err);
        logger.error({ err }, "Poll cycle failed after all retries, will resume on the next tick");
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  logger.info({ cron: cronExpression, runOnStartup }, "Starting poll scheduler");
  const task = cron.schedule(cronExpression, () => void runOnce());

  if (runOnStartup) {
    void runOnce();
  }

  return {
    trigger: runOnce,
    stop() {
      void task.stop();
    },
  };
}
