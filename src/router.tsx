import { QueryClient, QueryCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { authStore } from "./lib/auth-store";
import { logoutUser, verifySession } from "./lib/auth-server";
import { supabase } from "./lib/supabase";
import { setLogoutInProgress, isLogoutInProgress } from "./lib/auth-guards";

// Only treat HTTP 401 as an auth error — not string matching on messages,
// which can match unrelated errors and cause false logouts.
function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    return status === 401;
  }
  return false;
}

// Debounce logout so multiple simultaneous 401s don't trigger multiple redirects.
let logoutStarted = false;
function handleAuthError() {
  if (logoutStarted || isLogoutInProgress()) return;
  logoutStarted = true;
  setLogoutInProgress();

  // Verify with server before logging out — a single 401 could be
  // transient (network hiccup, cookie timing). Only logout if the
  // server confirms the session is actually invalid.
  verifySession()
    .then((session) => {
      if (!session.authenticated) {
        authStore.logout();
        logoutUser().catch(() => {});
        supabase.auth.signOut().catch(() => {});
        if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
      // If session IS valid, the 401 was transient — clear error state
      // and let queries refetch naturally.
    })
    .catch(() => {
      // Network error during verify — don't logout, might be transient.
      // The user can retry; if the session is truly dead, the next
      // API call will 401 and this will fire again.
    })
    .finally(() => {
      setTimeout(() => { logoutStarted = false; }, 2000);
    });
}

// Creates and configures the TanStack Router instance with a shared QueryClient.
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (isAuthError(error)) return false;
          return failureCount < 2;
        },
        // Stop refetching when a query is in error state — prevents the
        // loading → empty → loading → empty loop on failing API calls.
        refetchInterval: (query) => {
          if (query.state.error) return false;
          return query.state.data ? false : 3000;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: (failureCount, error) => {
          if (isAuthError(error)) return false;
          return failureCount < 2;
        },
      },
    },
    queryCache: new QueryCache({
      onError: (error: Error) => {
        if (isAuthError(error)) {
          handleAuthError();
        }
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 10_000,
    defaultPendingMs: 0,
  });

  return router;
};
