// Stubbed rate limiter for the frontend.
// The real rate limiting now lives in the Express server (/server/lib/rate-limiter.ts).
// This stub exists only so unconverted API modules can compile.

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function checkRateLimit(_key: string, _maxRequests: number, _windowMs: number): RateLimitResult {
  return { allowed: true, remaining: 0, resetAt: 0 };
}

export function getClientIp(): string {
  return "unknown";
}

export const LOGIN_RATE_LIMIT = { maxRequests: 10, windowMs: 60 * 1000 };
export const API_RATE_LIMIT = { maxRequests: 60, windowMs: 60 * 1000 };
