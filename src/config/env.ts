import { z } from "zod";
import { DEFAULT_SCAN_PAGE_SIZE } from "./constants.js";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

/**
 * Which implementation of the scan provider to bind at startup.
 * `fake` replays a checked-in fixture and needs no network and no credentials,
 * so a fresh clone and the test suite both run offline.
 */
export const SCAN_PROVIDERS = ["http", "fake"] as const;

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().max(65535).default(3000),

    SCAN_PROVIDER: z.enum(SCAN_PROVIDERS).default("http"),
    API_URL: z.string().url().default("https://portal.eventscloud.com/api/scan"),
    API_TOKEN: z.string().min(1).optional(),
    API_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    SCAN_PAGE_SIZE: z.coerce.number().int().positive().default(DEFAULT_SCAN_PAGE_SIZE),
    SCAN_FIXTURE_PATH: z.string().default("./fixtures/sample-scans.json"),

    RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(1_000),
    RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).default(30_000),

    EVENT_START_DATE: z.string().default(new Date(0).toISOString()),
    POLL_INTERVAL_CRON: z.string().default("*/5 * * * *"),
    POLL_ON_STARTUP: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    DB_PATH: z.string().default("./fankave.db"),

    WS_HEARTBEAT_MS: z.coerce.number().int().positive().default(30_000),
    /** A client buffering more than this many unsent bytes is dropped. */
    WS_MAX_BUFFERED_BYTES: z.coerce.number().int().positive().default(1_048_576),
    /** How many players a broadcast carries. Keeps payloads bounded as the event grows. */
    WS_LEADERBOARD_LIMIT: z.coerce.number().int().positive().max(1000).default(100),

    INSIGHTS_PROVIDER: z.enum(["local", "anthropic"]).default("local"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),

    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.SCAN_PROVIDER === "http" && !cfg.API_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["API_TOKEN"],
        message:
          "API_TOKEN is required when SCAN_PROVIDER=http (use SCAN_PROVIDER=fake to run offline)",
      });
    }
    if (cfg.INSIGHTS_PROVIDER === "anthropic" && !cfg.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when INSIGHTS_PROVIDER=anthropic",
      });
    }
    if (cfg.RETRY_MAX_DELAY_MS < cfg.RETRY_BASE_DELAY_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["RETRY_MAX_DELAY_MS"],
        message: "RETRY_MAX_DELAY_MS must be >= RETRY_BASE_DELAY_MS",
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Pure parse — throws instead of exiting, so tests and tooling can build a
 * config from an arbitrary source without taking down the process.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(source);
}

/**
 * Parse for the composition root: prints the offending variables and exits,
 * because a process that cannot read its own configuration should not start.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    console.error("[config] Invalid environment variables:\n", fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
