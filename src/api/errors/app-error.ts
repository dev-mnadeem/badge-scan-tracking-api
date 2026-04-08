/**
 * HTTP errors with a stable machine-readable `code` and optional `details`.
 * Thrown from route handlers and mapped to a response by the error middleware.
 *
 * Only the statuses this API actually returns are defined here — an unused
 * error class is a guess about a future the code has not reached.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details: unknown = null, code = "BAD_REQUEST") {
    super(400, code, message, details);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", details: unknown = null, code = "UNAUTHORIZED") {
    super(401, code, message, details);
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details: unknown = null, code = "NOT_FOUND") {
    super(404, code, message, details);
    this.name = "NotFoundError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = "Service unavailable",
    details: unknown = null,
    code = "SERVICE_UNAVAILABLE",
  ) {
    super(503, code, message, details);
    this.name = "ServiceUnavailableError";
  }
}
