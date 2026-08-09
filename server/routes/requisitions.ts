import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { sanitizeSearch } from "../lib/sanitize.js";
import { dispatchNotification } from "../lib/notification-system.js";
import { approverFor, inr, type Stage } from "../lib/erp-data.js";
import { validateStageTransition } from "../lib/stage-transitions.js";

export const requisitionsRouter = Router();

// Helper: send notifications to users by role
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

// Helper: send notification to a single user
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

// GET /api/requisitions/fetch — fetches paginated requisitions with filters
const fetchRequisitionsSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  stage: z.string().optional(),
  raisedBy: z.string().optional(),
  search: z.string().optional(),
});

requisitionsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchRequisitionsSchema.parse(req.query);
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

    res.json({
      data: (reqs ?? []).map((r: any) => ({
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
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchRequisitions error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch requisitions" });
  }
});

// POST /api/requisitions/create — creates a new requisition
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

requisitionsRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = createSchema.parse(req.body);

    const { data: seqResult, error: seqError } = await supabaseServer.rpc("next_pr_number");
    const prNumber =
      seqError || !seqResult ? `PR-${Date.now().toString().slice(-6)}` : (seqResult as string);

    const { data: reqRow, error } = await supabaseServer
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

    if (error || !reqRow) {
      res.json({ success: false, error: "Failed to create requisition" });
      return;
    }

    await logAction(user, "create_requisition", "requisition", reqRow.id, {
      pr_number: reqRow.pr_number,
      title: data.title,
      amount: data.amount,
    });

    await notifyByRole(
      "Administrator",
      "new_pr",
      `New PR: ${reqRow.pr_number}`,
      `${data.title} · ${data.block} · ${inr(data.amount)} · raised by ${user.name}`,
      { requisition_id: reqRow.id, pr_number: reqRow.pr_number, amount: data.amount },
    );

    res.json({ success: true, id: reqRow.id, pr_number: reqRow.pr_number });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createRequisition error:", err);
    res.status(500).json({ success: false, error: "Failed to create requisition" });
  }
});

// POST /api/requisitions/update-details — updates editable details
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

requisitionsRouter.post("/update-details", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateDetailsSchema.parse(req.body);

    const { id, ...updates } = data;
    const updatePayload: Record<string, any> = {};
    if (updates.title !== undefined) updatePayload["title"] = updates.title;
    if (updates.block !== undefined) updatePayload["block"] = updates.block;
    if (updates.vendor_id !== undefined) updatePayload["vendor_id"] = updates.vendor_id;
    if (updates.amount !== undefined) updatePayload["amount"] = updates.amount;
    if (updates.quotations !== undefined) updatePayload["quotations"] = updates.quotations;
    if (updates.documents !== undefined) updatePayload["documents"] = updates.documents;

    if (Object.keys(updatePayload).length === 0) {
      res.json({ success: false, error: "No fields to update" });
      return;
    }

    const { error } = await supabaseServer.from("requisitions").update(updatePayload).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update requisition" });
      return;
    }

    await logAction(user, "update_requisition", "requisition", id, updatePayload);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateRequisitionDetails error:", err);
    res.status(500).json({ success: false, error: "Failed to update requisition" });
  }
});

// POST /api/requisitions/update-stage — advances or rejects a requisition's stage
const updateStageSchema = z.object({
  id: z.string().uuid(),
  newStage: z.string(),
  expectedStage: z.string(),
  inventoryItemId: z.string().uuid().nullable().optional(),
  quantityReceived: z.number().positive().optional(),
  deliveryDate: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  invoiceAmount: z.number().positive().optional(),
  paymentMethod: z.enum(["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"]).optional(),
  paymentProofPath: z.string().optional(),
  paymentReference: z.string().optional(),
  rejectionReason: z.string().optional(),
  cancelReason: z.string().optional(),
});

