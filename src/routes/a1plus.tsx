// A1+ dashboard route: requires A1+ role and renders the final authority dashboard.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { approverFor, inr, ROLE_SUMMARY } from "@/lib/erp-data";
import { requireRole } from "@/lib/auth-guards";
import { fetchRequisitions, type RequisitionRow } from "@/lib/api/requisitions";
import { fetchInspections } from "@/lib/api/inspections";
import { fetchProgress } from "@/lib/api/progress";
import { fetchGatePasses } from "@/lib/api/gate-passes";
import { useApprovalActions } from "@/hooks/use-approval-actions";
import { ApprovalQueueItem } from "@/components/approval/ApprovalQueueItem";
import { DecisionHistory } from "@/components/approval/DecisionHistory";
import { fetchPartsOrders } from "@/lib/api/parts-orders";
import { fetchWorkOrders } from "@/lib/api/work-orders";
import { fetchDocuments } from "@/lib/api/documents";
import {
  Crown,
  ArrowUpRight,
  TrendingUp,
  ShieldCheck,
  AlertCircle,
  Package,
  ClipboardList,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/a1plus")({
  head: () => ({
    meta: [{ title: "A1+ Dashboard — Meditrust ERP" }],
  }),
  beforeLoad: () => {
    requireRole("A1+");
  },
  component: A1PlusDashboard,
});

