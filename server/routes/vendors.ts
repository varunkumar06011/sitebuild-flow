import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { sanitizeSearch } from "../lib/sanitize.js";

export const vendorsRouter = Router();

const PAYMENT_METHODS = ["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"] as const;

// GET /api/vendors/fetch — fetches a paginated list of vendors with optional name/GST search.
const fetchVendorsSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  search: z.string().optional(),
  workCategory: z.string().optional(),
});

vendorsRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchVendorsSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("vendors")
      .select(
        "id, name, gst_number, address, city, state, pincode, phone, email, materials_purchased, total_amount, amount_paid, outstanding_amount, payment_method, work_category, created_at",
        { count: "exact" },
      )
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (data.search) {
      const s = sanitizeSearch(data.search);
      if (s) {
        query = query.or(`name.ilike.%${s}%,gst_number.ilike.%${s}%`);
      }
    }

    if (data.workCategory && data.workCategory !== "all") {
      query = query.eq("work_category", data.workCategory);
    }

    const { data: vendors, count } = await query;

    res.json({ data: vendors ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchVendors error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch vendors" });
  }
});

// POST /api/vendors/create — creates a new vendor (admin and above only).
const vendorSchema = z.object({
  name: z.string().min(1),
  gst_number: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  materials_purchased: z.string().optional(),
  total_amount: z.number().min(0).optional(),
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  work_category: z.string().optional(),
});

vendorsRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators and above can create vendors" });
      return;
    }

    const data = vendorSchema.parse(req.body);
    const total = data.total_amount ?? 0;
    const insertData = {
      ...data,
      total_amount: total,
      amount_paid: 0,
      outstanding_amount: total,
    };

    const { data: vendor, error } = await supabaseServer
      .from("vendors")
      .insert(insertData)
      .select("id, name")
      .single();

    if (error || !vendor) {
      res.json({ success: false, error: "Failed to create vendor" });
      return;
    }

    await logAction(user, "create_vendor", "vendor", vendor.id, { name: vendor.name });
    res.json({ success: true, id: vendor.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createVendor error:", err);
    res.status(500).json({ success: false, error: "Failed to create vendor" });
  }
});

// POST /api/vendors/update — updates vendor fields (admin and above only).
const updateVendorSchema = z.object({
  id: z.string().uuid(),
  ...vendorSchema.shape,
});

vendorsRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators and above can update vendors" });
      return;
    }

    const data = updateVendorSchema.parse(req.body);
    const { id, ...updates } = data;

    // If total_amount is being updated, recalculate outstanding
    if (updates.total_amount !== undefined) {
      const { data: current } = await supabaseServer
        .from("vendors")
        .select("amount_paid")
        .eq("id", id)
        .single();
      const paid = current?.amount_paid ?? 0;
      (updates as any).outstanding_amount = Math.max(updates.total_amount - paid, 0);
    }

    const { error } = await supabaseServer.from("vendors").update(updates).eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to update vendor" });
      return;
    }

    await logAction(user, "update_vendor", "vendor", id, updates);
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
    console.error("updateVendor error:", err);
    res.status(500).json({ success: false, error: "Failed to update vendor" });
  }
});

// GET /api/vendors/payments — fetches all payments for a single vendor.
vendorsRouter.get("/payments", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const vendorId = z.string().uuid().parse(req.query["vendorId"]);

    const { data: payments } = await supabaseServer
      .from("vendor_payments")
      .select(
        "id, vendor_id, amount, payment_type, approved_by, proof_path, payment_date, notes, reference_number, status, updated_by, updated_at, created_by, created_at",
      )
      .eq("vendor_id", vendorId)
      .order("payment_date", { ascending: false });

    const userIds = [
      ...new Set(
        (payments ?? []).flatMap((p: any) =>
          [p.approved_by, p.created_by, p.updated_by].filter(Boolean),
        ),
      ),
    ];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    res.json({
      data: (payments ?? []).map((p: any) => ({
        ...p,
        approved_by_name: userMap.get(p.approved_by)?.name ?? "Unknown",
        approved_by_role: userMap.get(p.approved_by)?.role ?? "",
        created_by_name: userMap.get(p.created_by)?.name ?? "Unknown",
        updated_by_name: p.updated_by ? (userMap.get(p.updated_by)?.name ?? "Unknown") : null,
      })),
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
    console.error("fetchVendorPayments error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch payments" });
  }
});

