// Backup Verification — run manual backup verification and view backup history.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { fetchBackupLog, runBackupVerification } from "@/lib/api/backup";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Database, Loader2, ShieldCheck, AlertTriangle, Play } from "lucide-react";

export const Route = createFileRoute("/backup-verification")({
  head: () => ({
    meta: [
      { title: "Backup Verification — Meditrust ERP" },
      { name: "description", content: "Run backup verification and view backup history." },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: BackupVerificationPage,
});

function BackupVerificationPage() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: logData, isLoading } = useQuery({
    queryKey: ["backup-log"],
    queryFn: () => fetchBackupLog({ data: {} }),
  });
  const log = logData?.data ?? [];

  const handleRun = async () => {
    setRunning(true);
    try {
      const result = await runBackupVerification({ data: notes ? { notes } : {} });
      if (result.success) {
        const msg =
          result.failedTables.length === 0
            ? `Verification complete: ${result.tablesCount} tables, ${result.totalRows} total rows`
            : `Verification complete: ${result.tablesCount} tables verified, ${result.failedTables.length} failed`;
        toast.success(msg);
        queryClient.invalidateQueries({ queryKey: ["backup-log"] });
        setNotes("");
      } else {
        toast.error(result.error ?? "Verification failed");
      }
    } catch {
      toast.error("Verification failed");
    }
    setRunning(false);
  };

  const lastBackup = log[0];

  return (
    <AppShell title="Backup Verification" subtitle="Verify data integrity and view backup history">
      {/* Summary cards */}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="size-4" />
            <p className="text-xs font-medium">Last Backup</p>
          </div>
          <p className="mt-2 text-sm font-bold">
            {lastBackup
              ? new Date(lastBackup.created_at).toLocaleString("en-IN", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "Never"}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-4" />
            <p className="text-xs font-medium">Last Status</p>
          </div>
          <p className="mt-2">
            {lastBackup ? (
              <StatusPill
                tone={
                  lastBackup.status === "verified"
                    ? "success"
                    : lastBackup.status === "failed"
                      ? "danger"
                      : "warning"
                }
              >
                {lastBackup.status}
              </StatusPill>
            ) : (
              "—"
            )}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="size-4" />
            <p className="text-xs font-medium">Total Rows (last)</p>
          </div>
          <p className="mt-2 text-sm font-bold">
            {lastBackup?.total_rows?.toLocaleString("en-IN") ?? "—"}
          </p>
        </Card>
      </div>

      {/* Run verification */}
      <Card className="mb-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <p className="font-bold">Run Manual Verification</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Counts rows in all critical tables and verifies data integrity. This does not create a
          physical backup file — it verifies that all tables are accessible and contain expected
          data.
        </p>
        <div className="mt-4 space-y-2">
          <Label htmlFor="bnotes">Notes (optional)</Label>
          <Textarea
            id="bnotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Pre-deployment verification, monthly check..."
            rows={2}
          />
        </div>
        <Button className="mt-3" onClick={handleRun} disabled={running}>
          {running ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Play className="mr-2 size-4" />
          )}
          {running ? "Verifying..." : "Run Verification"}
        </Button>
      </Card>

      {/* Backup history */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <p className="font-semibold">Backup History</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Tables</th>
                <th className="px-4 py-3 text-right font-medium">Total Rows</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Triggered By</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!isLoading && log.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No backup verifications recorded yet.
                  </td>
                </tr>
              )}
              {log.map((e: any) => (
                <tr key={e.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 text-xs">
                    {new Date(e.created_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase">
                      {e.backup_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{e.tables_count}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {e.total_rows?.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      tone={
                        e.status === "verified"
                          ? "success"
                          : e.status === "failed"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {e.status}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-xs">{e.triggered_by_name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{e.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
