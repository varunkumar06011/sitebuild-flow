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
import { fetchLabour } from "@/lib/api/registers";
import { useRole } from "@/lib/role-context";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meditrust ERP — Hospital Construction Control Centre" },
      {
        name: "description",
        content:
          "ERP for hospital construction: procurement approvals, gate pass OTP, material traceability, quality control and site registers.",
      },
      { property: "og:title", content: "Meditrust ERP — Hospital Construction Control Centre" },
      {
        property: "og:description",
        content:
          "Role-based procurement, approvals, gate pass, traceability, QC and labour registers in one system.",
      },
    ],
  }),
  beforeLoad: () => {
    // Only redirect on client — SSR has no localStorage
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("meditrust-auth-user");
      if (saved) {
        const state = JSON.parse(saved) as { role: string; isAuthenticated: boolean };
        if (state.isAuthenticated && state.role) {
          const routes: Record<string, string> = {
            Supervisor: "/supervisor",
            Administrator: "/administrator",
            A1: "/a1",
            "A1+": "/a1plus",
          };
          throw redirect({ to: routes[state.role] ?? "/login" });
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "status" in e) throw e;
    }
    throw redirect({ to: "/login" });
  },
  component: Overview,
});

function Overview() {
  const { role } = useRole();
  const { data: reqData } = useQuery({ queryKey: ["requisitions"], queryFn: () => fetchRequisitions({ data: {} }) });
  const { data: progData } = useQuery({ queryKey: ["progress"], queryFn: () => fetchProgress() });
  const { data: gpData } = useQuery({ queryKey: ["gatePasses"], queryFn: () => fetchGatePasses({ data: {} }) });
  const { data: inspData } = useQuery({ queryKey: ["inspections"], queryFn: () => fetchInspections({ data: {} }) });
  const { data: labData } = useQuery({ queryKey: ["labour"], queryFn: () => fetchLabour({ data: {} }) });

  const requisitions = reqData?.data ?? [];
  const progress = progData?.data ?? [];
  const gatePasses = gpData?.data ?? [];
  const inspections = inspData?.data ?? [];
  const labour = labData?.data ?? [];

  const pending = requisitions.filter((r: any) => r.stage === "Admin" || r.stage === "A1");
  const committed = requisitions.reduce((s: number, r: any) => s + r.amount, 0);

  return (
    <AppShell
      title="Site control centre"
      subtitle="Vgrand Multi-speciality Hospital · Phase 2 · 320 beds"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open requisitions" value={String(requisitions.length)} note="Across 4 blocks" />
        <Stat label="Awaiting approval" value={String(pending.length)} note="2 above admin limit" tone="warning" />
        <Stat label="Committed value" value={inr(committed)} note="Purchase orders + pipeline" />
        <Stat label="Gate passes today" value={String(gatePasses.length)} note="1 awaiting OTP" tone="info" />
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
                  tone={i.result === "Pass" ? "success" : i.result === "Fail" ? "danger" : "warning"}
                >
                  {i.result}
                </StatusPill>
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