// GET /api/vendors/payments/all — fetches all vendor payments (admin and above only).
vendorsRouter.get("/payments/all", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ data: [], total: 0, page: 1, limit: 20 });
      return;
    }

    const page = parseInt(req.query["page"] as string, 10) || 1;
    const limit = parseInt(req.query["limit"] as string, 10) || 50;
    const offset = (page - 1) * limit;

    const { data: payments, count } = await supabaseServer
      .from("vendor_payments")
      .select(
        "id, vendor_id, amount, payment_type, approved_by, proof_path, payment_date, notes, reference_number, status, updated_by, updated_at, created_by, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const vendorIds = [...new Set((payments ?? []).map((p: any) => p.vendor_id))];
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);
    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    const userIds = [
      ...new Set(
        (payments ?? []).flatMap((p: any) =>
          [p.approved_by, p.created_by, p.updated_by].filter(Boolean),
        ),
      ),
    ];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    res.json({
      data: (payments ?? []).map((p: any) => ({
        ...p,
        vendor_name: vendorMap.get(p.vendor_id) ?? "Unknown",
        approved_by_name: userMap.get(p.approved_by)?.name ?? "Unknown",
        approved_by_role: userMap.get(p.approved_by)?.role ?? "",
        created_by_name: userMap.get(p.created_by)?.name ?? "Unknown",
        updated_by_name: p.updated_by ? (userMap.get(p.updated_by)?.name ?? "Unknown") : null,
      })),
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchAllVendorPayments error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch payments" });
  }
});

// POST /api/vendors/payments/add — records a vendor payment (admin and above only).
const paymentSchema = z.object({
  vendor_id: z.string().uuid(),
  amount: z.number().positive(),
  payment_type: z.enum(PAYMENT_METHODS),
  approved_by: z.string().uuid(),
  proof_path: z.string().min(1),
  payment_date: z.string().optional(),
  reference_number: z.string().optional(),
  status: z.enum(["pending", "paid"]).optional(),
  notes: z.string().optional(),
});

vendorsRouter.post("/payments/add", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators and above can add payments" });
      return;
    }

    const data = paymentSchema.parse(req.body);

    // Verify the approver exists and is not a Supervisor
    const { data: approver } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .eq("id", data.approved_by)
      .single();

    if (!approver) {
      res.json({ success: false, error: "Selected approver not found" });
      return;
    }
    if (approver.role === "Supervisor") {
      res.json({ success: false, error: "Supervisor cannot approve payments" });
      return;
    }

    const { data: payment, error } = await supabaseServer
      .from("vendor_payments")
      .insert({
        vendor_id: data.vendor_id,
        amount: data.amount,
        payment_type: data.payment_type,
        approved_by: data.approved_by,
        proof_path: data.proof_path,
        payment_date: data.payment_date || null,
        reference_number: data.reference_number?.trim() || null,
        status: data.status ?? "paid",
        notes: data.notes,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !payment) {
      res.json({ success: false, error: "Failed to record payment" });
      return;
    }

    await logAction(user, "add_vendor_payment", "vendor_payment", payment.id, {
      vendor_id: data.vendor_id,
      amount: data.amount,
      payment_type: data.payment_type,
      approved_by: approver.name,
      reference_number: data.reference_number,
      status: data.status ?? "paid",
    });
    res.json({ success: true, id: payment.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("addVendorPayment error:", err);
    res.status(500).json({ success: false, error: "Failed to record payment" });
  }
});

// POST /api/vendors/payments/update — updates a vendor payment (admin and above only).
const updatePaymentSchema = z.object({
  payment_id: z.string().uuid(),
  amount: z.number().positive().optional(),
  payment_type: z.enum(PAYMENT_METHODS).optional(),
  approved_by: z.string().uuid().optional(),
  proof_path: z.string().optional(),
  payment_date: z.string().optional(),
  reference_number: z.string().optional(),
  status: z.enum(["pending", "paid"]).optional(),
  notes: z.string().optional(),
});

