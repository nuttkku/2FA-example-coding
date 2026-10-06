import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid request', details: err.issues });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  // Client errors raised by Express/body-parser itself (malformed JSON, body
  // too large, ...) carry an http-errors status + `expose`. They are the
  // client's fault, so answer with that 4xx rather than logging a 500.
  if (err.expose && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'Invalid request' });
  }

  logger.error('Unexpected error', err);
  res.status(500).json({ error: 'Internal server error' });
}
