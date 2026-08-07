// Options controlling how an error is reported to the Lovable telemetry layer.
type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

// Shape of the global Lovable event hooks injected by the editor preview runtime.
type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
    __lovableReportRuntimeError?: (payload: {
      message: string;
      stack?: string;
      filename?: string | undefined;
    }) => void;
  }
}

// Forwards a caught error to Lovable's telemetry hooks for editor-side reporting
// and to the production error_log table via the logError server function.
export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const route = typeof window !== "undefined" ? window.location.pathname : undefined;

  // 1. Lovable editor telemetry (only works inside the editor preview)
  if (typeof window !== "undefined") {
    window.__lovableEvents?.captureException?.(
      error,
      {
        source: "react_error_boundary",
        route,
        ...context,
      },
      {
        mechanism: "react_error_boundary",
        handled: false,
        severity: "error",
      },
    );
    window.__lovableReportRuntimeError?.({
      message,
      ...(stack !== undefined && { stack }),
      filename: route,
    });
  }

  // 2. Production error logging — write to the error_log table via server function.
  //    Dynamic import to avoid circular deps and keep this client-side friendly.
  if (typeof window !== "undefined") {
    import("./api/errors")
      .then(({ logError }) =>
        logError({
          data: {
            message,
            ...(stack !== undefined && { stack }),
            source: String(context["boundary"] ?? "client_error_boundary"),
            ...(route !== undefined && { route }),
            severity: "error",
            context,
          },
        }),
      )
      .catch(() => {
        // If error logging itself fails, don't throw — just give up
      });
  }
}
