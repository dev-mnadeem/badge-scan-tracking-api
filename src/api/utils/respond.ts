import type { Response } from "express";
import type { ApiFailureResponse, ApiSuccessResponse } from "../types/api-response.js";

export function sendSuccess<T>(res: Response, data: T, statusCode: 200 | 201 = 200): void {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    error: null,
  };
  res.status(statusCode).json(body);
}

export function sendFailure(
  res: Response,
  statusCode: number,
  error: ApiFailureResponse["error"],
): void {
  const body: ApiFailureResponse = {
    success: false,
    data: null,
    error,
  };
  res.status(statusCode).json(body);
}
