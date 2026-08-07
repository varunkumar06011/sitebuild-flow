// Administrator dashboard route: requires Administrator role and renders the within-limit approval dashboard.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { approverFor, inr, ROLE_SUMMARY } from "@/lib/erp-data";
import { requireRole } from "@/lib/auth-guards";
import { fetchRequisitions, type RequisitionRow } from "@/lib/api/requisitions";
import { fetchInspections } from "@/lib/api/inspections";
import { fetchProgress } from "@/lib/api/progress";
import { useRole } from "@/lib/role-context";
import { useApprovalActions } from "@/hooks/use-approval-actions";
import { ApprovalQueueItem } from "@/components/approval/ApprovalQueueItem";
import { DecisionHistory } from "@/components/approval/DecisionHistory";
import {
  ShieldCheck,
  ArrowUpRight,
  Lock,
  CheckCircle2,
  TrendingUp,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/administrator")({
  head: () => ({
    meta: [{ title: "Administrator Dashboard — Meditrust ERP" }],
  }),
  beforeLoad: async () => { await requireRole("Administrator"); },
  component: AdministratorDashboard,
});

// Administrator dashboard showing within-limit approvals, escalated items, progress, and QC snapshot.
function AdministratorDashboard() {
  const { name } = useRole();
  const actions = useApprovalActions();

  const { data: reqData } = useQuery({ queryKey: ["requisitions"], queryFn: () => fetchRequisitions({ data: {} }), refetchInterval: 15000 });
  const { data: inspData } = useQuery({ queryKey: ["inspections"], queryFn: () => fetchInspections({ data: {} }) });
  const { data: progData } = useQuery({ queryKey: ["progress"], queryFn: () => fetchProgress() });

  const requisitions: RequisitionRow[] = reqData?.data ?? [];
  const inspections = inspData?.data ?? [];
  const progress = progData?.data ?? [];

  const withinLimit = requisitions.filter((r) => approverFor(r.amount) === "Administrator");
  const pendingApproval = withinLimit.filter(
    (r) => r.stage === "Admin" && !actions.decided[r.id],
  );
  const totalCommitted = requisitions
    .filter((r) => r.stage === "Completed")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <AppShell
      title="Administrator Dashboard"
      subtitle={`Approval limit: ${ROLE_SUMMARY.Administrator.limit} · Vgrand Hospital`}
    >
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShieldCheck}
          label="Pending Approvals"
          value={String(pendingApproval.length)}
          note="Within ₹50,000 limit"
          tone="warning"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approved Today"
          value={String(Object.values(actions.decided).filter((v) => v === "Approved").length)}
          note="This session"
          tone="success"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Committed"
          value={inr(totalCommitted)}
          note="Completed POs"
          tone="info"
        />
        <StatCard
          icon={Users}
          label="Vendors Managed"
          value={String(new Set(requisitions.map((r) => r.vendor_name).filter(Boolean)).size)}
          note="Active suppliers"
          tone="info"
        />
      </div>

      {/* Approval queue */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Approvals within your limit</h2>
          <Link to="/approvals" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
            Open full queue <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {withinLimit.map((r) => (
            <ApprovalQueueItem
              key={r.id}
              requisition={r}
              role="Administrator"
              actions={actions}
            />
          ))}
        </div>
      </Card>

      {/* Escalated items (above admin limit) */}
      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold">Escalated to higher authority</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Items above ₹50,000 are outside your approval limit.
        </p>
        <div className="mt-4 space-y-3">
          {requisitions.filter((r) => approverFor(r.amount) !== "Administrator").map((r) => (
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
                  Needs {approverFor(r.amount)}
                </span>
                <StatusPill tone={r.stage === "A1" || r.stage === "A1+" ? "warning" : "info"}>{r.stage}</StatusPill>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Block progress + QC snapshot */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold">Project progress</h2>
          <div className="mt-4 space-y-4">
            {progress.map((p: any) => (
              <div key={p.block}>
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
          <h2 className="text-sm font-bold">Quality snapshot</h2>
          <div className="mt-4 space-y-3">
            {inspections.map((i: any) => (
              <div key={i.id} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.activity}</p>
                  <p className="text-xs text-muted-foreground">{i.location}</p>
                </div>
                <StatusPill
                  tone={i.result === "Pass" ? "success" : i.result === "Fail" ? "danger" : "warning"}
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
  icon: typeof ShieldCheck;
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
