import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueOfflineWrite, processSyncQueue, getPendingSyncCount } from "@/lib/api/offline-sync";
import { toast } from "sonner";

// Wraps a server function call so that if it fails (offline/network error),
// the payload is queued via enqueueOfflineWrite() instead of showing a hard error.
// entityType must match one of the VALID_ENTITY_TYPES in offline-sync.ts.
export function useOfflineSync() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const { data: pendingData, refetch } = useQuery({
    queryKey: ["pendingSyncCount"],
    queryFn: () => getPendingSyncCount({ data: {} }),
    refetchInterval: 30000,
  });
  const pendingCount = pendingData?.pending_count ?? 0;

  // Listen to browser online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Back online — syncing queued items...");
      processSyncQueue({ data: {} })
        .then((result) => {
          if (result.success && result.processed > 0) {
            toast.success(
              `Synced ${result.succeeded} of ${result.processed} queued item${result.processed > 1 ? "s" : ""}`,
            );
            queryClient.invalidateQueries();
            refetch();
          }
        })
        .catch(() => {
          // silent — will retry on next online event
        });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("You are offline — changes will be synced when connection returns");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient, refetch]);

  // Wraps a create/mutation call with offline fallback.
  // If the serverFn call throws (network error), enqueues the payload for later sync.
  const withOfflineQueue = useCallback(
    async <T>(
      entityType: string,
      payload: Record<string, unknown>,
      serverFn: () => Promise<T>,
    ): Promise<T | { queued: true }> => {
      try {
        const result = await serverFn();
        return result;
      } catch (err) {
        // Network failure — queue for offline sync
        try {
          await enqueueOfflineWrite({
            data: {
              entity_type: entityType as any,
              payload,
              device_id:
                typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 50) : undefined,
            },
          });
          refetch();
          toast.info("Saved offline — will sync when connection returns");
          return { queued: true };
        } catch {
          // If even enqueue fails, rethrow the original error
          throw err;
        }
      }
    },
    [refetch],
  );

  // Manually trigger sync (e.g. from the AppShell badge button)
  const triggerSync = useCallback(async () => {
    const result = await processSyncQueue({ data: {} });
    if (result.success) {
      if (result.processed > 0) {
        toast.success(
          `Synced ${result.succeeded} of ${result.processed} queued item${result.processed > 1 ? "s" : ""}`,
        );
        queryClient.invalidateQueries();
      } else {
        toast.info("No pending items to sync");
      }
      refetch();
    } else {
      toast.error("Sync failed");
    }
    return result;
  }, [queryClient, refetch]);

  return {
    isOnline,
    pendingCount,
    withOfflineQueue,
    triggerSync,
    refetchPending: refetch,
  };
}
