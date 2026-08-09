// Thin fetch wrapper for calling the Express API server.
// All API calls go through this so credentials (cookies) are always included
// and the base URL is centralized via VITE_API_URL.

const API_URL = import.meta.env["VITE_API_URL"] as string | undefined;

if (!API_URL) {
  console.warn(
    "VITE_API_URL is not set. API calls will fail. Set it in your .env file to point to the Express API server.",
  );
}

// Calls the API server with the given path and options.
// Always includes credentials (cookies) for cross-origin auth.
// Returns the parsed JSON response, or throws on network error.
export async function apiCall<T = any>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: any;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> {
  const { method = "GET", body, query } = options;

  let url = `${API_URL}${path}`;

  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const fetchOptions: RequestInit = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body !== undefined && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);

  if (!res.ok) {
    // Try to parse error JSON, fall back to status text
    let errorMessage = `HTTP ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData?.error) errorMessage = errorData.error;
    } catch {
      // not JSON — use status text
    }
    const error = new Error(errorMessage) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  return res.json() as Promise<T>;
}

// Convenience methods for common HTTP verbs.
export const api = {
  get: <T = any>(path: string, query?: Record<string, string | number | boolean | undefined>) =>
    apiCall<T>(path, { method: "GET", query }),
  post: <T = any>(path: string, body?: any) => apiCall<T>(path, { method: "POST", body }),
  put: <T = any>(path: string, body?: any) => apiCall<T>(path, { method: "PUT", body }),
  delete: <T = any>(path: string) => apiCall<T>(path, { method: "DELETE" }),
};
