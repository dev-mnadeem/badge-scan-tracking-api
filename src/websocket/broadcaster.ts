import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";
import type { PlayerScanCount, WsMessage } from "../types/domain.js";
import { logger } from "../utils/logger.js";

export interface Broadcaster {
  /** Pushes a leaderboard update to every open client. Returns how many received it. */
  publish(players: PlayerScanCount[]): number;
  clientCount(): number;
}

export interface BroadcasterOptions {
  /**
   * A client whose socket has more than this many unsent bytes queued is not
   * keeping up. `ws` buffers without limit, so a single stalled reader would
   * otherwise grow the server's heap until it dies. Such a client is terminated
   * and can reconnect, at which point it gets a fresh snapshot anyway.
   */
  maxBufferedBytes: number;
}

/** No-op broadcaster, used when the poll cycle runs without a WebSocket server attached. */
export function createNullBroadcaster(): Broadcaster {
  return { publish: () => 0, clientCount: () => 0 };
}

export function createBroadcaster(wss: WebSocketServer, options: BroadcasterOptions): Broadcaster {
  const { maxBufferedBytes } = options;

  return {
    publish(players: PlayerScanCount[]): number {
      const message: WsMessage = { type: "update", players };
      const payload = JSON.stringify(message);

      let sent = 0;
      let dropped = 0;

      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) {
          continue;
        }
        if (client.bufferedAmount > maxBufferedBytes) {
          dropped++;
          client.terminate();
          continue;
        }
        client.send(payload);
        sent++;
      }

      if (dropped > 0) {
        logger.warn({ dropped, maxBufferedBytes }, "Terminated WebSocket clients that fell behind");
      }
      if (sent > 0) {
        logger.debug({ clients: sent, players: players.length }, "Broadcast sent");
      }

      return sent;
    },

    clientCount(): number {
      let open = 0;
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          open++;
        }
      }
      return open;
    },
  };
}
