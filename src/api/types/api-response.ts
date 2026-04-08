/**
 * Standard JSON envelope for all HTTP API responses.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown;
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  error: null;
}

export interface ApiFailureResponse {
  success: false;
  data: null;
  error: ApiErrorBody;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiFailureResponse;
