import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../../config/constants.js";

const PaginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface Pagination {
  limit: number;
  offset: number;
}

/**
 * Every list endpoint is paginated through here, so `limit` can never exceed
 * MAX_PAGE_LIMIT and one request cannot read an entire table.
 *
 * @throws {ZodError} mapped to a 422 by the error middleware.
 */
export function parsePagination(query: unknown): Pagination {
  const source = (query ?? {}) as Record<string, unknown>;
  return PaginationSchema.parse({ limit: source["limit"], offset: source["offset"] });
}