requisitionsRouter.post("/update-stage", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateStageSchema.parse(req.body);

    const { data: reqRow } = await supabaseServer
      .from("requisitions")
      .select(
        "id, pr_number, po_number, amount, stage, title, quotations, vendor_id, raised_by, block",
      )
      .eq("id", data.id)
      .single();

    if (!reqRow) {
      res.json({ success: false, error: "Requisition not found" });
      return;
    }

    if (reqRow.stage !== data.expectedStage) {
      res.json({ success: false, error: "Requisition stage has changed. Please refresh." });
      return;
    }

    const amount = Number(reqRow.amount);
    const fromStage = data.expectedStage;
    const toStage = data.newStage;

    const hasSelectedQuotation = (reqRow.quotations ?? []).some((q: any) => q.selected);
    const validation = validateStageTransition({
      fromStage,
      toStage,
      amount,
      role: user.role,
      hasSelectedQuotation,
    });
    if (!validation.valid) {
      res.json({ success: false, error: validation.error });
      return;
    }

    const updatePayload: Record<string, any> = { stage: toStage };

    if (
      fromStage === "Quotation" &&
      (toStage === "Admin" || toStage === "A1" || toStage === "A1+")
    ) {
      const selectedQuote = (reqRow.quotations ?? []).find((q: any) => q.selected);
      if (selectedQuote?.vendor_id && !reqRow.vendor_id) {
        updatePayload["vendor_id"] = selectedQuote.vendor_id;
      }
    }

    if (toStage === "PO" && !reqRow.po_number) {
      const { data: poSeqResult, error: poSeqError } = await supabaseServer.rpc("next_po_number");
      if (!poSeqError && poSeqResult) {
        updatePayload["po_number"] = poSeqResult as string;
      }
      updatePayload["approved_by"] = user.id;
      updatePayload["approved_at"] = new Date().toISOString();
    }

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

    if (toStage === "Invoice") {
      if (data.invoiceNumber) updatePayload["invoice_number"] = data.invoiceNumber.trim();
      if (data.invoiceDate) updatePayload["invoice_date"] = data.invoiceDate;
      if (data.invoiceAmount) updatePayload["invoice_amount"] = data.invoiceAmount;
    }

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
      res.json({
        success: false,
        error: "Failed to update — possibly already updated by another user",
      });
      return;
    }

    // Post-transition side effects
    if (toStage === "Material Received" && data.inventoryItemId && data.quantityReceived) {
      const { error: invError } = await supabaseServer.from("inventory_transactions").insert({
        item_id: data.inventoryItemId,
        type: "in",
        quantity: data.quantityReceived,
        reference: reqRow.pr_number,
        remarks: `Material received for ${reqRow.title}${updatePayload["grn_number"] ? ` (GRN: ${updatePayload["grn_number"]})` : ""}`,
        created_by: user.id,
      });
      if (invError) {
        await supabaseServer
          .from("requisitions")
          .update({
            stage: fromStage,
            grn_number: null,
            delivery_date: null,
            quantity_received: null,
          })
          .eq("id", data.id);
        res.json({
          success: false,
          error:
            "Inventory stock-in failed: " +
            invError.message +
            ". Stage was not advanced — please retry.",
        });
        return;
      }
    }

    if (toStage === "Payment" && reqRow.vendor_id) {
      const paymentMethod = data.paymentMethod ?? "Cheque";
      const proofPath = data.paymentProofPath ?? `requisitions/${reqRow.id}/payment-proof`;

      const { error: payError } = await supabaseServer.from("vendor_payments").insert({
        vendor_id: reqRow.vendor_id,
        amount: amount,
        payment_type: paymentMethod,
        approved_by: user.id,
        proof_path: proofPath,
        reference_number: data.paymentReference?.trim() || null,
        requisition_id: reqRow.id,
        notes: `Payment for ${reqRow.pr_number}${reqRow.po_number ? ` / ${reqRow.po_number}` : ""} — ${reqRow.title}`,
        created_by: user.id,
      });
      if (payError) {
        await supabaseServer.from("requisitions").update({ stage: fromStage }).eq("id", data.id);
        res.json({
          success: false,
          error:
            "Vendor payment record failed: " +
            payError.message +
            ". Stage was not advanced — please retry.",
        });
        return;
      }
    }

    // Notifications
    if (
      fromStage === "Quotation" &&
      (toStage === "Admin" || toStage === "A1" || toStage === "A1+")
    ) {
      await notifyByRole(
        toStage,
        "approval_request",
        `Approval needed: ${reqRow.pr_number}`,
        `${reqRow.title} · ${approverFor(amount)} approval required · ₹${amount.toLocaleString("en-IN")}`,
        { requisition_id: reqRow.id, pr_number: reqRow.pr_number, amount, stage: toStage },
      );
    }

    if ((fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") && toStage === "PO") {
      const poNumber = updatePayload["po_number"] ?? reqRow.po_number ?? "";
      await notifyUser(
        reqRow.raised_by,
        "approval_result",
        `Approved: ${reqRow.pr_number}`,
        `${reqRow.title} approved by ${user.name}. PO issued${poNumber ? ` as ${poNumber}` : ""}.`,
        { requisition_id: reqRow.id, pr_number: reqRow.pr_number, po_number: poNumber, approved: true },
      );
    }

    if (
      (fromStage === "Admin" || fromStage === "A1" || fromStage === "A1+") &&
      toStage === "Quotation"
    ) {
      await notifyUser(
        reqRow.raised_by,
        "approval_result",
        `Rejected: ${reqRow.pr_number}`,
        `${reqRow.title} was sent back for rework by ${user.name}.`,
        { requisition_id: reqRow.id, pr_number: reqRow.pr_number, approved: false },
      );
    }

    if (toStage === "PO") {
      const poNumber = updatePayload["po_number"] ?? reqRow.po_number ?? "";
      await dispatchNotification({
        event: "po_issued",
        title: "PO issued",
        body: `PO ${poNumber} issued for ${reqRow.pr_number} (${reqRow.title}).`,
        entityType: "requisition",
        entityId: reqRow.id,
        targetUserIds: reqRow.raised_by ? [reqRow.raised_by] : [],
      });
    }

    if (toStage === "Material Received") {
      await dispatchNotification({
        event: "material_received",
        title: "Material received",
        body: `Material received for ${reqRow.pr_number} (${reqRow.title}).`,
        entityType: "requisition",
        entityId: reqRow.id,
        targetRoles: ["Administrator", "A1", "A1+"],
      });
    }

    await logAction(user, "update_stage", "requisition", reqRow.id, {
      pr_number: reqRow.pr_number,
      po_number: updatePayload["po_number"] ?? reqRow.po_number,
      grn_number: updatePayload["grn_number"] ?? undefined,
      from: data.expectedStage,
      to: toStage,
      amount,
    });

    res.json({
      success: true,
      po_number: updatePayload["po_number"] ?? undefined,
      grn_number: updatePayload["grn_number"] ?? undefined,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateRequisitionStage error:", err);
    res.status(500).json({ success: false, error: "Failed to update stage" });
  }
});

