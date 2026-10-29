// server/src/middleware/rateLimiter.js
import rateLimit from 'express-rate-limit';

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,
  skip: (req) =>
    process.env.NODE_ENV === 'test' ||
    req.baseUrl?.includes('telemetry') ||
    req.path?.includes('telemetry') ||
    req.originalUrl?.includes('/api/telemetry'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later.',
      statusCode: 429,
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // Limit login attempts to 30 per 15 minutes
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many login attempts. Please try again after 15 minutes.',
      statusCode: 429,
      code: 'LOGIN_RATE_LIMIT_EXCEEDED',
    },
  },
});

export default { apiRateLimiter, loginRateLimiter };
