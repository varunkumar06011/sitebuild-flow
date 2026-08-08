import { describe, it, expect } from "vitest";
import { validateStageTransition, type TransitionInput } from "../stage-transitions";

// Helper to build a transition input with defaults
function makeInput(overrides: Partial<TransitionInput>): TransitionInput {
  return {
    fromStage: "PR",
    toStage: "Quotation",
    amount: 10000,
    role: "Supervisor",
    hasSelectedQuotation: false,
    ...overrides,
  };
}

describe("validateStageTransition", () => {
  // ===========================================================================
  // PR → Quotation
  // ===========================================================================
  describe("PR → Quotation", () => {
    it("allows any role to advance PR to Quotation", () => {
      expect(validateStageTransition(makeInput({ role: "Supervisor" }))).toEqual({ valid: true });
      expect(validateStageTransition(makeInput({ role: "Administrator" }))).toEqual({
        valid: true,
      });
      expect(validateStageTransition(makeInput({ role: "A1+" }))).toEqual({ valid: true });
    });
  });

  // ===========================================================================
  // Quotation → Admin/A1/A1+ (submit for approval)
  // ===========================================================================
  describe("Quotation → Admin (submit for approval)", () => {
    it("allows Supervisor to submit for Admin approval (amount ≤ 50,000)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Admin",
          amount: 50000,
          role: "Supervisor",
          hasSelectedQuotation: true,
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects non-Supervisor from submitting for approval", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Admin",
          amount: 50000,
          role: "Administrator",
          hasSelectedQuotation: true,
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("Only a Supervisor");
    });

    it("rejects submission without a selected quotation", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Admin",
          amount: 50000,
          role: "Supervisor",
          hasSelectedQuotation: false,
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("Select a quotation");
    });

    it("rejects routing to wrong approver tier (amount 50,000 → A1 instead of Admin)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "A1",
          amount: 50000,
          role: "Supervisor",
          hasSelectedQuotation: true,
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("Administrator");
    });

    it("rejects routing to wrong approver tier (amount 500,001 → Admin instead of A1+)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Admin",
          amount: 500001,
          role: "Supervisor",
          hasSelectedQuotation: true,
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("A1+");
    });

    it("rejects routing to wrong approver tier (amount 50,001 → Admin instead of A1)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Admin",
          amount: 50001,
          role: "Supervisor",
          hasSelectedQuotation: true,
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("A1");
    });

    it("allows routing to A1 for amount 50,001–5,00,000", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "A1",
          amount: 250000,
          role: "Supervisor",
          hasSelectedQuotation: true,
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows routing to A1+ for amount above 5,00,000", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "A1+",
          amount: 500001,
          role: "Supervisor",
          hasSelectedQuotation: true,
        }),
      );
      expect(result).toEqual({ valid: true });
    });
  });

  // ===========================================================================
  // Admin/A1/A1+ → PO (approve)
  // ===========================================================================
  describe("Approval → PO (approve)", () => {
    it("allows Administrator to approve within their limit (₹50,000)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "PO",
          amount: 50000,
          role: "Administrator",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects Administrator approving above their limit (₹50,001)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "PO",
          amount: 50001,
          role: "Administrator",
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("cannot approve");
    });

    it("allows A1 to approve within their limit (₹5,00,000)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "A1",
          toStage: "PO",
          amount: 500000,
          role: "A1",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects A1 approving above their limit (₹5,00,001)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "A1",
          toStage: "PO",
          amount: 500001,
          role: "A1",
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("cannot approve");
    });

    it("allows A1+ to approve any amount", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "A1+",
          toStage: "PO",
          amount: 5000000,
          role: "A1+",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects Supervisor from approving", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "PO",
          amount: 50000,
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // Admin/A1/A1+ → Quotation (reject)
  // ===========================================================================
  describe("Approval → Quotation (reject)", () => {
    it("allows Administrator to reject within their limit", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "Quotation",
          amount: 50000,
          role: "Administrator",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects Administrator rejecting above their limit", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "Quotation",
          amount: 50001,
          role: "Administrator",
        }),
      );
      expect(result.valid).toBe(false);
    });

    it("allows A1+ to reject any amount", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "A1+",
          toStage: "Quotation",
          amount: 5000000,
          role: "A1+",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects Supervisor from rejecting", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "Quotation",
          amount: 50000,
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // Post-approval: PO → Material Received → Invoice → Payment → Completed
  // ===========================================================================
  describe("Post-approval forward transitions", () => {
    it("allows Supervisor to advance PO → Material Received", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "PO",
          toStage: "Material Received",
          role: "Supervisor",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows Supervisor to advance Material Received → Invoice", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Material Received",
          toStage: "Invoice",
          role: "Supervisor",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows Supervisor to advance Invoice → Payment", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Invoice",
          toStage: "Payment",
          role: "Supervisor",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows Supervisor to advance Payment → Completed", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Payment",
          toStage: "Completed",
          role: "Supervisor",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows approver to advance post-approval stages", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "PO",
          toStage: "Material Received",
          role: "A1+",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects invalid forward transition (PO → Invoice, skipping Material Received)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "PO",
          toStage: "Invoice",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("Expected: Material Received");
    });

    it("rejects invalid forward transition (Payment → Material Received, going backwards)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Payment",
          toStage: "Material Received",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // Cancel
  // ===========================================================================
  describe("Cancel transitions", () => {
    it("allows Supervisor to cancel from Quotation stage", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Cancelled",
          role: "Supervisor",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows Supervisor to cancel from Admin (approval in progress)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Admin",
          toStage: "Cancelled",
          role: "Supervisor",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows A1+ to cancel from any pre-completion stage", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "A1+",
          toStage: "Cancelled",
          role: "A1+",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("allows Administrator to cancel", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "PO",
          toStage: "Cancelled",
          role: "Administrator",
        }),
      );
      expect(result).toEqual({ valid: true });
    });

    it("rejects cancelling from Completed stage", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Completed",
          toStage: "Cancelled",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects cancelling from Cancelled stage", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Cancelled",
          toStage: "Cancelled",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // Terminal stages
  // ===========================================================================
  describe("Terminal stages", () => {
    it("rejects any transition from Completed", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Completed",
          toStage: "Payment",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("terminal");
    });

    it("rejects any transition from Cancelled", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Cancelled",
          toStage: "Quotation",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("terminal");
    });
  });

  // ===========================================================================
  // Invalid transitions
  // ===========================================================================
  describe("Invalid transitions", () => {
    it("rejects PR → PO (skipping Quotation and approval)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "PR",
          toStage: "PO",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects Quotation → PO (must go through approval stage)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "PO",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });

    it("rejects Quotation → Completed (skipping entire pipeline)", () => {
      const result = validateStageTransition(
        makeInput({
          fromStage: "Quotation",
          toStage: "Completed",
          role: "Supervisor",
        }),
      );
      expect(result.valid).toBe(false);
    });
  });
});