// GET /api/requisitions/history — fetches audit history for a requisition
requisitionsRouter.get("/history", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const requisitionId = z.string().uuid().parse(req.query["requisitionId"]);

    const { data: logs } = await supabaseServer
      .from("audit_log")
      .select("id, user_id, action, details, created_at")
      .eq("entity_type", "requisition")
      .eq("entity_id", requisitionId)
      .order("created_at", { ascending: true });

    const userIds = [...new Set((logs ?? []).map((l: any) => l.user_id))];
    const usersResult =
      userIds.length > 0
        ? await supabaseServer.from("users").select("id, name, role").in("id", userIds)
        : { data: [] as any[] };
    const users = usersResult.data;

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u] as const));

    res.json(
      (logs ?? []).map((l: any) => ({
        id: l.id,
        action: l.action,
        details: l.details,
        created_at: l.created_at,
        user_name: userMap.get(l.user_id)?.name ?? "Unknown",
        user_role: userMap.get(l.user_id)?.role ?? "Supervisor",
      })),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchRequisitionHistory error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
});

// GET /api/requisitions/payments — fetches vendor payments linked to a requisition
requisitionsRouter.get("/payments", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const requisitionId = z.string().uuid().parse(req.query["requisitionId"]);

    const { data: payments } = await supabaseServer
      .from("vendor_payments")
      .select(
        "id, amount, payment_type, reference_number, proof_path, notes, payment_date, created_at",
      )
      .eq("requisition_id", requisitionId)
      .order("payment_date", { ascending: false });

    res.json(
      (payments ?? []).map((p: any) => ({
        id: p.id,
        amount: Number(p.amount),
        payment_type: p.payment_type,
        reference_number: p.reference_number ?? null,
        proof_path: p.proof_path ?? null,
        notes: p.notes ?? null,
        payment_date: p.payment_date,
      })),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchRequisitionPayments error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch payments" });
  }
});

