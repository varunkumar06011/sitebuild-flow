// Reusable approval queue row rendering a single pending requisition with
// approve/reject actions, role-based gating, loading states, and reject dialog.
// Shared by the approvals page and role dashboards to eliminate duplicated render logic.
import { useState } from "react";
import { StatusPill } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { RejectDialog } from "./RejectDialog";
import { approverFor, canApprove, inr, type Role } from "@/lib/erp-data";
import type { RequisitionRow } from "@/lib/api/requisitions";
import type { ApprovalActions } from "@/hooks/use-approval-actions";
import { CheckCircle2, Lock, Loader2 } from "lucide-react";

export type ApprovalQueueItemProps = {
  requisition: RequisitionRow;
  role: Role;
  actions: ApprovalActions;
  // Optional override for the approve button label (e.g. "Final Approve" for A1+).
  approveLabel?: string;
  // When true, A1+ can approve items even if they're in Admin/A1 stage (override mode).
  allowOverride?: boolean;
};

// ApprovalQueueItem — renders a single requisition row with role-gated approve/reject controls.
export function ApprovalQueueItem({
  requisition: r,
  role,
  actions,
  approveLabel = "Approve",
  allowOverride = false,
}: ApprovalQueueItemProps) {
  const [showReject, setShowReject] = useState(false);
  const need = approverFor(r.amount);
  const allowed = allowOverride || canApprove(role, r.amount);
  const status = actions.decided[r.id];
  const processing = actions.isProcessing(r.id);

  const handleApprove = () => actions.approve(r.id, r.pr_number, r.stage);
  const handleReject = (reason: string) => {
    actions.reject(r.id, r.pr_number, r.stage, reason).then((ok) => {
      if (ok) setShowReject(false);
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold">{r.title}</p>
        <p className="text-xs text-muted-foreground">
          {r.pr_number} · {r.vendor_name ?? "—"} · {r.block}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
        <StatusPill tone={need === "Administrator" ? "info" : need === "A1" ? "warning" : "danger"}>
          Needs {need}
        </StatusPill>
        {status ? (
          <StatusPill tone={status === "Approved" ? "success" : "danger"}>{status}</StatusPill>
        ) : allowed ? (
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={handleApprove}
              disabled={processing}
              aria-label={`Approve ${r.pr_number} — ${r.title}`}
            >
              {processing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {approveLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setShowReject(true)}
              disabled={processing}
              aria-label={`Reject ${r.pr_number} — ${r.title}`}
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
      <RejectDialog
        open={showReject}
        prNumber={r.pr_number}
        title={r.title}
        processing={processing}
        onConfirm={handleReject}
        onCancel={() => setShowReject(false)}
      />
    </div>
  );
}
