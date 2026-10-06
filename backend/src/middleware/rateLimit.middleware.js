import rateLimit from 'express-rate-limit';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

export const twoFaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  // Only failed attempts (4xx/5xx) count: the point is to cap guessing, and a
  // user finishing setup then signing in again shortly after shouldn't burn
  // through the budget with correct codes.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later.' },
});
