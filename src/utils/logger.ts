import pino from "pino";

/**
 * Reads LOG_LEVEL straight from the process environment rather than importing
 * the parsed config, so that config parsing (which logs) cannot depend on the
 * logger and vice versa. An unrecognised value falls back to "info".
 */
const LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const requested = process.env["LOG_LEVEL"] ?? "info";
const level = LEVELS.has(requested) ? requested : "info";

const prettyPrint = process.env["NODE_ENV"] !== "production" && process.stdout.isTTY;

export const logger = pino({
  level,
  ...(prettyPrint && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard" },
    },
  }),
});

export type Logger = typeof logger;
