import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import { dispatchNotification } from "./notification-system";
import { approverFor, canApprove, inr, type Stage } from "../erp-data";
import { validateStageTransition } from "../stage-transitions";

// Shape of a requisition row returned to the client with vendor and raiser names joined.
export type RequisitionRow = {
  id: string;
  pr_number: string;
  po_number: string | null;
  grn_number: string | null;
  title: string;
  block: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number;
  stage: Stage;
  raised_by: string;
  raised_by_name: string | null;
  date: string;
  quotations: any[];
  documents: any[];
  delivery_date: string | null;
  quantity_received: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

// Fetches a paginated list of requisitions with vendor and raiser names joined, optional stage/raiser/search filters.
export const fetchRequisitions = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page?: number;
      limit?: number;
      stage?: string;
      raisedBy?: string;
      search?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("requisitions")
      .select(
        "id, pr_number, po_number, grn_number, title, block, vendor_id, amount, stage, raised_by, date, quotations, documents, delivery_date, quantity_received, invoice_number, invoice_date, invoice_amount, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, cancelled_by, cancelled_at, cancel_reason",
        { count: "exact" },
      )
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.stage) query = query.eq("stage", data.stage);
    if (data.raisedBy) query = query.eq("raised_by", data.raisedBy);
    if (data.search) {
      const s = sanitizeSearch(data.search);
      if (s) {
        query = query.or(
          `title.ilike.%${s}%,pr_number.ilike.%${s}%,po_number.ilike.%${s}%,block.ilike.%${s}%`,
        );
      }
    }

    const { data: reqs, count } = await query;

    const vendorIds = [...new Set((reqs ?? []).map((r: any) => r.vendor_id).filter(Boolean))];
    const userIds = [...new Set((reqs ?? []).map((r: any) => r.raised_by).filter(Boolean))];

    const [{ data: vendors }, { data: users }] = await Promise.all([
      vendorIds.length > 0
        ? supabaseServer.from("vendors").select("id, name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length > 0
        ? supabaseServer.from("users").select("id, name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    return {
      data: (reqs ?? []).map((r: any): RequisitionRow => ({
        id: r.id,
        pr_number: r.pr_number,
        po_number: r.po_number ?? null,
        grn_number: r.grn_number ?? null,
        title: r.title,
        block: r.block,
        vendor_id: r.vendor_id,
        vendor_name: r.vendor_id ? (vendorMap.get(r.vendor_id) ?? null) : null,
        amount: Number(r.amount),
        stage: r.stage as Stage,
        raised_by: r.raised_by,
        raised_by_name: userMap.get(r.raised_by) ?? null,
        date: r.date,
        quotations: r.quotations ?? [],
        documents: r.documents ?? [],
        delivery_date: r.delivery_date ?? null,
        quantity_received: r.quantity_received != null ? Number(r.quantity_received) : null,
        invoice_number: r.invoice_number ?? null,
        invoice_date: r.invoice_date ?? null,
        invoice_amount: r.invoice_amount != null ? Number(r.invoice_amount) : null,
        approved_by: r.approved_by ?? null,
        approved_at: r.approved_at ?? null,
        rejected_by: r.rejected_by ?? null,
        rejected_at: r.rejected_at ?? null,
        rejection_reason: r.rejection_reason ?? null,
        cancelled_by: r.cancelled_by ?? null,
        cancelled_at: r.cancelled_at ?? null,
        cancel_reason: r.cancel_reason ?? null,
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

// Zod schema validating requisition creation fields (title, block, vendor, amount, quotations, documents).
const createSchema = z.object({
  title: z.string().min(1),
  block: z.string().min(1),
  vendor_id: z.string().uuid().nullable(),
  amount: z.number().positive(),
  quotations: z
    .array(
      z.object({
        vendor: z.string(),
        vendor_id: z.string().uuid().nullable().optional(),
        amount: z.number(),
        selected: z.boolean(),
      }),
    )
    .default([]),
  documents: z.array(z.string()).default([]),
});

// Creates a new requisition with an auto-generated PR number and logs the action.
export const createRequisition = createServerFn({ method: "POST" })
  .validator(createSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    // Use the atomic DB sequence for PR numbers
    const { data: seqResult, error: seqError } = await supabaseServer.rpc("next_pr_number");

    const prNumber =
      seqError || !seqResult ? `PR-${Date.now().toString().slice(-6)}` : (seqResult as string);

    const { data: req, error } = await supabaseServer
      .from("requisitions")
      .insert({
        pr_number: prNumber,
        title: data.title,
        block: data.block,
        vendor_id: data.vendor_id,
        amount: data.amount,
        stage: "PR",
        raised_by: user.id,
        quotations: data.quotations,
        documents: data.documents,
      })
      .select("id, pr_number")
      .single();

    if (error || !req) {
      return { success: false, error: "Failed to create requisition" };
    }

    await logAction(user, "create_requisition", "requisition", req.id, {
      pr_number: req.pr_number,
      title: data.title,
      amount: data.amount,
    });

    // Notify all Administrator-role users that a new PR has been raised
    await notifyByRole(
      "Administrator",
      "new_pr",
      `New PR: ${req.pr_number}`,
      `${data.title} · ${data.block} · ${inr(data.amount)} · raised by ${user.name}`,
      { requisition_id: req.id, pr_number: req.pr_number, amount: data.amount },
    );

    return { success: true, id: req.id, pr_number: req.pr_number };
  });

// --- Update requisition details (quotations, documents, amount, vendor) ---
// Zod schema validating partial requisition detail updates (title, vendor, amount, quotations, documents).
const updateDetailsSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  block: z.string().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  amount: z.number().positive().optional(),
  quotations: z
    .array(
      z.object({
        vendor: z.string(),
        vendor_id: z.string().uuid().nullable().optional(),
        amount: z.number(),
        selected: z.boolean(),
      }),
    )
    .optional(),
  documents: z.array(z.string()).optional(),
});

// Updates editable details of an existing requisition and logs the action.
export const updateRequisitionDetails = createServerFn({ method: "POST" })
  .validator(updateDetailsSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { id, ...updates } = data;
    const updatePayload: Record<string, any> = {};
    if (updates.title !== undefined) updatePayload["title"] = updates.title;
    if (updates.block !== undefined) updatePayload["block"] = updates.block;
    if (updates.vendor_id !== undefined) updatePayload["vendor_id"] = updates.vendor_id;
    if (updates.amount !== undefined) updatePayload["amount"] = updates.amount;
    if (updates.quotations !== undefined) updatePayload["quotations"] = updates.quotations;
    if (updates.documents !== undefined) updatePayload["documents"] = updates.documents;

    if (Object.keys(updatePayload).length === 0) {
      return { success: false, error: "No fields to update" };
    }

    const { error } = await supabaseServer.from("requisitions").update(updatePayload).eq("id", id);

    if (error) {
      return { success: false, error: "Failed to update requisition" };
    }

    await logAction(user, "update_requisition", "requisition", id, updatePayload);

    return { success: true };
  });

// --- Helper: send notifications to users by role ---
// Errors are caught and logged so notification failures don't break the main operation.
async function notifyByRole(
  role: string,
  type: string,
  title: string,
  body: string,
  payload: Record<string, any>,
) {
  try {
    const { data: users } = await supabaseServer.from("users").select("id").eq("role", role);

    if (!users || users.length === 0) return;

    const inserts = users.map((u: any) => ({
      user_id: u.id,
      type,
      title,
      body,
      data: payload,
    }));

    await supabaseServer.from("notifications").insert(inserts);
  } catch (err) {
    console.error(`notifyByRole failed (${role}/${type}):`, err);
  }
}

// --- Helper: send notification to a single user ---
// Errors are caught and logged so notification failures don't break the main operation.
async function notifyUser(
  userId: string,
  type: string,
  title: string,
  body: string,
  payload: Record<string, any>,
) {
  try {
    await supabaseServer.from("notifications").insert({
      user_id: userId,
      type,
      title,
      body,
      data: payload,
    });
  } catch (err) {
    console.error(`notifyUser failed (${userId}/${type}):`, err);
  }
}

// --- Helper: sanitize search input for PostgREST .or() filter syntax ---
// Removes characters that could break or inject into PostgREST filter strings.
function sanitizeSearch(input: string): string {
  return input.replace(/[,.()\\]/g, " ").trim();
}

// --- Stage transitions ---
// The procurement pipeline:
//   PR → Quotation → (Admin | A1 | A1+) → PO → Material Received → Invoice → Payment → Completed
//
// Approval gates (Quotation → PO):
//   - Supervisor submits Quotation → routes to Admin, A1, or A1+ based on amount
//   - Admin/A1/A1+ approve → PO (generates PO number)
//   - Approver rejects → back to Quotation
//
// Post-approval stages (PO → Completed):
//   - PO → Material Received: optionally records inventory stock-in
//   - Invoice → Payment: creates vendor_payment record, updates vendor totals
//   - Payment → Completed: closes requisition
//
// Stage transition validation logic is in src/lib/stage-transitions.ts (pure, testable).

// Zod schema validating a stage transition request with optimistic concurrency check
// and optional metadata for inventory linkage, invoice, payment, and rejection details.
const updateStageSchema = z.object({
  id: z.string().uuid(),
  newStage: z.string(),
  expectedStage: z.string(),
  // Optional: inventory item + quantity for Material Received stage
  inventoryItemId: z.string().uuid().nullable().optional(),
  quantityReceived: z.number().positive().optional(),
  // Optional: delivery date for Material Received stage (ISO string)
  deliveryDate: z.string().optional(),
  // Optional: invoice details for Invoice stage
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  invoiceAmount: z.number().positive().optional(),
  // Optional: payment method + reference for Payment stage
  paymentMethod: z.enum(["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"]).optional(),
  paymentProofPath: z.string().optional(),
  paymentReference: z.string().optional(),
  // Optional: rejection reason for Reject
  rejectionReason: z.string().optional(),
  // Optional: cancel reason for Cancel
  cancelReason: z.string().optional(),
});

// Advances or rejects a requisition's stage, enforcing approval gates and role/amount rules.
// On PO approval: generates a sequential PO number.
// On Material Received: optionally records an inventory stock-in transaction.
// On Payment: creates a vendor_payment record (triggers vendor total update).
// Sends notifications on submit-for-approval, approve, and reject events.
export const updateRequisitionStage = createServerFn({ method: "POST" })
  .validator(updateStageSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: req } = await supabaseServer
      .from("requisitions")
      .select(
        "id, pr_number, po_number, amount, stage, title, quotations, vendor_id, raised_by, block",
      )
      .eq("id", data.id)
      .single();

    if (!req) {
      return { success: false, error: "Requisition not found" };
    }

    if (req.stage !== data.expectedStage) {
      return { success: false, error: "Requisition stage has changed. Please refresh." };
    }

    const amount = Number(req.amount);
    const fromStage = data.expectedStage;
    const toStage = data.newStage;

    // Validate the stage transition using the extracted pure function
    const hasSelectedQuotation = (req.quotations ?? []).some((q: any) => q.selected);
    const validation = validateStageTransition({
      fromStage,
      toStage,
      amount,
      role: user.role,
      hasSelectedQuotation,
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // --- Build the update payload ---
    const updatePayload: Record<string, any> = { stage: toStage };

    // On submit for approval: link the selected quotation's vendor_id to the requisition
    if (
      fromStage === "Quotation" &&
      (toStage === "Admin" || toStage === "A1" || toStage === "A1+")
    ) {
      const selectedQuote = (req.quotations ?? []).find((q: any) => q.selected);
      if (selectedQuote?.vendor_id && !req.vendor_id) {
        updatePayload["vendor_id"] = selectedQuote.vendor_id;
      }
    }

    // On approval to PO: generate PO number + record approver
    if (toStage === "PO" && !req.po_number) {
      const { data: poSeqResult, error: poSeqError } = await supabaseServer.rpc("next_po_number");
      if (!poSeqError && poSeqResult) {
        updatePayload["po_number"] = poSeqResult as string;
      }
      updatePayload["approved_by"] = user.id;
      updatePayload["approved_at"] = new Date().toISOString();
    }

    // On Material Received: generate GRN number + capture delivery details
    if (toStage === "Material Received") {
      const { data: grnResult } = await supabaseServer.rpc("next_grn_number");
      if (grnResult) {
        updatePayload["grn_number"] = grnResult as string;
      }
      if (data.deliveryDate) {
        updatePayload["delivery_date"] = data.deliveryDate;
      }
      if (data.quantityReceived) {
        updatePayload["quantity_received"] = data.quantityReceived;
      }
    }

    // On Invoice: capture invoice details
    if (toStage === "Invoice") {
      if (data.invoiceNumber) updatePayload["invoice_number"] = data.invoiceNumber.trim();
      if (data.invoiceDate) updatePayload["invoice_date"] = data.invoiceDate;
      if (data.invoiceAmount) updatePayload["invoice_amount"] = data.invoiceAmount;
    }

    // On reject: record rejection info
    if (
      (fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") &&
      toStage === "Quotation"
    ) {
      updatePayload["rejected_by"] = user.id;
      updatePayload["rejected_at"] = new Date().toISOString();
      if (data.rejectionReason) {
        updatePayload["rejection_reason"] = data.rejectionReason.trim();
      }
    }

    // On cancel: record cancellation info
    if (toStage === "Cancelled") {
      updatePayload["cancelled_by"] = user.id;
      updatePayload["cancelled_at"] = new Date().toISOString();
      if (data.cancelReason) {
        updatePayload["cancel_reason"] = data.cancelReason.trim();
      }
    }

    const { error } = await supabaseServer
      .from("requisitions")
      .update(updatePayload)
      .eq("id", data.id)
      .eq("stage", data.expectedStage);

    if (error) {
      return {
        success: false,
        error: "Failed to update — possibly already updated by another user",
      };
    }

    // --- Post-transition side effects ---

    // On Material Received: record inventory stock-in if item + quantity provided
    if (toStage === "Material Received" && data.inventoryItemId && data.quantityReceived) {
      const { error: invError } = await supabaseServer.from("inventory_transactions").insert({
        item_id: data.inventoryItemId,
        type: "in",
        quantity: data.quantityReceived,
        reference: req.pr_number,
        remarks: `Material received for ${req.title}${updatePayload["grn_number"] ? ` (GRN: ${updatePayload["grn_number"]})` : ""}`,
        created_by: user.id,
      });
      if (invError) {
        // Rollback the stage advance so the user can retry — prevents orphaned state.
        await supabaseServer
          .from("requisitions")
          .update({
            stage: fromStage,
            grn_number: null,
            delivery_date: null,
            quantity_received: null,
          })
          .eq("id", data.id);
        return {
          success: false,
          error:
            "Inventory stock-in failed: " +
            invError.message +
            ". Stage was not advanced — please retry.",
        };
      }
    }

    // On Payment: create a vendor_payment record if vendor is linked
    if (toStage === "Payment" && req.vendor_id) {
      const paymentMethod = data.paymentMethod ?? "Cheque";
      const proofPath = data.paymentProofPath ?? `requisitions/${req.id}/payment-proof`;

      const { error: payError } = await supabaseServer.from("vendor_payments").insert({
        vendor_id: req.vendor_id,
        amount: amount,
        payment_type: paymentMethod,
        approved_by: user.id,
        proof_path: proofPath,
        reference_number: data.paymentReference?.trim() || null,
        requisition_id: req.id,
        notes: `Payment for ${req.pr_number}${req.po_number ? ` / ${req.po_number}` : ""} — ${req.title}`,
        created_by: user.id,
      });
      if (payError) {
        // Rollback the stage advance so the user can retry — prevents orphaned state.
        await supabaseServer.from("requisitions").update({ stage: fromStage }).eq("id", data.id);
        return {
          success: false,
          error:
            "Vendor payment record failed: " +
            payError.message +
            ". Stage was not advanced — please retry.",
        };
      }
    }

    // --- Notifications ---

    // On submit for approval: notify all users with the approver role
    if (
      fromStage === "Quotation" &&
      (toStage === "Admin" || toStage === "A1" || toStage === "A1+")
    ) {
      await notifyByRole(
        toStage,
        "approval_request",
        `Approval needed: ${req.pr_number}`,
        `${req.title} · ${approverFor(amount)} approval required · ₹${amount.toLocaleString("en-IN")}`,
        { requisition_id: req.id, pr_number: req.pr_number, amount, stage: toStage },
      );
    }

    // On approve: notify the supervisor who raised the PR
    if ((fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") && toStage === "PO") {
      const poNumber = updatePayload["po_number"] ?? req.po_number ?? "";
      await notifyUser(
        req.raised_by,
        "approval_result",
        `Approved: ${req.pr_number}`,
        `${req.title} approved by ${user.name}. PO issued${poNumber ? ` as ${poNumber}` : ""}.`,
        { requisition_id: req.id, pr_number: req.pr_number, po_number: poNumber, approved: true },
      );
    }

    // On reject: notify the supervisor who raised the PR
    if (
      (fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") &&
      toStage === "Quotation"
    ) {
      await notifyUser(
        req.raised_by,
        "approval_result",
        `Rejected: ${req.pr_number}`,
        `${req.title} was sent back for rework by ${user.name}.`,
        { requisition_id: req.id, pr_number: req.pr_number, approved: false },
      );
    }

    // On PO issued: notify procurement roles via centralized dispatcher
    if (toStage === "PO") {
      const poNumber = updatePayload["po_number"] ?? req.po_number ?? "";
      await dispatchNotification({
        event: "po_issued",
        title: "PO issued",
        body: `PO ${poNumber} issued for ${req.pr_number} (${req.title}).`,
        entityType: "requisition",
        entityId: req.id,
        targetUserIds: req.raised_by ? [req.raised_by] : [],
      });
    }

    // On Material Received: notify via centralized dispatcher
    if (toStage === "Material Received") {
      await dispatchNotification({
        event: "material_received",
        title: "Material received",
        body: `Material received for ${req.pr_number} (${req.title}).`,
        entityType: "requisition",
        entityId: req.id,
        targetRoles: ["Administrator", "A1", "A1+"],
      });
    }

    await logAction(user, "update_stage", "requisition", req.id, {
      pr_number: req.pr_number,
      po_number: updatePayload["po_number"] ?? req.po_number,
      grn_number: updatePayload["grn_number"] ?? undefined,
      from: data.expectedStage,
      to: toStage,
      amount,
    });

    return {
      success: true,
      po_number: updatePayload["po_number"] ?? undefined,
      grn_number: updatePayload["grn_number"] ?? undefined,
    };
  });

// Fetches the audit history for a specific requisition — accessible to all authenticated users.
export const fetchRequisitionHistory = createServerFn({ method: "GET" })
  .validator((input: { requisitionId: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    const { data: logs } = await supabaseServer
      .from("audit_log")
      .select("id, user_id, action, details, created_at")
      .eq("entity_type", "requisition")
      .eq("entity_id", data.requisitionId)
      .order("created_at", { ascending: true });

    const userIds = [...new Set((logs ?? []).map((l: any) => l.user_id))];
    const usersResult =
      userIds.length > 0
        ? await supabaseServer.from("users").select("id, name, role").in("id", userIds)
        : { data: [] as any[] };
    const users = usersResult.data;

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u] as const));

    return (logs ?? []).map((l: any) => ({
      id: l.id,
      action: l.action,
      details: l.details,
      created_at: l.created_at,
      user_name: userMap.get(l.user_id)?.name ?? "Unknown",
      user_role: userMap.get(l.user_id)?.role ?? "Supervisor",
    }));
  });

// Fetches all vendor payments linked to a specific requisition.
export const fetchRequisitionPayments = createServerFn({ method: "GET" })
  .validator((input: { requisitionId: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    const { data: payments } = await supabaseServer
      .from("vendor_payments")
      .select(
        "id, amount, payment_type, reference_number, proof_path, notes, payment_date, created_at",
      )
      .eq("requisition_id", data.requisitionId)
      .order("payment_date", { ascending: false });

    return (payments ?? []).map((p: any) => ({
      id: p.id,
      amount: Number(p.amount),
      payment_type: p.payment_type,
      reference_number: p.reference_number ?? null,
      proof_path: p.proof_path ?? null,
      notes: p.notes ?? null,
      payment_date: p.payment_date,
    }));
  });

// Records an additional partial payment for a requisition without advancing the stage.
const addPaymentSchema = z.object({
  requisitionId: z.string().uuid(),
  vendorId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"]),
  referenceNumber: z.string().optional(),
  proofPath: z.string().optional(),
});

export const addRequisitionPayment = createServerFn({ method: "POST" })
  .validator(addPaymentSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { data: req } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, po_number, title, amount, stage")
      .eq("id", data.requisitionId)
      .single();

    if (!req) {
      return { success: false, error: "Requisition not found" };
    }

    if (req.stage !== "Payment" && req.stage !== "Invoice") {
      return { success: false, error: "Payments can only be recorded at Invoice or Payment stage" };
    }

    const { error } = await supabaseServer.from("vendor_payments").insert({
      vendor_id: data.vendorId,
      amount: data.amount,
      payment_type: data.paymentMethod,
      approved_by: user.id,
      proof_path: data.proofPath ?? `requisitions/${req.id}/payment-proof`,
      reference_number: data.referenceNumber?.trim() || null,
      requisition_id: req.id,
      notes: `Payment for ${req.pr_number}${req.po_number ? ` / ${req.po_number}` : ""} — ${req.title}`,
      created_by: user.id,
    });

    if (error) {
      return { success: false, error: "Failed to record payment: " + error.message };
    }

    await logAction(user, "add_payment", "requisition", req.id, {
      pr_number: req.pr_number,
      amount: data.amount,
      method: data.paymentMethod,
    });

    // Notify finance roles that a payment was recorded
    await dispatchNotification({
      event: "payment_recorded",
      title: "Payment recorded",
      body: `Payment of ₹${data.amount.toLocaleString("en-IN")} recorded for ${req.pr_number} (${req.title}).`,
      entityType: "requisition",
      entityId: req.id,
      targetRoles: ["Administrator", "A1", "A1+"],
    });

    return { success: true };
  });

// Fetches line items for a specific requisition.
export const fetchRequisitionItems = createServerFn({ method: "GET" })
  .validator((input: { requisitionId: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    const { data: items } = await supabaseServer
      .from("requisition_items")
      .select("id, description, quantity, unit, unit_price, amount, sort_order")
      .eq("requisition_id", data.requisitionId)
      .order("sort_order", { ascending: true });

    return (items ?? []).map((i: any) => ({
      id: i.id,
      description: i.description,
      quantity: Number(i.quantity),
      unit: i.unit ?? null,
      unit_price: i.unit_price != null ? Number(i.unit_price) : null,
      amount: Number(i.amount),
      sort_order: i.sort_order,
    }));
  });

// Saves line items for a requisition (replaces all existing items).
const saveItemsSchema = z.object({
  requisitionId: z.string().uuid(),
  items: z.array(
    z.object({
      description: z.string().min(1),
      quantity: z.number().min(0).default(0),
      unit: z.string().nullable().optional(),
      unit_price: z.number().min(0).default(0),
      amount: z.number().min(0).default(0),
    }),
  ),
});

export const saveRequisitionItems = createServerFn({ method: "POST" })
  .validator(saveItemsSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Delete existing items, then insert new ones
    await supabaseServer
      .from("requisition_items")
      .delete()
      .eq("requisition_id", data.requisitionId);

    if (data.items.length > 0) {
      const rows = data.items.map((item, i) => ({
        requisition_id: data.requisitionId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit ?? null,
        unit_price: item.unit_price,
        amount: item.amount,
        sort_order: i,
      }));

      const { error } = await supabaseServer.from("requisition_items").insert(rows);
      if (error) {
        return { success: false, error: "Failed to save line items: " + error.message };
      }

      // Update the requisition amount to the sum of line items
      const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);
      await supabaseServer
        .from("requisitions")
        .update({ amount: totalAmount })
        .eq("id", data.requisitionId);
    }

    await logAction(user, "update_items", "requisition", data.requisitionId, {
      item_count: data.items.length,
    });

    return { success: true };
  });
