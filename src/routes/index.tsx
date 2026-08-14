import { createFileRoute, redirect } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { inr, approverFor, ROLE_SUMMARY } from "@/lib/erp-data";
import { fetchRequisitions } from "@/lib/api/requisitions";
import { fetchProgress } from "@/lib/api/progress";
import { fetchGatePasses } from "@/lib/api/gate-passes";
import { fetchInspections } from "@/lib/api/inspections";
import { useRole } from "@/lib/role-context";
import { authStore } from "@/lib/auth-store";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meditrust ERP — Hospital Construction Control Centre" },
      {
        name: "description",
        content:
          "ERP for hospital construction: procurement approvals, gate pass OTP, quality control and site registers.",
      },
      { property: "og:title", content: "Meditrust ERP — Hospital Construction Control Centre" },
      {
        property: "og:description",
        content:
          "Role-based procurement, approvals, gate pass, QC and registers in one system.",
      },
    ],
  }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const state = authStore.getState();
    if (state.isAuthenticated && state.role) {
      const routes: Record<string, string> = {
        Supervisor: "/supervisor",
        Administrator: "/administrator",
        A1: "/a1",
        "A1+": "/a1plus",
      };
      throw redirect({ to: routes[state.role] ?? "/login" });
    }
    throw redirect({ to: "/login" });
  },
  component: Overview,
});

function Overview() {
  const { role } = useRole();
  const { data: reqData } = useQuery({
    queryKey: ["requisitions"],
    queryFn: () => fetchRequisitions({}),
  });
  const { data: progData } = useQuery({ queryKey: ["progress"], queryFn: () => fetchProgress() });
  const { data: gpData } = useQuery({
    queryKey: ["gatePasses"],
    queryFn: () => fetchGatePasses({}),
  });
  const { data: inspData } = useQuery({
    queryKey: ["inspections"],
    queryFn: () => fetchInspections({}),
  });

  const requisitions = reqData?.data ?? [];
  const progress = progData?.data ?? [];
  const gatePasses = gpData?.data ?? [];
  const inspections = inspData?.data ?? [];

  const pending = requisitions.filter((r: any) => r.stage === "Admin" || r.stage === "A1");
  const committed = requisitions.reduce((s: number, r: any) => s + r.amount, 0);

  return (
    <AppShell
      title="Site control centre"
      subtitle="Vgrand Multi-speciality Hospital · Phase 2 · 320 beds"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Open requisitions"
          value={String(requisitions.length)}
          note="Across 4 blocks"
        />
        <Stat
          label="Awaiting approval"
          value={String(pending.length)}
          note="2 above admin limit"
          tone="warning"
        />
        <Stat label="Committed value" value={inr(committed)} note="Purchase orders + pipeline" />
        <Stat
          label="Gate passes today"
          value={String(gatePasses.length)}
          note="1 awaiting OTP"
          tone="info"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Approval queue</h2>
            <Link
              to="/approvals"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              Open queue <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {pending.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.pr_number} · {r.block} · raised by {r.raised_by_name ?? "Unknown"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                  <StatusPill tone={approverFor(r.amount) === "Administrator" ? "info" : "warning"}>
                    {approverFor(r.amount)}
                  </StatusPill>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">Your role</h2>
          <p className="mt-3 text-lg font-bold text-primary">{role}</p>
          <p className="mt-2 text-sm text-muted-foreground">{ROLE_SUMMARY[role].scope}</p>
          <div className="mt-4 rounded-lg bg-surface p-3 text-xs">
            <p className="font-semibold">Approval limit</p>
            <p className="text-muted-foreground">{ROLE_SUMMARY[role].limit}</p>
            <p className="mt-2 font-semibold">Cannot</p>
            <p className="text-muted-foreground">{ROLE_SUMMARY[role].cannot}</p>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-bold">Block progress</h2>
          <div className="mt-4 space-y-4">
            {progress.map((p: any) => (
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
          <h2 className="text-sm font-bold">Quality snapshot</h2>
          <div className="mt-4 space-y-3">
            {inspections.map((i: any) => (
              <div key={i.id} className="flex items-start justify-between gap-3">
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
          <h2 className="text-sm font-bold">Gate passes</h2>
          <div className="mt-4 space-y-3">
            {gatePasses.map((g: any) => (
              <div key={g.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{g.gp_number}</span>
                <span className="font-mono font-semibold">{g.status}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "warning" | "info";
}) {
  const bar = {
    neutral: "bg-primary",
    warning: "bg-warning",
    info: "bg-info",
  } as const;
  return (
    <Card className="relative overflow-hidden p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar[tone]}`} />
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </Card>
  );
}
