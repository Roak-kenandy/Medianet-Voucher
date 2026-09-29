import { AppError } from './errors.js';

/** Route `:id` values must be plain positive integers; anything else is a 400, never NaN in SQL. */
export function parseIdParam(value, label = 'id') {
  const text = String(value ?? '');
  if (!/^\d{1,10}$/.test(text)) {
    throw new AppError(`Invalid ${label}`, 400, 'VALIDATION_ERROR');
  }
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    throw new AppError(`Invalid ${label}`, 400, 'VALIDATION_ERROR');
  }
  return id;
}

/** Router-level guard: `router.param('id', validateIdParam)`. */
export function validateIdParam(req, _res, next, value, name) {
  try {
    parseIdParam(value, name);
    next();
  } catch (err) {
    next(err);
  }
}
