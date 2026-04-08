/**
 * Values that are part of the upstream contract or the wire format, and are not
 * meant to be tuned per deployment. Anything an operator would plausibly want to
 * change lives in `src/config/env.ts` instead.
 */

/** Key under which the poll cursor is stored in the `checkpoints` table. */
export const CHECKPOINT_KEY = "last_scan_date";

/** Default page size of the upstream scan API. Overridable via SCAN_PAGE_SIZE. */
export const DEFAULT_SCAN_PAGE_SIZE = 1000;

/** Default page size for list endpoints that accept `limit`. */
export const DEFAULT_PAGE_LIMIT = 50;

/** Hard ceiling on `limit` for list endpoints, so one request cannot read the table. */
export const MAX_PAGE_LIMIT = 500;
