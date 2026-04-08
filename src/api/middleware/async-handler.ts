import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async route so rejected promises are forwarded to Express error middleware.
 * (express-async-errors targets Express 4; Express 5 users should use this wrapper.)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Wraps a sync route so `throw` is forwarded to Express error middleware (Express does not
 * always do this for synchronous handlers).
 */
export function syncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => void,
): RequestHandler {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}
