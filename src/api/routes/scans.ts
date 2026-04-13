import { Router } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import { syncHandler } from "../middleware/async-handler.js";
import { sendSuccess } from "../utils/respond.js";
import { parsePagination } from "../utils/pagination.js";
import { createScanRepository } from "../../repositories/scan.repository.js";

const FilterSchema = z.object({
  badgeId: z.string().min(1).optional(),
  boothName: z.string().min(1).optional(),
  scanDate: z.string().min(1).optional(),
});

export function createScansRouter(db: Database.Database): Router {
  const router = Router();
  const scanRepo = createScanRepository(db);

  router.get(
    "/scans",
    syncHandler((req, res) => {
      const query = req.query as Record<string, unknown>;
      const filters = FilterSchema.parse({
        badgeId: query["badgeId"],
        boothName: query["boothName"],
        scanDate: query["scanDate"],
      });
      const { limit, offset } = parsePagination(query);

      const { rows, total } = scanRepo.searchScans({ ...filters, limit, offset });

      sendSuccess(res, {
        scans: rows.map((s) => ({
          badgeId: s.badge_id,
          boothName: s.booth_name,
          scanDate: s.scan_date,
        })),
        total,
        limit,
        offset,
      });
    }),
  );

  return router;
}
