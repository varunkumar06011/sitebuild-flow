// Shared input sanitization utilities for PostgREST filter strings and file paths.

/**
 * Sanitizes user search input before interpolating into a PostgREST `.or()` filter string.
 * Removes characters that could alter filter logic: commas (field separators),
 * periods (operator/field separators), parentheses, and backslashes.
 * Returns the sanitized string, or empty string if nothing remains after trimming.
 */
export function sanitizeSearch(input: string): string {
  return input.replace(/[,.()\\]/g, " ").trim();
}

/**
 * Validates that a file path is safe for use with Supabase Storage.
 * Rejects path traversal (`..`), absolute paths, null bytes, and empty strings.
 * Returns true if the path is safe, false otherwise.
 */
export function isSafePath(path: string): boolean {
  if (!path || path.length === 0) return false;
  if (path.includes("\0")) return false;
  if (path.startsWith("/")) return false;
  // Reject any path segment that is exactly ".."
  const segments = path.split("/");
  if (segments.some((s) => s === "..")) return false;
  return true;
}
