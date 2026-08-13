import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }

  console.error('[Unhandled Error]', err);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}

export function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}
