import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { sendSuccess } from "../utils/respond.js";
import type { InsightService } from "../../services/insight.service.js";

export function createInsightsRouter(service: InsightService): Router {
  const router = Router();

  router.get(
    "/insights/summary",
    asyncHandler(async (_req, res) => {
      sendSuccess(res, await service.briefing());
    }),
  );

  return router;
}
