import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  REQUISITIONS,
  GATE_PASSES,
  INSPECTIONS,
  LABOUR,
  PROGRESS,
  inr,
} from "@/lib/erp-data";
import { requireRole } from "@/lib/auth-guards";
import {
  ClipboardList,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  ArrowUpRight,
  Package,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/supervisor")({
  head: () => ({
    meta: [{ title: "Supervisor Dashboard — Meditrust ERP" }],
  }),
  ssr: false,
  beforeLoad: () => requireRole("Supervisor"),
  component: SupervisorDashboard,
});

function SupervisorDashboard() {
  const myPRs = REQUISITIONS.filter((r) => r.raisedBy === "R. Kannan" || r.raisedBy === "S. Fernandes" || r.raisedBy === "P. Deshmukh");
  const pendingAction = REQUISITIONS.filter(
    (r) => r.stage === "Quotation" || r.stage === "PR",
  );
  const awaitingOTP = GATE_PASSES.filter((g) => g.status === "Awaiting OTP");
  const failedQC = INSPECTIONS.filter((i) => i.result === "Fail" || i.result === "Re-inspection");

  return (
    <AppShell
      title="Supervisor Dashboard"
      subtitle="Site operations · Vgrand Multi-speciality Hospital · Phase 2"
    >
      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardList} label="My Requisitions" value={String(myPRs.length)} note="Across all blocks" tone="info" />
        <StatCard icon={AlertCircle} label="Pending Action" value={String(pendingAction.length)} note="Need quotation upload" tone="warning" />
        <StatCard icon={ScanLine} label="Gate Passes" value={String(awaitingOTP.length)} note="Awaiting OTP" tone="warning" />
        <StatCard icon={BadgeCheck} label="QC Issues" value={String(failedQC.length)} note="Fail or re-inspection" tone="danger" />
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
            {myPRs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.id} · {r.block} · raised by {r.raisedBy}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                  <StatusPill
                    tone={r.stage === "Completed" ? "success" : r.stage === "Admin" || r.stage === "A1" ? "warning" : "info"}
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
              {PROGRESS.map((p) => (
                <div key={p.block}>
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
              {LABOUR.map((l) => (
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
            {failedQC.map((i) => (
              <div
                key={i.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{i.activity}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.id} · {i.location} · {i.inspector}
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
