import { useCallback, useState } from "react";

// Offline sync has been removed — this is a no-op stub to avoid breaking
// AppShell and labour.tsx which still import useOfflineSync.
export function useOfflineSync() {
  const [isOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const withOfflineQueue = useCallback(
    async <T>(
      _entityType: string,
      _payload: Record<string, unknown>,
      serverFn: () => Promise<T>,
    ): Promise<T> => {
      return serverFn();
    },
    [],
  );

  const triggerSync = useCallback(async () => {
    return { success: true, processed: 0, succeeded: 0 };
  }, []);

  return {
    isOnline,
    pendingCount: 0,
    withOfflineQueue,
    triggerSync,
    refetchPending: () => {},
  };
}
