import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

const PAYMENT_METHODS = ["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"] as const;

export const fetchVendors = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number; search?: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("vendors")
      .select("id, name, gst_number, address, city, state, pincode, phone, email, materials_purchased, total_amount, amount_paid, outstanding_amount, payment_method, created_at", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (data.search) {
      query = query.or(`name.ilike.%${data.search}%,gst_number.ilike.%${data.search}%`);
    }

    const { data: vendors, count } = await query;

    return { data: vendors ?? [], total: count ?? 0, page, limit };
  });

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
});

export const createVendor = createServerFn({ method: "POST" })
  .validator(vendorSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { success: false, error: "Only administrators and above can create vendors" };
    }

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
      return { success: false, error: "Failed to create vendor" };
    }

    await logAction(user, "create_vendor", "vendor", vendor.id, { name: vendor.name });
    return { success: true, id: vendor.id };
  });

export const updateVendor = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...vendorSchema.shape }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { success: false, error: "Only administrators and above can update vendors" };
    }

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

    const { error } = await supabaseServer
      .from("vendors")
      .update(updates)
      .eq("id", id);

    if (error) {
      return { success: false, error: "Failed to update vendor" };
    }

    await logAction(user, "update_vendor", "vendor", id, updates);
    return { success: true };
  });

// --- Vendor Payments ---

export const fetchVendorPayments = createServerFn({ method: "GET" })
  .validator((input: { vendorId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: payments } = await supabaseServer
      .from("vendor_payments")
      .select("id, vendor_id, amount, payment_type, approved_by, proof_path, payment_date, notes, created_by, created_at")
      .eq("vendor_id", data.vendorId)
      .order("payment_date", { ascending: false });

    const userIds = [...new Set((payments ?? []).flatMap((p: any) => [p.approved_by, p.created_by]))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    return {
      data: (payments ?? []).map((p: any) => ({
        ...p,
        approved_by_name: userMap.get(p.approved_by)?.name ?? "Unknown",
        approved_by_role: userMap.get(p.approved_by)?.role ?? "",
        created_by_name: userMap.get(p.created_by)?.name ?? "Unknown",
      })),
    };
  });

export const fetchAllVendorPayments = createServerFn({ method: "GET" })
  .validator((input: { page?: number; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { data: [], total: 0, page: 1, limit: 20 };
    }

    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    const { data: payments, count } = await supabaseServer
      .from("vendor_payments")
      .select("id, vendor_id, amount, payment_type, approved_by, proof_path, payment_date, notes, created_by, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const vendorIds = [...new Set((payments ?? []).map((p: any) => p.vendor_id))];
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);
    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    const userIds = [...new Set((payments ?? []).flatMap((p: any) => [p.approved_by, p.created_by]))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    return {
      data: (payments ?? []).map((p: any) => ({
        ...p,
        vendor_name: vendorMap.get(p.vendor_id) ?? "Unknown",
        approved_by_name: userMap.get(p.approved_by)?.name ?? "Unknown",
        approved_by_role: userMap.get(p.approved_by)?.role ?? "",
        created_by_name: userMap.get(p.created_by)?.name ?? "Unknown",
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

const paymentSchema = z.object({
  vendor_id: z.string().uuid(),
  amount: z.number().positive(),
  payment_type: z.enum(PAYMENT_METHODS),
  approved_by: z.string().uuid(),
  proof_path: z.string().min(1),
  notes: z.string().optional(),
});

export const addVendorPayment = createServerFn({ method: "POST" })
  .validator(paymentSchema)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { success: false, error: "Only administrators and above can add payments" };
    }

    // Verify the approver exists and is not a Supervisor
    const { data: approver } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .eq("id", data.approved_by)
      .single();

    if (!approver) {
      return { success: false, error: "Selected approver not found" };
    }
    if (approver.role === "Supervisor") {
      return { success: false, error: "Supervisor cannot approve payments" };
    }

    const { data: payment, error } = await supabaseServer
      .from("vendor_payments")
      .insert({
        vendor_id: data.vendor_id,
        amount: data.amount,
        payment_type: data.payment_type,
        approved_by: data.approved_by,
        proof_path: data.proof_path,
        notes: data.notes,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !payment) {
      return { success: false, error: "Failed to record payment" };
    }

    await logAction(user, "add_vendor_payment", "vendor_payment", payment.id, {
      vendor_id: data.vendor_id,
      amount: data.amount,
      payment_type: data.payment_type,
      approved_by: approver.name,
    });
    return { success: true, id: payment.id };
  });

export const fetchApprovableUsers = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .neq("role", "Supervisor")
      .order("name", { ascending: true });

    return { data: users ?? [] };
  });

// --- Material Categories ---

export const fetchMaterialCategories = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async ({ data, context }) => {
    await requireSessionUser();

    const { data: categories } = await supabaseServer
      .from("material_categories")
      .select("id, name")
      .order("name", { ascending: true });

    return { data: categories ?? [] };
  });

export const createMaterialCategory = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();

    const { data: category, error } = await supabaseServer
      .from("material_categories")
      .insert({ name: data.name.trim(), created_by: user.id })
      .select("id, name")
      .single();

    if (error || !category) {
      console.error("[createMaterialCategory] Insert failed:", error?.message, error?.code, error?.details);
      const msg = error?.code === "23505"
        ? "This category already exists"
        : error?.code === "42P01"
        ? "Material categories table does not exist — run migration 003"
        : `Failed to create category: ${error?.message ?? "Unknown error"}`;
      return { success: false, error: msg };
    }

    await logAction(user, "create_material_category", "material_category", category.id, { name: category.name });
    return { success: true, id: category.id, name: category.name };
  });
