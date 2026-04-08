import { describe, it, expect, vi } from "vitest";
import type { WebSocketServer } from "ws";
import { createBroadcaster, createNullBroadcaster } from "./broadcaster.js";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const OPEN = 1;
const CLOSING = 2;

function fakeClient(readyState: number, bufferedAmount = 0) {
  return { readyState, bufferedAmount, send: vi.fn(), terminate: vi.fn() };
}

function serverWith(...clients: ReturnType<typeof fakeClient>[]): WebSocketServer {
  return { clients: new Set(clients) } as unknown as WebSocketServer;
}

const players = [{ badgeId: "badge-001", scanCount: 3, lastScanDate: "2026-02-04T09:00:00" }];

describe("createBroadcaster", () => {
  it("sends one update frame to every open client", () => {
    const a = fakeClient(OPEN);
    const b = fakeClient(OPEN);
    const broadcaster = createBroadcaster(serverWith(a, b), { maxBufferedBytes: 1024 });

    expect(broadcaster.publish(players)).toBe(2);
    expect(JSON.parse(a.send.mock.calls[0]![0] as string)).toEqual({ type: "update", players });
    expect(b.send).toHaveBeenCalledOnce();
  });

  it("skips clients that are not open", () => {
    const closing = fakeClient(CLOSING);
    const broadcaster = createBroadcaster(serverWith(closing), { maxBufferedBytes: 1024 });

    expect(broadcaster.publish(players)).toBe(0);
    expect(closing.send).not.toHaveBeenCalled();
  });

  it("terminates a client whose send buffer has grown past the limit", () => {
    // `ws` buffers without bound, so one reader that stops draining would
    // otherwise grow the server heap until the process dies.
    const slow = fakeClient(OPEN, 2048);
    const healthy = fakeClient(OPEN, 0);
    const broadcaster = createBroadcaster(serverWith(slow, healthy), { maxBufferedBytes: 1024 });

    expect(broadcaster.publish(players)).toBe(1);
    expect(slow.terminate).toHaveBeenCalledOnce();
    expect(slow.send).not.toHaveBeenCalled();
    expect(healthy.send).toHaveBeenCalledOnce();
  });

  it("counts only open clients", () => {
    const broadcaster = createBroadcaster(serverWith(fakeClient(OPEN), fakeClient(CLOSING)), {
      maxBufferedBytes: 1024,
    });
    expect(broadcaster.clientCount()).toBe(1);
  });
});

describe("createNullBroadcaster", () => {
  it("accepts publishes and reports no clients", () => {
    const broadcaster = createNullBroadcaster();
    expect(broadcaster.publish(players)).toBe(0);
    expect(broadcaster.clientCount()).toBe(0);
  });
});
