import { z } from "zod";

/**
 * Each element in `customFields` is a flat object of arbitrary string key/value pairs.
 * We only care about "Booth Name" but keep everything so callers can inspect raw data.
 */
const CustomFieldSchema = z.record(z.string(), z.string());

export const RawScanSchema = z.object({
  badgeId: z.string(),
  scanDate: z.string(),
  customFields: z.array(CustomFieldSchema).optional(),
});

export const ApiResponseSchema = z.array(RawScanSchema);

export type RawScan = z.infer<typeof RawScanSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