// POST /api/requisitions/add-payment — records an additional partial payment
const addPaymentSchema = z.object({
  requisitionId: z.string().uuid(),
  vendorId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"]),
  referenceNumber: z.string().optional(),
  proofPath: z.string().optional(),
});

requisitionsRouter.post("/add-payment", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = addPaymentSchema.parse(req.body);

    const { data: reqRow } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, po_number, title, amount, stage")
      .eq("id", data.requisitionId)
      .single();

    if (!reqRow) {
      res.json({ success: false, error: "Requisition not found" });
      return;
    }

    if (reqRow.stage !== "Payment" && reqRow.stage !== "Invoice") {
      res.json({
        success: false,
        error: "Payments can only be recorded at Invoice or Payment stage",
      });
      return;
    }

    const { error } = await supabaseServer.from("vendor_payments").insert({
      vendor_id: data.vendorId,
      amount: data.amount,
      payment_type: data.paymentMethod,
      approved_by: user.id,
      proof_path: data.proofPath ?? `requisitions/${reqRow.id}/payment-proof`,
      reference_number: data.referenceNumber?.trim() || null,
      requisition_id: reqRow.id,
      notes: `Payment for ${reqRow.pr_number}${reqRow.po_number ? ` / ${reqRow.po_number}` : ""} — ${reqRow.title}`,
      created_by: user.id,
    });

    if (error) {
      res.json({ success: false, error: "Failed to record payment: " + error.message });
      return;
    }

    await logAction(user, "add_payment", "requisition", reqRow.id, {
      pr_number: reqRow.pr_number,
      amount: data.amount,
      method: data.paymentMethod,
    });

    await dispatchNotification({
      event: "payment_recorded",
      title: "Payment recorded",
      body: `Payment of ₹${data.amount.toLocaleString("en-IN")} recorded for ${reqRow.pr_number} (${reqRow.title}).`,
      entityType: "requisition",
      entityId: reqRow.id,
      targetRoles: ["Administrator", "A1", "A1+"],
    });

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("addRequisitionPayment error:", err);
    res.status(500).json({ success: false, error: "Failed to record payment" });
  }
});

// GET /api/requisitions/items — fetches line items for a requisition
requisitionsRouter.get("/items", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const requisitionId = z.string().uuid().parse(req.query["requisitionId"]);

    const { data: items } = await supabaseServer
      .from("requisition_items")
      .select("id, description, quantity, unit, unit_price, amount, sort_order")
      .eq("requisition_id", requisitionId)
      .order("sort_order", { ascending: true });

    res.json(
      (items ?? []).map((i: any) => ({
        id: i.id,
        description: i.description,
        quantity: Number(i.quantity),
        unit: i.unit ?? null,
        unit_price: i.unit_price != null ? Number(i.unit_price) : null,
        amount: Number(i.amount),
        sort_order: i.sort_order,
      })),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchRequisitionItems error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch items" });
  }
});

// POST /api/requisitions/save-items — saves line items for a requisition
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

requisitionsRouter.post("/save-items", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = saveItemsSchema.parse(req.body);

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
        res.json({ success: false, error: "Failed to save line items: " + error.message });
        return;
      }

      const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);
      await supabaseServer
        .from("requisitions")
        .update({ amount: totalAmount })
        .eq("id", data.requisitionId);
    }

    await logAction(user, "update_items", "requisition", data.requisitionId, {
      item_count: data.items.length,
    });

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("saveRequisitionItems error:", err);
    res.status(500).json({ success: false, error: "Failed to save items" });
  }
});
