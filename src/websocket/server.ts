import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import type { PlayerScanCount, WsMessage } from "../types/domain.js";
import { logger } from "../utils/logger.js";
import { createBroadcaster, type Broadcaster } from "./broadcaster.js";

export interface WsServerOptions {
  httpServer: Server;
  /** Bounded leaderboard sent on connect. */
  getSnapshot: () => PlayerScanCount[];
  heartbeatMs: number;
  maxBufferedBytes: number;
}

export interface WsServerHandle {
  broadcaster: Broadcaster;
  /** Stops the heartbeat and closes every socket. Safe to call more than once. */
  close(): Promise<void>;
}

/**
 * `ws` removes a socket from `wss.clients` on a clean close, but a client that
 * vanishes without a FIN (laptop lid, dropped NAT entry) leaves a half-open
 * socket that is still counted and still written to. The ping/pong heartbeat
 * below terminates anything that has not answered within one interval.
 */
export function createWsServer(options: WsServerOptions): WsServerHandle {
  const { httpServer, getSnapshot, heartbeatMs, maxBufferedBytes } = options;

  const wss = new WebSocketServer({ server: httpServer });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const remoteAddress = req.socket.remoteAddress;
    logger.info({ remoteAddress }, "WebSocket client connected");

    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));

    const snapshot: WsMessage = { type: "snapshot", players: getSnapshot() };
    socket.send(JSON.stringify(snapshot));

    socket.on("error", (err) => logger.error({ err, remoteAddress }, "WebSocket socket error"));
    socket.on("close", () => {
      alive.delete(socket);
      logger.info({ remoteAddress }, "WebSocket client disconnected");
    });
  });

  wss.on("error", (err) => logger.error({ err }, "WebSocketServer error"));

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        logger.info("Terminating unresponsive WebSocket client");
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    broadcaster: createBroadcaster(wss, { maxBufferedBytes }),
    close(): Promise<void> {
      clearInterval(heartbeat);
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
