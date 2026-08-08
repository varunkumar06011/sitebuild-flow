// Supervisor dashboard route: requires Supervisor role and renders the site operations dashboard.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { inr } from "@/lib/erp-data";
import { requireRole } from "@/lib/auth-guards";
import { fetchRequisitions } from "@/lib/api/requisitions";
import { fetchGatePasses } from "@/lib/api/gate-passes";
import { fetchInspections } from "@/lib/api/inspections";
import { fetchProgress } from "@/lib/api/progress";
import { fetchLabour } from "@/lib/api/registers";
import {
  ClipboardList,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  ArrowUpRight,
  Package,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/supervisor")({
  head: () => ({
    meta: [{ title: "Supervisor Dashboard — Meditrust ERP" }],
  }),
  beforeLoad: async () => { await requireRole("Supervisor"); },
  component: SupervisorDashboard,
});

// Supervisor dashboard showing requisitions, quick actions, progress, labour, and QC alerts.
function SupervisorDashboard() {
  const { data: reqData, isError: reqError, error: reqErr } = useQuery({ queryKey: ["requisitions"], queryFn: () => fetchRequisitions({ data: {} }) });
  const { data: gpData } = useQuery({ queryKey: ["gatePasses"], queryFn: () => fetchGatePasses({ data: {} }) });
  const { data: inspData } = useQuery({ queryKey: ["inspections"], queryFn: () => fetchInspections({ data: {} }) });
  const { data: progData } = useQuery({ queryKey: ["progress"], queryFn: () => fetchProgress() });
  const { data: labourData } = useQuery({ queryKey: ["labour"], queryFn: () => fetchLabour({ data: {} }) });

  const requisitions = reqData?.data ?? [];
  const gatePasses = gpData?.data ?? [];
  const inspections = inspData?.data ?? [];
  const progress = progData?.data ?? [];
  const labour = labourData?.data ?? [];

  const dashboardError = reqError ? reqErr?.message ?? "Failed to load data" : null;

  const myPRs = requisitions;
  const pendingAction = requisitions.filter(
    (r: any) => r.stage === "Quotation" || r.stage === "PR",
  );
  const awaitingApproval = requisitions.filter(
    (r: any) => r.stage === "Admin" || r.stage === "A1" || r.stage === "A1+",
  );
  const approved = requisitions.filter(
    (r: any) => ["PO", "Material Received", "Invoice", "Payment", "Completed"].includes(r.stage),
  );
  const rejected = requisitions.filter(
    (r: any) => r.stage === "Quotation" && r.rejection_reason,
  );
  const awaitingOTP = gatePasses.filter((g: any) => g.status === "Awaiting OTP");
  const failedQC = inspections.filter((i: any) => i.result === "Fail" || i.result === "Re-inspection");

  return (
    <AppShell
      title="Supervisor Dashboard"
      subtitle="Site operations · Vgrand Multi-speciality Hospital · Phase 2"
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

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardList} label="My Requisitions" value={String(myPRs.length)} note="Across all blocks" tone="info" />
        <StatCard icon={Clock} label="Awaiting Approval" value={String(awaitingApproval.length)} note="Sent to admin/A1/A1+" tone="warning" />
        <StatCard icon={CheckCircle2} label="Approved" value={String(approved.length)} note="PO issued or beyond" tone="success" />
        <StatCard icon={AlertCircle} label="Needs Action" value={String(pendingAction.length)} note="PR/Quotation stage" tone="danger" />
      </div>

      {/* Quick actions */}
      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold">Quick actions</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction to="/procurement" icon={ClipboardList} title="Raise Purchase Requisition" desc="Create PR, upload quotations" />
          <QuickAction to="/gate-pass" icon={ScanLine} title="Issue Gate Pass" desc="OTP + QR material exit" />
          <QuickAction to="/traceability" icon={Boxes} title="Update Traceability" desc="Batch, MTC, lab reports" />
          <QuickAction to="/quality" icon={BadgeCheck} title="Quality Inspection" desc="Checklist, pass/fail, photos" />
          <QuickAction to="/registers" icon={Users} title="Site Registers" desc="Visitors, vehicles, labour" />
          <QuickAction to="/procurement" icon={Package} title="Receive Materials" desc="Update inventory & progress" />
        </div>
      </Card>

      {/* Approval status section */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Awaiting approval */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-warning" />
              <h2 className="text-sm font-bold">Awaiting Approval</h2>
            </div>
            <Link to="/procurement" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              View all <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {awaitingApproval.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No PRs awaiting approval.</p>
            ) : (
              awaitingApproval.map((r: any) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.pr_number} · {r.block} · {inr(r.amount)}
                    </p>
                  </div>
                  <StatusPill tone="warning">
                    {r.stage}
                  </StatusPill>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Approved */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-success" />
              <h2 className="text-sm font-bold">Approved</h2>
            </div>
            <Link to="/procurement" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              View all <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {approved.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No approved PRs yet.</p>
            ) : (
              approved.slice(0, 5).map((r: any) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.pr_number} · {r.po_number ?? "—"} · {inr(r.amount)}
                    </p>
                  </div>
                  <StatusPill tone={r.stage === "Completed" ? "success" : "info"}>
                    {r.stage}
                  </StatusPill>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Rejected items */}
      {rejected.length > 0 && (
        <Card className="mt-6 p-5">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-destructive" />
            <h2 className="text-sm font-bold">Sent Back for Rework</h2>
          </div>
          <div className="mt-4 divide-y divide-border">
            {rejected.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.pr_number} · {r.block} · {inr(r.amount)}
                  </p>
                  {r.rejection_reason && (
                    <p className="mt-1 text-xs text-destructive">Reason: {r.rejection_reason}</p>
                  )}
                </div>
                <StatusPill tone="danger">
                  Rejected
                </StatusPill>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Two-column layout */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* My requisitions */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">My requisitions</h2>
            <Link to="/procurement" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              View all <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {myPRs.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.pr_number} · {r.block} · raised by {r.raised_by_name ?? "Unknown"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                  <StatusPill
                    tone={r.stage === "Completed" ? "success" : r.stage === "Admin" || r.stage === "A1" || r.stage === "A1+" ? "warning" : "info"}
                  >
                    {r.stage}
                  </StatusPill>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Block progress + labour */}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-bold">Block progress</h2>
            <div className="mt-4 space-y-4">
              {progress.map((p: any, i: number) => (
                <div key={`${p.block}-${i}`}>
                  <div className="flex justify-between text-xs font-medium">
                    <span>{p.block}</span>
                    <span className="text-muted-foreground">{p.pct}%</span>
                  </div>
                  <Progress value={p.pct} className="mt-1.5 h-2" />
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-bold">Labour on site today</h2>
            <div className="mt-4 space-y-3">
              {labour.map((l: any) => (
                <div key={l.trade} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{l.trade}</span>
                  <span className="font-mono font-semibold">
                    {l.present}/{l.planned}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* QC alerts */}
      {failedQC.length > 0 && (
        <Card className="mt-6 p-5">
          <h2 className="text-sm font-bold">Quality alerts</h2>
          <div className="mt-4 space-y-3">
            {failedQC.map((i: any) => (
              <div
                key={i.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{i.activity}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.qc_number} · {i.location} · {i.inspector}
                  </p>
                  {i.rectification && (
                    <p className="mt-2 text-xs text-warning-foreground">{i.rectification}</p>
                  )}
                </div>
                <StatusPill tone={i.result === "Fail" ? "danger" : "warning"}>
                  {i.result}
                </StatusPill>
              </div>
            ))}
          </div>
        </Card>
      )}
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
  icon: typeof Package;
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

// Link card that surfaces a quick navigation action with an icon, title, and description.
function QuickAction({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: typeof Package;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-surface"
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </Link>
  );
}
