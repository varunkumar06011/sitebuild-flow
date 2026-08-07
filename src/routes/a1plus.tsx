import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  REQUISITIONS,
  approverFor,
  inr,
  ROLE_SUMMARY,
  PROGRESS,
  INSPECTIONS,
  BATCHES,
  GATE_PASSES,
  LABOUR,
} from "@/lib/erp-data";
import { requireRole } from "@/lib/auth-guards";
import {
  Crown,
  ArrowUpRight,
  TrendingUp,
  ShieldCheck,
  Boxes,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/a1plus")({
  head: () => ({
    meta: [{ title: "A1+ Dashboard — Meditrust ERP" }],
  }),
  ssr: false,
  beforeLoad: () => requireRole("A1+"),
  component: A1PlusDashboard,
});

function A1PlusDashboard() {
  const [decided, setDecided] = useState<Record<string, "Approved" | "Rejected">>({});

  const allPending = REQUISITIONS.filter(
    (r) => (r.stage === "Admin" || r.stage === "A1") && !decided[r.id],
  );
  const highValue = REQUISITIONS.filter((r) => approverFor(r.amount) === "A1+");
  const totalCommitted = REQUISITIONS.reduce((s, r) => s + r.amount, 0);
  const completedValue = REQUISITIONS.filter((r) => r.stage === "Completed").reduce(
    (s, r) => s + r.amount,
    0,
  );
  const pendingBatches = BATCHES.filter((b) => b.status !== "Verified");
  const activeGatePasses = GATE_PASSES.filter((g) => g.status !== "Exited");
  const totalLabour = LABOUR.reduce((s, l) => s + l.present, 0);

  return (
    <AppShell
      title="A1+ Final Authority Dashboard"
      subtitle={`Full system control · ${ROLE_SUMMARY["A1+"].limit} · Override all decisions`}
    >
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
        <StatCard
          icon={Boxes}
          label="Traceability Issues"
          value={String(pendingBatches.length)}
          note="MTC or lab pending"
          tone="danger"
        />
        <StatCard
          icon={Users}
          label="Labour On Site"
          value={String(totalLabour)}
          note="Across all trades"
          tone="success"
        />
      </div>

      {/* Full approval queue — A1+ can approve everything */}
      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Full approval queue</h2>
          <Link to="/approvals" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
            Open approvals <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          As A1+ you have final authority over all approval tiers.
        </p>
        <div className="mt-4 space-y-3">
          {allPending.map((r) => {
            const status = decided[r.id];
            const need = approverFor(r.amount);
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.id} · {r.vendor} · {r.block}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                  <StatusPill tone={need === "A1+" ? "danger" : need === "A1" ? "warning" : "info"}>
                    Was {need}
                  </StatusPill>
                  {status ? (
                    <StatusPill tone={status === "Approved" ? "success" : "danger"}>
                      {status}
                    </StatusPill>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setDecided((d) => ({ ...d, [r.id]: "Approved" }));
                          toast.success(`${r.id} approved by A1+ (final)`);
                        }}
                      >
                        Final Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDecided((d) => ({ ...d, [r.id]: "Rejected" }));
                          toast.error(`${r.id} rejected by A1+`);
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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
        <div className="mt-4 overflow-x-auto">
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
                  <td className="py-3 font-mono text-xs">{r.id}</td>
                  <td className="py-3 font-medium">{r.title}</td>
                  <td className="py-3 text-right font-mono font-semibold">{inr(r.amount)}</td>
                  <td className="py-3">
                    <StatusPill
                      tone={r.stage === "Completed" ? "success" : r.stage === "Invoice" ? "info" : "warning"}
                    >
                      {r.stage}
                    </StatusPill>
                  </td>
                  <td className="py-3 text-muted-foreground">{r.vendor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Organization overview */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-bold">Block progress</h2>
          <div className="mt-4 space-y-4">
            {PROGRESS.map((p) => (
              <div key={p.block}>
                <div className="flex justify-between text-xs font-medium">
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
            {INSPECTIONS.map((i) => (
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
          <h2 className="text-sm font-bold">Site operations</h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Active gate passes</span>
              <span className="font-mono font-semibold">{activeGatePasses.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Pending traceability</span>
              <span className="font-mono font-semibold">{pendingBatches.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total labour on site</span>
              <span className="font-mono font-semibold">{totalLabour}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total vendors</span>
              <span className="font-mono font-semibold">
                {new Set(REQUISITIONS.map((r) => r.vendor)).size}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Completed POs</span>
              <span className="font-mono font-semibold">
                {REQUISITIONS.filter((r) => r.stage === "Completed").length}
              </span>
            </div>
          </div>
        </Card>
      </div>
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
