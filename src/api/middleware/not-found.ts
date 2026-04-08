import type { Request, Response } from "express";
import { sendFailure } from "../utils/respond.js";

export function notFoundHandler(req: Request, res: Response): void {
  sendFailure(res, 404, {
    code: "NOT_FOUND",
    message: `No route for ${req.method} ${req.path}`,
    details: null,
  });
}
