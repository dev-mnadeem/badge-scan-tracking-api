/**
 * The upstream scan API reports `scanDate` as a naive ISO-like string with no
 * timezone designator, e.g. "2026-02-12T18:58:15". `Date.parse` resolves that
 * form using the *host* timezone, while EVENT_START_DATE is written with a `Z`
 * suffix and resolves as UTC. Mixing the two shifts the poll cursor by the host
 * offset every time it round-trips through the database, which either re-fetches
 * or silently skips that many hours of scans depending on which side of UTC the
 * host sits on.
 *
 * Everything in this module therefore reads a missing designator as UTC, so a
 * cursor means the same instant on every machine.
 */

const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` already pins itself to an offset (trailing `Z` or `±HH:MM`). */
export function hasTimeZoneDesignator(value: string): boolean {
  return HAS_TIMEZONE.test(value.trim());
}

/**
 * Parses an upstream or checkpoint timestamp to epoch milliseconds, reading a
 * missing timezone designator as UTC rather than as host-local time.
 *
 * @throws {RangeError} if `value` is not a parseable timestamp.
 */
export function toUtcMs(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new RangeError("Timestamp is empty");
  }

  const normalized = hasTimeZoneDesignator(trimmed)
    ? trimmed
    : DATE_ONLY.test(trimmed)
      ? `${trimmed}T00:00:00Z`
      : `${trimmed}Z`;

  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid timestamp: ${value}`);
  }
  return ms;
}

/** Normalises any accepted timestamp form to a full UTC ISO-8601 string. */
export function toUtcIso(value: string): string {
  return new Date(toUtcMs(value)).toISOString();
}

/**
 * Chronological comparison of two upstream timestamps. Used instead of `>` on
 * the raw strings, which only happens to work while every value shares one format.
 */
export function laterOf(a: string, b: string): string {
  return toUtcMs(a) >= toUtcMs(b) ? a : b;
}
