import { Router } from "express";
import type Database from "better-sqlite3";
import { NotFoundError } from "../errors/index.js";
import { syncHandler } from "../middleware/async-handler.js";
import { sendSuccess } from "../utils/respond.js";
import { parsePagination } from "../utils/pagination.js";
import { createPlayerRepository } from "../../repositories/player.repository.js";
import { createScanRepository } from "../../repositories/scan.repository.js";

export function createPlayersRouter(db: Database.Database): Router {
  const router = Router();
  const playerRepo = createPlayerRepository(db);
  const scanRepo = createScanRepository(db);

  router.get(
    "/players",
    syncHandler((req, res) => {
      const { limit, offset } = parsePagination(req.query);
      const { players, total } = playerRepo.getPlayerPage(limit, offset);
      sendSuccess(res, { players, total, limit, offset });
    }),
  );

  router.get(
    "/players/top",
    syncHandler((_req, res) => {
      const player = playerRepo.getTopPlayer();
      if (!player) {
        throw new NotFoundError("No players have been recorded yet", null, "PLAYERS_EMPTY");
      }
      sendSuccess(res, { player });
    }),
  );

  router.get(
    "/players/bottom",
    syncHandler((_req, res) => {
      const player = playerRepo.getBottomPlayer();
      if (!player) {
        throw new NotFoundError("No players have been recorded yet", null, "PLAYERS_EMPTY");
      }
      sendSuccess(res, { player });
    }),
  );

  // Registered after /players/top and /players/bottom so those literals win.
  router.get(
    "/players/:badgeId",
    syncHandler((req, res) => {
      const badgeId = String(req.params["badgeId"] ?? "");
      const player = playerRepo.getPlayerById(badgeId);
      if (!player) {
        throw new NotFoundError("Player not found", { badgeId }, "PLAYER_NOT_FOUND");
      }

      // A player's visit history is paginated like every other list — a badge
      // with thousands of scans must not be able to produce an unbounded response.
      const { limit, offset } = parsePagination(req.query);
      const { rows, total } = scanRepo.searchScans({ badgeId, limit, offset });

      sendSuccess(res, {
        ...player,
        scans: rows.map((s) => ({ boothName: s.booth_name, scanDate: s.scan_date })),
        scansTotal: total,
        limit,
        offset,
      });
    }),
  );

  return router;
}