// A1+ dashboard showing full approval queue, high-value items, and organization overview.
function A1PlusDashboard() {
  const actions = useApprovalActions("A1+");

  const {
    data: reqData,
    isError: reqError,
    error: reqErr,
  } = useQuery({
    queryKey: ["requisitions"],
    queryFn: () => fetchRequisitions({}),
    refetchInterval: (q) => (q.state.error ? false : 15000),
  });
  const { data: inspData } = useQuery({
    queryKey: ["inspections"],
    queryFn: () => fetchInspections({}),
  });
  const { data: progData } = useQuery({ queryKey: ["progress"], queryFn: () => fetchProgress() });
  const { data: gpData } = useQuery({
    queryKey: ["gatePasses"],
    queryFn: () => fetchGatePasses({}),
  });
  const { data: partsData } = useQuery({
    queryKey: ["partsOrders", "a1plus"],
    queryFn: () => fetchPartsOrders({ limit: 5 } as any),
  });
  const { data: workData } = useQuery({
    queryKey: ["workOrders", "a1plus"],
    queryFn: () => fetchWorkOrders({ limit: 5 } as any),
  });
  const { data: docsData } = useQuery({
    queryKey: ["documents", "a1plus"],
    queryFn: () => fetchDocuments({ limit: 5 }),
  });

  const requisitions: RequisitionRow[] = reqData?.data ?? [];
  const inspections = inspData?.data ?? [];
  const progress = progData?.data ?? [];
  const gatePasses = gpData?.data ?? [];
  const partsOrders = partsData?.data ?? [];
  const workOrders = workData?.data ?? [];
  const documents = docsData?.data ?? [];

  const dashboardError = reqError ? (reqErr?.message ?? "Failed to load data") : null;

  const allPending = requisitions.filter(
    (r) => (r.stage === "Admin" || r.stage === "A1" || r.stage === "A1+") && !actions.decided[r.id],
  );
  const highValue = requisitions.filter((r) => approverFor(r.amount) === "A1+");
  const totalCommitted = requisitions.reduce((s, r) => s + r.amount, 0);
  const completedValue = requisitions
    .filter((r) => r.stage === "Completed")
    .reduce((s, r) => s + r.amount, 0);
  const activeGatePasses = gatePasses.filter((g: any) => g.status !== "Exited");

  return (
    <AppShell
      title="A1+ Final Authority Dashboard"
      subtitle={`Full system control · ${ROLE_SUMMARY["A1+"].limit} · Override all decisions`}
    >
      {dashboardError && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="size-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">Failed to load dashboard data</p>
            <p className="text-xs text-muted-foreground">{dashboardError}</p>
          </div>
        </div>
      )}

      {/* Top-level stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShieldCheck}
          label="All Pending Approvals"
          value={String(allPending.length)}
          note="Admin + A1 queue"
          tone="warning"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Project Value"
          value={inr(totalCommitted)}
          note={`${inr(completedValue)} completed`}
          tone="info"
        />
      </div>

      {/* Full approval queue — A1+ can approve everything */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Full approval queue</h2>
          <Link
            to="/approvals"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            Open approvals <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          As A1+ you have final authority over all approval tiers.
        </p>
        <div className="mt-4 space-y-3">
          {allPending.map((r) => (
            <ApprovalQueueItem
              key={r.id}
              requisition={r}
              role="A1+"
              actions={actions}
              approveLabel="Final Approve"
              allowOverride
            />
          ))}
          {allPending.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending approvals — all clear.
            </p>
          )}
        </div>
      </Card>

      {/* High-value items */}
      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold">High-value procurements (above ₹5,00,000)</h2>
        <div className="mt-4">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">PR</th>
                  <th className="pb-2 font-semibold">Item</th>
                  <th className="pb-2 text-right font-semibold">Value</th>
                  <th className="pb-2 font-semibold">Stage</th>
                  <th className="pb-2 font-semibold">Vendor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {highValue.map((r) => (
                  <tr key={r.id} className="align-middle">
                    <td className="py-3 font-mono text-xs">{r.pr_number}</td>
                    <td className="py-3 font-medium">{r.title}</td>
                    <td className="py-3 text-right font-mono font-semibold">{inr(r.amount)}</td>
                    <td className="py-3">
                      <StatusPill
                        tone={
                          r.stage === "Completed"
                            ? "success"
                            : r.stage === "Invoice"
                              ? "info"
                              : "warning"
                        }
                      >
                        {r.stage}
                      </StatusPill>
                    </td>
                    <td className="py-3 text-muted-foreground">{r.vendor_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {highValue.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{r.pr_number}</span>
                  <StatusPill
                    tone={
                      r.stage === "Completed"
                        ? "success"
                        : r.stage === "Invoice"
                          ? "info"
                          : "warning"
                    }
                  >
                    {r.stage}
                  </StatusPill>
                </div>
                <p className="mb-1 font-medium leading-snug">{r.title}</p>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                  <span className="text-xs text-muted-foreground">{r.vendor_name ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Organization overview */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-bold">Block progress</h2>
          <div className="mt-4 space-y-4">
            {progress.map((p: any, i: number) => (
              <div key={`${p.block}-${i}`}>
                <div className="flex justify-between gap-2 text-xs font-medium">
                  <span>{p.block}</span>
                  <span className="text-muted-foreground">{p.pct}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${p.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">Quality status</h2>
          <div className="mt-4 space-y-3">
            {inspections.map((i: any) => (
              <div key={i.id} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.activity}</p>
                  <p className="text-xs text-muted-foreground">{i.location}</p>
                </div>
                <StatusPill
                  tone={
                    i.result === "Pass" ? "success" : i.result === "Fail" ? "danger" : "warning"
                  }
                >
                  {i.result}
                </StatusPill>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">Site operations</h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Active gate passes</span>
              <span className="font-mono font-semibold">{activeGatePasses.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Total vendors</span>
              <span className="font-mono font-semibold">
                {new Set(requisitions.map((r) => r.vendor_name).filter(Boolean)).size}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Completed POs</span>
              <span className="font-mono font-semibold">
                {requisitions.filter((r) => r.stage === "Completed").length}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Decision history */}
      <DecisionHistory requisitions={requisitions} />

      {/* Parts Orders & Work Orders */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-bold">Parts Orders</h2>
            </div>
            <Link
              to="/parts-orders"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              Manage <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-3 flex gap-4 text-xs">
            <span className="text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{partsData?.total ?? 0}</span>
            </span>
            <span className="text-muted-foreground">
              Draft:{" "}
              <span className="font-semibold text-foreground">
                {partsOrders.filter((o: any) => o.status === "Draft").length}
              </span>
            </span>
            <span className="text-muted-foreground">
              Pending:{" "}
              <span className="font-semibold text-foreground">
                {
                  partsOrders.filter((o: any) => !["Received", "Cancelled"].includes(o.status))
                    .length
                }
              </span>
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {partsOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No parts orders yet.</p>
            ) : (
              partsOrders.map((o: any) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.order_number}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {o.project_name ?? "—"} · {o.vendor_name ?? "—"}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      o.status === "Received"
                        ? "success"
                        : o.status === "Cancelled"
                          ? "danger"
                          : o.status === "Draft"
                            ? "neutral"
                            : "info"
                    }
                  >
                    {o.status}
                  </StatusPill>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-bold">Work Orders</h2>
            </div>
            <Link
              to="/work-orders"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              Manage <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-3 flex gap-4 text-xs">
            <span className="text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{workData?.total ?? 0}</span>
            </span>
            <span className="text-muted-foreground">
              Assigned:{" "}
              <span className="font-semibold text-foreground">
                {
                  workOrders.filter(
                    (o: any) => o.status === "Assigned" || o.status === "In Progress",
                  ).length
                }
              </span>
            </span>
            <span className="text-muted-foreground">
              Completed:{" "}
              <span className="font-semibold text-foreground">
                {
                  workOrders.filter((o: any) => o.status === "Completed" || o.status === "Closed")
                    .length
                }
              </span>
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {workOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No work orders yet.</p>
            ) : (
              workOrders.map((o: any) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.order_number}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {o.project_name ?? "—"} · {o.assigned_supervisor_name ?? "Unassigned"}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      o.status === "Completed" || o.status === "Closed"
                        ? "success"
                        : o.status === "Cancelled"
                          ? "danger"
                          : o.status === "Draft"
                            ? "neutral"
                            : o.status === "In Progress"
                              ? "warning"
                              : "info"
                    }
                  >
                    {o.status}
                  </StatusPill>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Documents */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-bold">Documents</h2>
          </div>
          <Link
            to="/documents"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            Manage <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <div className="mt-3 flex gap-4 text-xs">
          <span className="text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{docsData?.total ?? 0}</span>
          </span>
          <span className="text-muted-foreground">
            Expiring Soon:{" "}
            <span className="font-semibold text-foreground">
              {documents.filter((d: any) => d.expiry_status === "Expiring Soon").length}
            </span>
          </span>
          <span className="text-muted-foreground">
            Expired:{" "}
            <span className="font-semibold text-destructive">
              {documents.filter((d: any) => d.expiry_status === "Expired").length}
            </span>
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {documents.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No documents uploaded yet.
            </p>
          ) : (
            documents.map((d: any) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.document_type} · {d.uploaded_by_name ?? "—"}
                  </p>
                </div>
                <StatusPill
                  tone={
                    d.expiry_status === "Active"
                      ? "success"
                      : d.expiry_status === "Expiring Soon"
                        ? "warning"
                        : d.expiry_status === "Expired"
                          ? "danger"
                          : "neutral"
                  }
                >
                  {d.expiry_status}
                </StatusPill>
              </div>
            ))
          )}
        </div>
      </Card>
    </AppShell>
  );
}

// Stat card with an icon, colored accent bar, label, value, and note.
function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Crown;
  label: string;
  value: string;
  note: string;
  tone: "info" | "warning" | "danger" | "success";
}) {
  const bars = {
    info: "bg-info",
    warning: "bg-warning",
    danger: "bg-destructive",
    success: "bg-success",
  };
  return (
    <Card className="relative overflow-hidden p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${bars[tone]}`} />
      <div className="flex items-center gap-3">
        <Icon className="size-5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </Card>
  );
}
