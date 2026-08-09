// Offline Sync — view and manage the sync queue for offline write operations.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPendingSyncCount, fetchSyncQueue } from "@/lib/api/offline-sync-client";
import { useOfflineSync } from "@/lib/useOfflineSync";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { RefreshCw, Loader2, Wifi, WifiOff, CheckCircle2, XCircle, Clock, Database } from "lucide-react";

export const Route = createFileRoute("/offline-sync")({
  head: () => ({
    meta: [
      { title: "Offline Sync — Meditrust ERP" },
      {
        name: "description",
        content: "View and manage offline write operations queued for synchronization.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: OfflineSyncPage,
});

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  synced: "success",
  failed: "danger",
};

const ENTITY_LABELS: Record<string, string> = {
  "punch-item": "Punch Item",
  "safety-incident": "Safety Incident",
  inspection: "Inspection",
  "labour-attendance": "Labour Attendance",
  "daily-diary": "Daily Diary",
};

function OfflineSyncPage() {
  const { isOnline, pendingCount, triggerSync } = useOfflineSync();
  const [syncing, setSyncing] = useState(false);

  const { data: countData, refetch: refetchCount } = useQuery({
    queryKey: ["pendingSyncCount"],
    queryFn: () => getPendingSyncCount(),
    refetchInterval: (q) => (q.state.error ? false : 15000),
  });

  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery({
    queryKey: ["syncQueue"],
    queryFn: () => fetchSyncQueue({}),
    refetchInterval: (q) => (q.state.error ? false : 15000),
  });
  const queueItems = queueData?.data ?? [];
  const totalCount = queueData?.total_count ?? 0;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerSync();
      refetchCount();
      refetchQueue();
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <AppShell
      title="Offline Sync"
      subtitle="Manage queued offline write operations and synchronization status"
    >
      <div className="space-y-4">
        {/* Status cards */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="flex items-center gap-3 p-4">
            <span className={`flex size-9 items-center justify-center rounded-lg ${isOnline ? "bg-success-soft text-success" : "bg-warning-soft text-warning-foreground"}`}>
              {isOnline ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Connection</p>
              <p className="text-lg font-bold">{isOnline ? "Online" : "Offline"}</p>
            </div>
          </Card>

          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-warning-soft text-warning-foreground">
              <Clock className="size-4" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Pending Items</p>
              <p className="text-lg font-bold">{pendingCount}</p>
            </div>
          </Card>

          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-info">
              <Database className="size-4" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Total Queue Entries</p>
              <p className="text-lg font-bold">{totalCount}</p>
            </div>
          </Card>
        </div>

        {/* Sync action */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Sync Queue</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isOnline
                  ? "Click sync to process all pending items now."
                  : "You are offline. Items will sync automatically when connection returns."}
              </p>
            </div>
            <Button onClick={handleSync} disabled={!isOnline || syncing || pendingCount === 0}>
              {syncing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Sync Now
            </Button>
          </div>
        </Card>

        {/* Queue details */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border p-4">
            <p className="font-semibold">Queue Details</p>
            <p className="mt-1 text-xs text-muted-foreground">
              All offline write operations queued from field devices.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Entity Type</th>
                  <th className="px-4 py-3 font-medium">Device</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Attempts</th>
                  <th className="px-4 py-3 font-medium">Error</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Synced At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(syncing || queueLoading) && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                    </td>
                  </tr>
                )}
                {!syncing && !queueLoading && queueItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No items in the sync queue.
                    </td>
                  </tr>
                )}
                {!syncing && !queueLoading && queueItems.map((item: any) => (
                  <tr key={item.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3 font-medium">
                      {ENTITY_LABELS[item.entity_type] ?? item.entity_type}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {item.device_id ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={STATUS_TONE[item.status] ?? "neutral"}>
                        {item.status}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {item.attempts ?? 0} / {item.max_attempts ?? 3}
                    </td>
                    <td className="px-4 py-3 text-xs text-destructive">
                      {item.last_error ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(item.created_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {item.synced_at ? (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3" />
                          {new Date(item.synced_at).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      ) : item.status === "failed" ? (
                        <span className="flex items-center gap-1 text-destructive">
                          <XCircle className="size-3" /> Failed
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
