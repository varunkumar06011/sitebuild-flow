// Audit log page displaying an immutable, paginated trail of all ERP actions (A1+ access only).
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAuditLog } from "@/lib/api/audit";
import { requireRole } from "@/lib/auth-guards";
import { Search, History } from "lucide-react";

export const Route = createFileRoute("/audit-log")({
  head: () => ({
    meta: [
      { title: "Audit Log — Meditrust ERP" },
      {
        name: "description",
        content: "Immutable audit trail of all actions across the ERP system.",
      },
    ],
  }),
  beforeLoad: () => {
    requireRole("A1+");
  },
  component: AuditLogPage,
});

const ENTITY_TYPES = [
  { value: "all", label: "All entities" },
  { value: "requisition", label: "Requisitions" },
  { value: "gate_pass", label: "Gate passes" },
  { value: "batch", label: "Batches" },
  { value: "inspection", label: "Inspections" },
  { value: "vendor", label: "Vendors" },
  { value: "visitor", label: "Visitors" },
  { value: "vehicle", label: "Vehicles" },
  { value: "organization_settings", label: "Settings" },
];

// Main audit log page with entity filter and pagination over the action trail.
function AuditLogPage() {
  const [entityFilter, setEntityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["auditLog", entityFilter, page],
    queryFn: () =>
      fetchAuditLog({
        limit,
        page,
        ...(entityFilter !== "all" ? { entityType: entityFilter } : {}),
      }),
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <AppShell title="Audit log" subtitle="Immutable trail of every action — A1+ access only">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Select
              value={entityFilter}
              onValueChange={(v) => {
                setEntityFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {total} {total === 1 ? "entry" : "entries"}
            </span>
          </div>
        </div>

        <div className="mt-4">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Time</th>
                  <th className="pb-2 font-semibold">User</th>
                  <th className="pb-2 font-semibold">Role</th>
                  <th className="pb-2 font-semibold">Action</th>
                  <th className="pb-2 font-semibold">Entity</th>
                  <th className="pb-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                )}
                {!isLoading && logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      <History className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                      No audit entries found.
                    </td>
                  </tr>
                )}
                {logs.map((log: any) => (
                  <tr key={log.id} className="align-middle">
                    <td className="py-3 font-mono text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString("en-IN")}
                    </td>
                    <td className="py-3 font-medium">{log.user_name}</td>
                    <td className="py-3">
                      <StatusPill
                        tone={
                          log.user_role === "A1+"
                            ? "danger"
                            : log.user_role === "A1"
                              ? "warning"
                              : "info"
                        }
                      >
                        {log.user_role}
                      </StatusPill>
                    </td>
                    <td className="py-3 text-sm">{log.action.replace(/_/g, " ")}</td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {log.entity_type} · {log.entity_id?.substring(0, 8)}...
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {log.details ? JSON.stringify(log.details).substring(0, 80) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
            )}
            {!isLoading && logs.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
                <History className="mb-2 size-6 text-muted-foreground/50" />
                <p className="text-sm">No audit entries found.</p>
              </div>
            )}
            {logs.map((log: any) => (
              <div key={log.id} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-medium">{log.user_name}</span>
                  <StatusPill
                    tone={
                      log.user_role === "A1+"
                        ? "danger"
                        : log.user_role === "A1"
                          ? "warning"
                          : "info"
                    }
                  >
                    {log.user_role}
                  </StatusPill>
                </div>
                <p className="mb-1 text-sm capitalize">{log.action.replace(/_/g, " ")}</p>
                <p className="mb-2 font-mono text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("en-IN")}
                </p>
                <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                  <p>
                    {log.entity_type} · {log.entity_id?.substring(0, 8)}...
                  </p>
                  {log.details && (
                    <p className="mt-1 break-all">
                      {JSON.stringify(log.details).substring(0, 120)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
