import fs from 'fs';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * CRM payment POST outcome that is not a clean success.
 * - `rejected`: CRM answered with a definite refusal — no payment exists.
 * - `ambiguous`: timeout / 5xx / unreadable reply — a payment MAY exist and must be reconciled.
 */
export class CrmPaymentError extends AppError {
  constructor(message, outcome, details = {}) {
    super(message, 502, outcome === 'rejected' ? 'CRM_PAYMENT_REJECTED' : 'CRM_PAYMENT_UNCONFIRMED');
    this.outcome = outcome;
    this.details = details;
  }
}

/** A CRM payment was posted, but a later step (subscription, device) failed. */
export class CrmBillableError extends AppError {
  constructor(message, details = {}) {
    super(message, 502, 'CRM_PARTIAL_PROVISION');
    this.details = details;
  }
}

/**
 * How a failed CRM operation affects money:
 * - `not_charged`: nothing was posted to CRM — the local charge must be released.
 * - `billable`: a CRM payment exists — keep the local charge.
 * - `ambiguous`: unknown — keep the charge and flag for reconciliation.
 */
export function classifyCrmFailure(err) {
  if (err instanceof CrmBillableError) return 'billable';
  if (err instanceof CrmPaymentError) {
    return err.outcome === 'rejected' ? 'not_charged' : 'ambiguous';
  }
  return 'not_charged';
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function removeUploadedFiles(req) {
  const files = [];
  if (req.file?.path) files.push(req.file.path);
  if (Array.isArray(req.files)) {
    files.push(...req.files.map((f) => f?.path).filter(Boolean));
  } else if (req.files && typeof req.files === 'object') {
    for (const list of Object.values(req.files)) {
      if (Array.isArray(list)) files.push(...list.map((f) => f?.path).filter(Boolean));
    }
  }
  for (const filePath of files) {
    fs.promises.unlink(filePath).catch(() => {});
  }
}

export function errorHandler(err, req, res, _next) {
  removeUploadedFiles(req);

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

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Image must be 5 MB or smaller',
    });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Malformed JSON body',
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
