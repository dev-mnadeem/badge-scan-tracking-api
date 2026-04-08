import { Router } from "express";
import type Database from "better-sqlite3";
import { syncHandler } from "../middleware/async-handler.js";
import { sendSuccess } from "../utils/respond.js";
import { parsePagination } from "../utils/pagination.js";
import { createScanRepository } from "../../repositories/scan.repository.js";

export function createBoothsRouter(db: Database.Database): Router {
  const router = Router();
  const scanRepo = createScanRepository(db);

  router.get(
    "/booths",
    syncHandler((req, res) => {
      const { limit, offset } = parsePagination(req.query);
      const { booths, total } = scanRepo.getBoothStats(limit, offset);
      sendSuccess(res, { booths, total, limit, offset });
    }),
  );

  return router;
}
