// A1 dashboard route: requires A1 role and renders the senior approval authority dashboard.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { approverFor, inr, ROLE_SUMMARY } from "@/lib/erp-data";
import { requireRole } from "@/lib/auth-guards";
import { fetchRequisitions, type RequisitionRow } from "@/lib/api/requisitions";
import { fetchInspections } from "@/lib/api/inspections";
import { fetchProgress } from "@/lib/api/progress";
import { fetchBatches } from "@/lib/api/batches";
import { useApprovalActions } from "@/hooks/use-approval-actions";
import { ApprovalQueueItem } from "@/components/approval/ApprovalQueueItem";
import { DecisionHistory } from "@/components/approval/DecisionHistory";
import { fetchPartsOrders } from "@/lib/api/parts-orders";
import { fetchWorkOrders } from "@/lib/api/work-orders";
import { fetchDocuments } from "@/lib/api/documents";
import {
  Building2,
  ArrowUpRight,
  Lock,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  Boxes,
  AlertCircle,
  Package,
  ClipboardList,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/a1")({
  head: () => ({
    meta: [{ title: "A1 Dashboard — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireRole("A1");
  },
  component: A1Dashboard,
});

// A1 dashboard showing pending approvals, escalated items, project progress, and traceability status.
function A1Dashboard() {
  const actions = useApprovalActions("A1");

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
  const { data: batchData } = useQuery({
    queryKey: ["batches"],
    queryFn: () => fetchBatches({}),
  });
  const { data: partsData } = useQuery({
    queryKey: ["partsOrders", "a1"],
    queryFn: () => fetchPartsOrders({ limit: 5 } as any),
  });
  const { data: workData } = useQuery({
    queryKey: ["workOrders", "a1"],
    queryFn: () => fetchWorkOrders({ limit: 5 } as any),
  });
  const { data: docsData } = useQuery({
    queryKey: ["documents", "a1"],
    queryFn: () => fetchDocuments({ limit: 5 }),
  });

  const requisitions: RequisitionRow[] = reqData?.data ?? [];
  const inspections = inspData?.data ?? [];
  const progress = progData?.data ?? [];
  const batches = batchData?.data ?? [];
  const partsOrders = partsData?.data ?? [];
  const workOrders = workData?.data ?? [];
  const documents = docsData?.data ?? [];

  const dashboardError = reqError ? (reqErr?.message ?? "Failed to load data") : null;

  const a1Queue = requisitions.filter(
    (r) =>
      (approverFor(r.amount) === "A1" || approverFor(r.amount) === "Administrator") &&
      r.stage !== "Completed",
  );
  const pendingA1 = a1Queue.filter((r) => r.stage === "A1" && !actions.decided[r.id]);
  const escalatedToA1Plus = requisitions.filter((r) => approverFor(r.amount) === "A1+");
  const totalPipeline = requisitions.reduce((s, r) => s + r.amount, 0);
  const pendingBatches = batches.filter((b: any) => b.status !== "Verified");

  return (
    <AppShell
      title="A1 Dashboard"
      subtitle={`Approval limit: ${ROLE_SUMMARY.A1.limit} · Override project decisions`}
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

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShieldCheck}
          label="Pending A1 Approvals"
          value={String(pendingA1.length)}
          note="₹50K – ₹5L range"
          tone="warning"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Pipeline Value"
          value={inr(totalPipeline)}
          note="All requisitions"
          tone="info"
        />
        <StatCard
          icon={AlertTriangle}
          label="Escalated to A1+"
          value={String(escalatedToA1Plus.length)}
          note="Above ₹5,00,000"
          tone="danger"
        />
        <StatCard
          icon={Boxes}
          label="Traceability Pending"
          value={String(pendingBatches.length)}
          note="MTC or lab test"
          tone="warning"
        />
      </div>

      {/* A1 approval queue */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Approvals within your authority</h2>
          <Link
            to="/approvals"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            Open full queue <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {pendingA1.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No approvals pending.</p>
          )}
          {pendingA1.map((r) => (
            <ApprovalQueueItem key={r.id} requisition={r} role="A1" actions={actions} />
          ))}
        </div>
      </Card>

      {/* Escalated to A1+ */}
      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold">Above your limit — escalated to A1+</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Items above ₹5,00,000 require final approval from A1+.
        </p>
        <div className="mt-4 space-y-3">
          {escalatedToA1Plus.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-border p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.pr_number} · {r.vendor_name ?? "—"} · {inr(r.amount)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="size-3.5" />
                  Needs A1+
                </span>
                <StatusPill tone={r.stage === "Invoice" ? "info" : "warning"}>{r.stage}</StatusPill>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Project overview */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold">Block progress overview</h2>
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
          <h2 className="text-sm font-bold">Quality & traceability status</h2>
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
  icon: typeof Building2;
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
