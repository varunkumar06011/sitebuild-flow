// Simple in-memory rate limiter for server-side use.
// Tracks request counts per key (e.g. IP address) within a sliding window.
// Note: resets on server restart — sufficient for basic protection.
// For multi-instance deployments, use a shared store (Redis, Upstash, etc.).

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

// Periodically clean up expired entries to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// Checks if a request should be allowed under the rate limit.
// Returns { allowed: true } if within limit, { allowed: false } if exceeded.
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  cleanup();
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt < now) {
    // New window
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  existing.count++;
  if (existing.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  return { allowed: true, remaining: maxRequests - existing.count, resetAt: existing.resetAt };
}

// Extracts the client IP from an Express request.
// Falls back to a default if no IP can be determined.
export function getClientIpFromReq(req: import("express").Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]!.trim();
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }
  return req.ip ?? "unknown";
}

// Rate limit configuration for login attempts: 10 per minute per IP.
export const LOGIN_RATE_LIMIT = { maxRequests: 10, windowMs: 60 * 1000 };

// Rate limit configuration for API mutations: 60 per minute per IP.
export const API_RATE_LIMIT = { maxRequests: 60, windowMs: 60 * 1000 };