vendorsRouter.post("/payments/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators and above can update payments" });
      return;
    }

    const data = updatePaymentSchema.parse(req.body);

    // Fetch current payment to compare
    const { data: current } = await supabaseServer
      .from("vendor_payments")
      .select(
        "id, vendor_id, amount, status, proof_path, reference_number, payment_type, approved_by, notes, payment_date",
      )
      .eq("id", data.payment_id)
      .single();

    if (!current) {
      res.json({ success: false, error: "Payment not found" });
      return;
    }

    const amountChanged = data.amount !== undefined && data.amount !== current.amount;
    const statusChanged = data.status !== undefined && data.status !== current.status;
    const proofChanged = data.proof_path !== undefined && data.proof_path !== current.proof_path;

    // Backend enforcement: if amount or status changed, a new proof is required
    if ((amountChanged || statusChanged) && !proofChanged) {
      res.json({
        success: false,
        error:
          "A new payment proof screenshot is required when changing the amount or status. Please upload a new proof.",
      });
      return;
    }

    // Build update object
    const updates: any = { updated_by: user.id };
    if (data.amount !== undefined) updates.amount = data.amount;
    if (data.payment_type !== undefined) updates.payment_type = data.payment_type;
    if (data.approved_by !== undefined) updates.approved_by = data.approved_by;
    if (data.proof_path !== undefined) updates.proof_path = data.proof_path;
    if (data.payment_date !== undefined) updates.payment_date = data.payment_date;
    if (data.reference_number !== undefined)
      updates.reference_number = data.reference_number?.trim() || null;
    if (data.status !== undefined) updates.status = data.status;
    if (data.notes !== undefined) updates.notes = data.notes;

    // Insert audit record BEFORE updating (preserve old values)
    const auditReason = [
      amountChanged ? "amount changed" : null,
      statusChanged ? "status changed" : null,
      proofChanged ? "proof replaced" : null,
    ]
      .filter(Boolean)
      .join(", ");

    await supabaseServer.from("vendor_payment_audit").insert({
      payment_id: data.payment_id,
      old_amount: current.amount,
      new_amount: data.amount ?? current.amount,
      old_status: current.status,
      new_status: data.status ?? current.status,
      old_proof_path: current.proof_path,
      new_proof_path: data.proof_path ?? current.proof_path,
      old_reference_number: current.reference_number,
      new_reference_number: data.reference_number ?? current.reference_number,
      changed_by: user.id,
      reason: auditReason || "field update",
    });

    const { error } = await supabaseServer
      .from("vendor_payments")
      .update(updates)
      .eq("id", data.payment_id);

    if (error) {
      res.json({ success: false, error: "Failed to update payment" });
      return;
    }

    await logAction(user, "update_vendor_payment", "vendor_payment", data.payment_id, {
      vendor_id: current.vendor_id,
      amount_changed: amountChanged,
      status_changed: statusChanged,
      proof_changed: proofChanged,
      reason: auditReason,
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
    console.error("updateVendorPayment error:", err);
    res.status(500).json({ success: false, error: "Failed to update payment" });
  }
});

// GET /api/vendors/payments/audit — fetches payment audit trail (admin and above only).
vendorsRouter.get("/payments/audit", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ data: [] });
      return;
    }

    const paymentId = z.string().uuid().parse(req.query["paymentId"]);

    const { data: auditRecords } = await supabaseServer
      .from("vendor_payment_audit")
      .select(
        "id, payment_id, old_amount, new_amount, old_status, new_status, old_proof_path, new_proof_path, old_reference_number, new_reference_number, changed_by, changed_at, reason",
      )
      .eq("payment_id", paymentId)
      .order("changed_at", { ascending: false });

    const userIds = [...new Set((auditRecords ?? []).map((a: any) => a.changed_by))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    res.json({
      data: (auditRecords ?? []).map((a: any) => ({
        ...a,
        changed_by_name: userMap.get(a.changed_by)?.name ?? "Unknown",
        changed_by_role: userMap.get(a.changed_by)?.role ?? "",
      })),
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
    console.error("fetchPaymentAuditTrail error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch audit trail" });
  }
});

// GET /api/vendors/approvable-users — fetches all non-Supervisor users eligible to approve payments.
vendorsRouter.get("/approvable-users", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .neq("role", "Supervisor")
      .order("name", { ascending: true });

    res.json({ data: users ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchApprovableUsers error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch users" });
  }
});

// GET /api/vendors/material-categories — fetches all material categories.
vendorsRouter.get("/material-categories", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: categories } = await supabaseServer
      .from("material_categories")
      .select("id, name")
      .order("name", { ascending: true });

    res.json({ data: categories ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchMaterialCategories error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch categories" });
  }
});

// POST /api/vendors/material-categories/create — creates a new material category.
vendorsRouter.post("/material-categories/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = z.object({ name: z.string().min(1) }).parse(req.body);

    const { data: category, error } = await supabaseServer
      .from("material_categories")
      .insert({ name: data.name.trim(), created_by: user.id })
      .select("id, name")
      .single();

    if (error || !category) {
      console.error(
        "[createMaterialCategory] Insert failed:",
        error?.message,
        error?.code,
        error?.details,
      );
      const msg =
        error?.code === "23505"
          ? "This category already exists"
          : error?.code === "42P01"
            ? "Material categories table does not exist — run migration 003"
            : `Failed to create category: ${error?.message ?? "Unknown error"}`;
      res.json({ success: false, error: msg });
      return;
    }

    await logAction(user, "create_material_category", "material_category", category.id, {
      name: category.name,
    });
    res.json({ success: true, id: category.id, name: category.name });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createMaterialCategory error:", err);
    res.status(500).json({ success: false, error: "Failed to create category" });
  }
});
