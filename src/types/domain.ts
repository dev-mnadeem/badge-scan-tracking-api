export interface Scan {
  badgeId: string;
  boothName: string;
  scanDate: string;
}

export interface PlayerScanCount {
  badgeId: string;
  scanCount: number;
  lastScanDate: string | null;
}

export type WsMessage =
  { type: "snapshot"; players: PlayerScanCount[] } | { type: "update"; players: PlayerScanCount[] };
