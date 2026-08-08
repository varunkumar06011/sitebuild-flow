// Shared hook encapsulating approve/reject logic for requisition approval queues.
// Eliminates duplication across approvals.tsx, administrator.tsx, a1.tsx, and a1plus.tsx.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateRequisitionStage } from "@/lib/api/requisitions";
import { useRole } from "@/lib/role-context";
import { toast } from "sonner";

export type Decision = "Approved" | "Rejected";

export type ApprovalActions = {
  // Per-requisition decision state (session-local UI feedback).
  decided: Record<string, Decision>;
  // Requisition currently being processed (prevents double-submit).
  processingId: string | null;
  // Approve a requisition, advancing it to PO. Returns true on success.
  approve: (id: string, prNumber: string, expectedStage: string) => Promise<boolean>;
  // Reject a requisition, sending it back to Quotation. Optional reason is recorded.
  reject: (
    id: string,
    prNumber: string,
    expectedStage: string,
    reason?: string,
  ) => Promise<boolean>;
  // Whether a given requisition id is currently being processed.
  isProcessing: (id: string) => boolean;
};

// useApprovalActions — shared approve/reject logic with toast notifications,
// query invalidation, per-item processing locks, and session decision state.
export function useApprovalActions(approverLabel?: string): ApprovalActions {
  const { role } = useRole();
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const label = approverLabel ?? role;

  const approve = async (id: string, prNumber: string, expectedStage: string): Promise<boolean> => {
    if (processingId) return false;
    setProcessingId(id);
    const result = await updateRequisitionStage({ data: { id, newStage: "PO", expectedStage } });
    setProcessingId(null);
    if (result.success) {
      setDecided((d) => ({ ...d, [id]: "Approved" }));
      toast.success(`${prNumber} approved by ${label}`);
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
      return true;
    }
    toast.error(result.error ?? "Failed to approve");
    return false;
  };

  const reject = async (
    id: string,
    prNumber: string,
    expectedStage: string,
    reason?: string,
  ): Promise<boolean> => {
    if (processingId) return false;
    setProcessingId(id);
    const result = await updateRequisitionStage({
      data: {
        id,
        newStage: "Quotation",
        expectedStage,
        rejectionReason: reason?.trim() || undefined,
      },
    });
    setProcessingId(null);
    if (result.success) {
      setDecided((d) => ({ ...d, [id]: "Rejected" }));
      toast.error(`${prNumber} sent back to site`);
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
      return true;
    }
    toast.error(result.error ?? "Failed to reject");
    return false;
  };

  const isProcessing = (id: string) => processingId === id;

  return { decided, processingId, approve, reject, isProcessing };
}
