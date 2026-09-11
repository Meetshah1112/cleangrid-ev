/** Errors that carry an API code and HTTP status, so routes never invent their own shapes. */
export class AppError extends Error {
  override readonly name: string = 'AppError';
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  override readonly name = 'NotFoundError';
  constructor(what: string, id: string) {
    super('not_found', `${what} ${id} not found`, 404);
  }
}

export class ValidationError extends AppError {
  override readonly name = 'ValidationError';
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 422, details);
  }
}

export class ConflictError extends AppError {
  override readonly name = 'ConflictError';
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class UnauthorizedError extends AppError {
  override readonly name = 'UnauthorizedError';
  constructor(message = 'authentication required') {
    super('unauthorized', message, 401);
  }
}

export class ForbiddenError extends AppError {
  override readonly name = 'ForbiddenError';
  constructor(message = 'not allowed') {
    super('forbidden', message, 403);
  }
}
