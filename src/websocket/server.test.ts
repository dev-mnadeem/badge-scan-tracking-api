import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WebSocket } from "ws";
import type { PlayerScanCount, WsMessage } from "../types/domain.js";
import { createWsServer, type WsServerHandle } from "./server.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const leaderboard: PlayerScanCount[] = [
  { badgeId: "badge-017", scanCount: 13, lastScanDate: "2026-02-04T16:41:02" },
  { badgeId: "badge-004", scanCount: 11, lastScanDate: "2026-02-04T15:12:40" },
];

let httpServer: http.Server | undefined;
let handle: WsServerHandle | undefined;

afterEach(async () => {
  await handle?.close();
  await new Promise<void>((resolve) =>
    httpServer ? httpServer.close(() => resolve()) : resolve(),
  );
  handle = undefined;
  httpServer = undefined;
});

async function start(heartbeatMs = 60_000): Promise<string> {
  httpServer = http.createServer();
  handle = createWsServer({
    httpServer,
    getSnapshot: () => leaderboard,
    heartbeatMs,
    maxBufferedBytes: 1_048_576,
  });
  const server = httpServer;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Connects and collects every frame the server sends, parsed. */
async function connect(
  url: string,
  autoPong = true,
): Promise<{ socket: WebSocket; frames: WsMessage[] }> {
  const socket = new WebSocket(url, { autoPong });
  const frames: WsMessage[] = [];
  socket.on("message", (data: Buffer) => frames.push(JSON.parse(data.toString()) as WsMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, frames };
}

async function until(condition: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(condition()).toBe(true), { timeout: 2_000, interval: 10 });
}

describe("createWsServer", () => {
  it("sends the current leaderboard as a snapshot on connect", async () => {
    const { socket, frames } = await connect(await start());
    await until(() => frames.length === 1);
    expect(frames[0]).toEqual({ type: "snapshot", players: leaderboard });
    socket.close();
  });

  it("pushes a published leaderboard to every open client as an update", async () => {
    const url = await start();
    const first = await connect(url);
    const second = await connect(url);
    await until(() => first.frames.length === 1 && second.frames.length === 1);

    const next = [{ badgeId: "badge-001", scanCount: 14, lastScanDate: "2026-02-04T16:58:44" }];
    expect(handle?.broadcaster.publish(next)).toBe(2);
    expect(handle?.broadcaster.clientCount()).toBe(2);

    await until(() => first.frames.length === 2 && second.frames.length === 2);
    expect(first.frames[1]).toEqual({ type: "update", players: next });
    expect(second.frames[1]).toEqual({ type: "update", players: next });
    first.socket.close();
    second.socket.close();
  });

  it("terminates a client that stops answering pings", async () => {
    // autoPong off makes the client behave like a peer that vanished without a FIN.
    const { socket } = await connect(await start(30), false);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await closed;
    expect(handle?.broadcaster.clientCount()).toBe(0);
  });
});
