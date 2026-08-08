// Pure stage transition validation logic — extracted from the server function
// so it can be unit-tested without a database.
import { approverFor, canApprove, stageForRole, type Role, type Stage } from "./erp-data";

// Stages a supervisor can advance without approval (post-PO pipeline steps).
export const SUPERVISOR_STAGES = ["PO", "Material Received", "Invoice", "Payment"] as const;

// Maps a current stage to the next stage in the pipeline
export const NEXT_STAGE: Record<string, string> = {
  PR: "Quotation",
  Quotation: "", // routed by amount — handled specially
  Admin: "PO",
  A1: "PO",
  "A1+": "PO",
  PO: "Material Received",
  "Material Received": "Invoice",
  Invoice: "Payment",
  Payment: "Completed",
};

export type ValidationResult = { valid: true } | { valid: false; error: string };

// Input shape for the validation function.
export type TransitionInput = {
  fromStage: string;
  toStage: string;
  amount: number;
  role: Role;
  hasSelectedQuotation: boolean;
};

// Validates whether a stage transition is allowed given the current stage,
// target stage, amount, user role, and whether a quotation is selected.
// Returns { valid: true } if allowed, or { valid: false, error } with a reason.
export function validateStageTransition(input: TransitionInput): ValidationResult {
  const { fromStage, toStage, amount, role, hasSelectedQuotation } = input;

  // --- Approval gate: Quotation → Admin/A1/A1+ (submit for approval) ---
  if (fromStage === "Quotation" && (toStage === "Admin" || toStage === "A1" || toStage === "A1+")) {
    if (role !== "Supervisor") {
      return { valid: false, error: "Only a Supervisor submits quotations for approval" };
    }
    if (!hasSelectedQuotation) {
      return { valid: false, error: "Select a quotation before submitting for approval" };
    }
    const requiredApprover = approverFor(amount);
    const requiredStage = stageForRole(requiredApprover);
    if (toStage !== requiredStage) {
      return {
        valid: false,
        error: `This amount requires ${requiredApprover} approval (route to ${requiredStage})`,
      };
    }
    return { valid: true };
  }

  // --- Approval gate: Admin/A1/A1+ → PO (approve) ---
  if ((fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") && toStage === "PO") {
    if (!canApprove(role, amount)) {
      return {
        valid: false,
        error: `Your role (${role}) cannot approve requisitions of this amount`,
      };
    }
    return { valid: true };
  }

  // --- Reject: Admin/A1/A1+ → Quotation ---
  if (
    (fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") &&
    toStage === "Quotation"
  ) {
    if (!canApprove(role, amount)) {
      return {
        valid: false,
        error: `Your role (${role}) cannot reject requisitions of this amount`,
      };
    }
    return { valid: true };
  }

  // --- Cancel: any stage → Cancelled (supervisor or approver only) ---
  // Checked before post-approval so cancel works from any pre-completion stage.
  if (toStage === "Cancelled" && fromStage !== "Completed" && fromStage !== "Cancelled") {
    if (role !== "Supervisor" && !canApprove(role, amount)) {
      return { valid: false, error: "Only a Supervisor or approver can cancel a requisition" };
    }
    return { valid: true };
  }

  // --- Post-approval: PO → Material Received → Invoice → Payment → Completed ---
  if (SUPERVISOR_STAGES.includes(fromStage as (typeof SUPERVISOR_STAGES)[number])) {
    const expectedNext = NEXT_STAGE[fromStage];
    if (toStage !== expectedNext) {
      return {
        valid: false,
        error: `Invalid stage transition: ${fromStage} → ${toStage}. Expected: ${expectedNext}`,
      };
    }
    if (role === "Supervisor") {
      return { valid: true };
    }
    if (canApprove(role, amount)) {
      return { valid: true };
    }
    return {
      valid: false,
      error: "Only a Supervisor or approver can advance post-approval stages",
    };
  }

  // --- PR → Quotation (supervisor advances) ---
  if (fromStage === "PR" && toStage === "Quotation") {
    return { valid: true };
  }

  // --- Completed/Cancelled are terminal — no transitions out ---
  if (fromStage === "Completed" || fromStage === "Cancelled") {
    return { valid: false, error: `Cannot transition from ${fromStage} — it is a terminal stage` };
  }

  return { valid: false, error: `Invalid stage transition: ${fromStage} → ${toStage}` };
}
