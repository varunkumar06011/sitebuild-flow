import { QueryClient, QueryCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { authStore } from "./lib/auth-store";

function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("Unauthorized") || error.message.includes("no valid session");
  }
  return false;
}

function handleAuthError() {
  authStore.logout();
  document.cookie = "meditrust_session=; path=/; max-age=0; samesite=lax";
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
