import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../../utils/logger.js";
import { AppError } from "../errors/app-error.js";
import { sendFailure } from "../utils/respond.js";

/**
 * Unless API_DEBUG_ERRORS=true, an unrecognised error becomes a generic 500 with
 * no message and no stack, so an internal failure cannot leak table names,
 * file paths or upstream URLs to a client.
 */
function exposeInternals(): boolean {
  return process.env["API_DEBUG_ERRORS"] === "true";
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ZodError) {
    sendFailure(res, 422, {
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: err.flatten(),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, code: err.code, statusCode: err.statusCode }, "Application error (5xx)");
    }
    sendFailure(res, err.statusCode, {
      code: err.code,
      message: err.message,
      details: err.details ?? null,
    });
    return;
  }

  const unknown = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: unknown }, "Unhandled error");

  const debug = exposeInternals();
  sendFailure(res, 500, {
    code: "INTERNAL_ERROR",
    message: debug ? unknown.message : "An unexpected error occurred",
    details: debug ? { stack: unknown.stack ?? null } : null,
  });
}
