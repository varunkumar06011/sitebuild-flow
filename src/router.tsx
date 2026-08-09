import { QueryClient, QueryCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { authStore } from "./lib/auth-store";
import { logoutUser } from "./lib/auth-server";

function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("Unauthorized") || error.message.includes("no valid session");
  }
  return false;
}

function handleAuthError() {
  authStore.logout();
  // Cookie is httpOnly — can only be cleared server-side.
  // Fire-and-forget: the session is already invalid, and we're redirecting.
  logoutUser().catch(() => {
    // ignore — session may already be invalid
  });
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
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
    defaultPreloadStaleTime: 0,
  });

  return router;
};
