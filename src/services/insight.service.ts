import type Database from "better-sqlite3";
import { createScanRepository } from "../repositories/scan.repository.js";
import { createPlayerRepository } from "../repositories/player.repository.js";
import { createCheckpointRepository } from "../repositories/checkpoint.repository.js";

/** How many booths the briefing reasons about. Keeps the prompt and the query bounded. */
const BOOTHS_IN_BRIEFING = 10;

export interface BoothSummary {
  boothName: string;
  scanCount: number;
  uniquePlayers: number;
}

/**
 * Everything the briefing is allowed to talk about, computed straight from SQL.
 * Any provider that invents a number outside this object is making it up.
 */
export interface EventStats {
  totalScans: number;
  totalPlayers: number;
  totalBooths: number;
  averageScansPerPlayer: number;
  busiestBooth: BoothSummary | null;
  quietestBooth: BoothSummary | null;
  booths: BoothSummary[];
  topPlayerScanCount: number | null;
  bottomPlayerScanCount: number | null;
  lastScanDate: string | null;
}

export interface EventBriefing {
  /** Which implementation wrote the text. "local" needs no API key. */
  provider: string;
  text: string;
  stats: EventStats;
}

/**
 * The seam for the briefing writer. Both implementations receive the same
 * pre-computed stats, so the only difference is prose, never arithmetic.
 */
export interface InsightProvider {
  readonly name: string;
  summarize(stats: EventStats): Promise<string>;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function computeEventStats(db: Database.Database): EventStats {
  const scanRepo = createScanRepository(db);
  const playerRepo = createPlayerRepository(db);
  const checkpointRepo = createCheckpointRepository(db);

  const totalScans = scanRepo.countScans();
  const { booths: boothRows, total: totalBooths } = scanRepo.getBoothStats(BOOTHS_IN_BRIEFING, 0);
  const booths: BoothSummary[] = boothRows.map((b) => ({
    boothName: b.boothName,
    scanCount: b.scanCount,
    uniquePlayers: b.uniquePlayers,
  }));

  const { total: totalPlayers } = playerRepo.getPlayerPage(1, 0);
  const top = playerRepo.getTopPlayer();
  const bottom = playerRepo.getBottomPlayer();

  return {
    totalScans,
    totalPlayers,
    totalBooths,
    averageScansPerPlayer: totalPlayers === 0 ? 0 : round(totalScans / totalPlayers),
    busiestBooth: booths[0] ?? null,
    quietestBooth: booths.length > 0 ? (booths[booths.length - 1] ?? null) : null,
    booths,
    topPlayerScanCount: top?.scanCount ?? null,
    bottomPlayerScanCount: bottom?.scanCount ?? null,
    lastScanDate: checkpointRepo.getLastScanDate(),
  };
}

/**
 * Renders the briefing from a fixed template. No network, no key, and the same
 * stats always produce the same sentences — which is what makes it testable and
 * what makes it a usable default rather than a degraded mode.
 */
export function createLocalInsightProvider(): InsightProvider {
  return {
    name: "local",
    summarize(stats: EventStats): Promise<string> {
      if (stats.totalScans === 0) {
        return Promise.resolve(
          "No booth scans have been ingested yet, so there is nothing to report.",
        );
      }

      const lines: string[] = [];
      lines.push(
        `${stats.totalScans} booth scans have been recorded from ${stats.totalPlayers} attendees ` +
          `across ${stats.totalBooths} booths, an average of ${stats.averageScansPerPlayer} scans per attendee.`,
      );

      if (stats.busiestBooth) {
        lines.push(
          `${stats.busiestBooth.boothName} is the busiest booth with ${stats.busiestBooth.scanCount} scans ` +
            `from ${stats.busiestBooth.uniquePlayers} distinct attendees.`,
        );
      }

      if (stats.quietestBooth && stats.quietestBooth.boothName !== stats.busiestBooth?.boothName) {
        lines.push(
          `${stats.quietestBooth.boothName} is the quietest of the booths reported here with ` +
            `${stats.quietestBooth.scanCount} scans.`,
        );
      }

      if (stats.topPlayerScanCount !== null && stats.bottomPlayerScanCount !== null) {
        lines.push(
          `Engagement ranges from ${stats.bottomPlayerScanCount} to ${stats.topPlayerScanCount} scans per attendee.`,
        );
      }

      if (stats.lastScanDate) {
        lines.push(`The most recent scan ingested is dated ${stats.lastScanDate}.`);
      }

      return Promise.resolve(lines.join(" "));
    },
  };
}

export interface AnthropicInsightProviderOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests. Receives the rendered prompt, returns the briefing text. */
  complete?: (prompt: string, model: string) => Promise<string | null>;
}

const BRIEFING_SYSTEM_PROMPT = [
  "You write short operational briefings for the team running a live event's booth-scan leaderboard.",
  "You are given a JSON object of statistics computed from the event database.",
  "Write three to four plain sentences an event manager can act on: where attention is going,",
  "which booths are being missed, and how evenly attendees are engaging.",
  "Use only numbers present in the JSON. Do not invent booths, attendees, or figures.",
  "No markdown, no headings, no bullet points.",
].join(" ");

/**
 * Optional Claude-written version of the same briefing. Returns null when the
 * model declines or the call fails, so the caller can fall back to the local
 * provider rather than surfacing an error to an operator watching a dashboard.
 */
export function createAnthropicInsightProvider(
  options: AnthropicInsightProviderOptions,
): InsightProvider & { summarizeOrNull(stats: EventStats): Promise<string | null> } {
  const { apiKey, model, complete } = options;

  const call =
    complete ??
    (async (prompt: string, modelId: string): Promise<string | null> => {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: modelId,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: BRIEFING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      if (response.stop_reason === "refusal") {
        return null;
      }

      const text = response.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      return text === "" ? null : text;
    });

  const provider = {
    name: "anthropic",
    async summarizeOrNull(stats: EventStats): Promise<string | null> {
      return call(JSON.stringify(stats, null, 2), model);
    },
    async summarize(stats: EventStats): Promise<string> {
      const text = await provider.summarizeOrNull(stats);
      if (text === null) {
        throw new Error("Anthropic insight provider returned no usable text");
      }
      return text;
    },
  };

  return provider;
}

export interface InsightServiceOptions {
  db: Database.Database;
  /** Tried first. When it fails or declines, `fallback` writes the briefing. */
  primary: InsightProvider;
  fallback: InsightProvider;
  onPrimaryError?: (err: unknown) => void;
}

export interface InsightService {
  briefing(): Promise<EventBriefing>;
}

/**
 * Produces the briefing, degrading to the local provider whenever the primary
 * one cannot answer. The endpoint therefore works identically with and without
 * an API key — the numbers are the same either way, only the prose differs.
 */
export function createInsightService(options: InsightServiceOptions): InsightService {
  const { db, primary, fallback, onPrimaryError } = options;

  return {
    async briefing(): Promise<EventBriefing> {
      const stats = computeEventStats(db);

      if (primary.name !== fallback.name) {
        try {
          return { provider: primary.name, text: await primary.summarize(stats), stats };
        } catch (err) {
          onPrimaryError?.(err);
        }
      }

      return { provider: fallback.name, text: await fallback.summarize(stats), stats };
    },
  };
}
