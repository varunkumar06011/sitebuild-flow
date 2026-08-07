import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { approverFor, canApprove, inr, ROLE_SUMMARY } from "@/lib/erp-data";
import { fetchRequisitions, updateRequisitionStage } from "@/lib/api/requisitions";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals & Limits — Meditrust ERP" },
      {
        name: "description",
        content:
          "Role-based approval queue with ₹50,000 admin, ₹5,00,000 A1 and above-limit A1+ authority tiers.",
      },
      { property: "og:title", content: "Approvals & Limits — Meditrust ERP" },
      {
        property: "og:description",
        content: "Approve or escalate requisitions according to Administrator, A1 and A1+ limits.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: Approvals,
});

function Approvals() {
  const { role } = useRole();
  const [decided, setDecided] = useState<Record<string, "Approved" | "Rejected">>({});
  const queryClient = useQueryClient();
  const { data: reqData } = useQuery({ queryKey: ["requisitions"], queryFn: () => fetchRequisitions({ data: {} }) });
  const requisitions = reqData?.data ?? [];
  const queue = requisitions.filter((r: any) => r.stage === "Admin" || r.stage === "A1" || r.stage === "Quotation");

  const handleApprove = async (id: string, prNumber: string, expectedStage: string) => {
    const result = await updateRequisitionStage({ data: { id, newStage: "PO", expectedStage } });
    if (result.success) {
      setDecided((d) => ({ ...d, [id]: "Approved" }));
      toast.success(`${prNumber} approved by ${role}`);
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
    } else {
      toast.error(result.error ?? "Failed to approve");
    }
  };

  const handleReject = async (id: string, prNumber: string, expectedStage: string) => {
    const result = await updateRequisitionStage({ data: { id, newStage: "Quotation", expectedStage } });
    if (result.success) {
      setDecided((d) => ({ ...d, [id]: "Rejected" }));
      toast.error(`${prNumber} sent back to site`);
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
    } else {
      toast.error(result.error ?? "Failed to reject");
    }
  };

  return (
    <AppShell title="Approvals" subtitle={`Acting as ${role} · ${ROLE_SUMMARY[role].limit}`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">Administrator</p>
          <p className="mt-1 text-lg font-bold">₹0 – 50,000</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">A1</p>
          <p className="mt-1 text-lg font-bold">₹50,001 – 5,00,000</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">A1+ (final authority)</p>
          <p className="mt-1 text-lg font-bold">Above ₹5,00,000</p>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-bold">Pending decisions</h2>
        <div className="mt-4 space-y-3">
          {queue.map((r: any) => {
            const need = approverFor(r.amount);
            const allowed = canApprove(role, r.amount);
            const status = decided[r.id];
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.pr_number} · {r.vendor_name ?? "—"} · {r.block}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                  <StatusPill tone={need === "Administrator" ? "info" : "warning"}>
                    Needs {need}
                  </StatusPill>
                  {status ? (
                    <StatusPill tone={status === "Approved" ? "success" : "danger"}>{status}</StatusPill>
                  ) : allowed ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(r.id, r.pr_number, r.stage)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(r.id, r.pr_number, r.stage)}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Lock className="size-3.5" />
                      {role === "Supervisor" ? "No approval rights" : `Escalate to ${need}`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </AppShell>
  );
}
