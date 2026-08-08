import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export type PartsOrderStatus =
  "Draft" | "Sent" | "Approved" | "Ordered" | "Partially Received" | "Received" | "Cancelled";
export type PartsOrderType =
  "Stock Order" | "Project Requirement" | "Emergency Requirement" | "Replacement" | "Other";

export type PartsOrderRow = {
  id: string;
  order_number: string;
  order_date: string;
  status: PartsOrderStatus;
  order_type: PartsOrderType;
  block_id: string | null;
  project_name: string | null;
  site_address: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_address: string | null;
  vendor_gst: string | null;
  requested_delivery_date: string | null;
  delivery_address: string | null;
  delivery_contact: string | null;
  delivery_phone: string | null;
  shipping_method: string | null;
  shipping_account: string | null;
  requested_by: string;
  requested_by_name: string | null;
  department: string | null;
  comments: string | null;
  work_category: string;
  pdf_path: string | null;
  items: PartsOrderItemRow[];
  created_at: string;
  updated_at: string;
};

export type PartsOrderItemRow = {
  id: string;
  item_id: string | null;
  item_name: string;
  part_number: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  required_date: string | null;
  sort_order: number;
};

// ---------------------------------------------------------------------------
// Fetch list (paginated, filterable)
// ---------------------------------------------------------------------------
export const fetchPartsOrders = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page?: number;
      limit?: number;
      status?: string;
      vendorId?: string;
      search?: string;
      workCategory?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("parts_orders")
      .select(
        "id, order_number, order_date, status, order_type, block_id, project_name, site_address, vendor_id, vendor_name, vendor_phone, vendor_email, vendor_address, vendor_gst, requested_delivery_date, delivery_address, delivery_contact, delivery_phone, shipping_method, shipping_account, requested_by, requested_by_name, department, comments, work_category, pdf_path, created_at, updated_at",
        { count: "exact" },
      )
      .order("order_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.vendorId) query = query.eq("vendor_id", data.vendorId);
    if (data.workCategory && data.workCategory !== "all")
      query = query.eq("work_category", data.workCategory);
    if (data.search) {
      query = query.or(
        `order_number.ilike.%${data.search}%,project_name.ilike.%${data.search}%,vendor_name.ilike.%${data.search}%`,
      );
    }

    const { data: orders, count } = await query;
    const orderIds = (orders ?? []).map((o: any) => o.id);

    let itemsMap = new Map<string, PartsOrderItemRow[]>();
    if (orderIds.length > 0) {
      const { data: items } = await supabaseServer
        .from("parts_order_items")
        .select(
          "id, parts_order_id, item_id, item_name, part_number, description, quantity, unit, required_date, sort_order",
        )
        .in("parts_order_id", orderIds)
        .order("sort_order", { ascending: true });
      for (const it of items ?? []) {
        const arr = itemsMap.get(it.parts_order_id) ?? [];
        arr.push({
          id: it.id,
          item_id: it.item_id,
          item_name: it.item_name,
          part_number: it.part_number ?? null,
          description: it.description ?? null,
          quantity: Number(it.quantity),
          unit: it.unit ?? null,
          required_date: it.required_date ?? null,
          sort_order: it.sort_order ?? 0,
        });
        itemsMap.set(it.parts_order_id, arr);
      }
    }

    return {
      data: (orders ?? []).map((o: any): PartsOrderRow => ({
        id: o.id,
        order_number: o.order_number,
        order_date: o.order_date,
        status: o.status as PartsOrderStatus,
        order_type: o.order_type as PartsOrderType,
        block_id: o.block_id ?? null,
        project_name: o.project_name ?? null,
        site_address: o.site_address ?? null,
        vendor_id: o.vendor_id ?? null,
        vendor_name: o.vendor_name ?? null,
        vendor_phone: o.vendor_phone ?? null,
        vendor_email: o.vendor_email ?? null,
        vendor_address: o.vendor_address ?? null,
        vendor_gst: o.vendor_gst ?? null,
        requested_delivery_date: o.requested_delivery_date ?? null,
        delivery_address: o.delivery_address ?? null,
        delivery_contact: o.delivery_contact ?? null,
        delivery_phone: o.delivery_phone ?? null,
        shipping_method: o.shipping_method ?? null,
        shipping_account: o.shipping_account ?? null,
        requested_by: o.requested_by,
        requested_by_name: o.requested_by_name ?? null,
        department: o.department ?? null,
        comments: o.comments ?? null,
        work_category: o.work_category ?? "uncategorized",
        pdf_path: o.pdf_path ?? null,
        items: itemsMap.get(o.id) ?? [],
        created_at: o.created_at,
        updated_at: o.updated_at,
      })),
      total: count ?? 0,
      page,
      limit,
    };
  });

// ---------------------------------------------------------------------------
// Fetch single by id
// ---------------------------------------------------------------------------
export const fetchPartsOrder = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    const { data: order, error } = await supabaseServer
      .from("parts_orders")
      .select("*")
      .eq("id", data.id)
      .single();

    if (error || !order) {
      return { success: false, error: "Parts order not found" };
    }

    const { data: items } = await supabaseServer
      .from("parts_order_items")
      .select("*")
      .eq("parts_order_id", data.id)
      .order("sort_order", { ascending: true });

    return {
      success: true,
      data: {
        ...order,
        items: (items ?? []).map((it: any) => ({
          ...it,
          quantity: Number(it.quantity),
        })),
      },
    };
  });

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
const partsOrderItemSchema = z.object({
  item_id: z.string().uuid().nullable().optional(),
  item_name: z.string().min(1),
  part_number: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  required_date: z.string().optional().nullable(),
});

const createPartsOrderSchema = z.object({
  block_id: z.string().uuid().nullable().optional(),
  project_name: z.string().optional(),
  site_address: z.string().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  order_type: z
    .enum(["Stock Order", "Project Requirement", "Emergency Requirement", "Replacement", "Other"])
    .optional(),
  requested_delivery_date: z.string().optional().nullable(),
  delivery_address: z.string().optional(),
  delivery_contact: z.string().optional(),
  delivery_phone: z.string().optional(),
  shipping_method: z.string().optional(),
  shipping_account: z.string().optional(),
  department: z.string().optional(),
  comments: z.string().optional(),
  work_category: z.string().optional(),
  items: z.array(partsOrderItemSchema).min(1, "At least one item is required"),
});

export const createPartsOrder = createServerFn({ method: "POST" })
  .validator(createPartsOrderSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can create parts orders" };
    }

    // Generate order number via RPC
    const { data: orderNumber, error: seqErr } =
      await supabaseServer.rpc("next_parts_order_number");

    if (seqErr || !orderNumber) {
      return { success: false, error: "Failed to generate order number" };
    }

    // Fetch vendor snapshot if vendor_id provided
    let vendorSnapshot: any = {};
    if (data.vendor_id) {
      const { data: vendor } = await supabaseServer
        .from("vendors")
        .select("name, phone, email, address, gst_number")
        .eq("id", data.vendor_id)
        .single();
      if (vendor) {
        vendorSnapshot = {
          vendor_name: vendor.name,
          vendor_phone: vendor.phone,
          vendor_email: vendor.email,
          vendor_address: vendor.address,
          vendor_gst: vendor.gst_number,
        };
      }
    }

    // Fetch block name as project_name if block_id provided and project_name not set
    let projectName = data.project_name ?? null;
    let siteAddress = data.site_address ?? null;
    if (data.block_id) {
      const { data: block } = await supabaseServer
        .from("progress_blocks")
        .select("name")
        .eq("id", data.block_id)
        .single();
      if (block && !projectName) projectName = block.name;
    }

    const insertData: any = {
      order_number: orderNumber,
      status: "Draft",
      order_type: data.order_type ?? "Project Requirement",
      block_id: data.block_id ?? null,
      project_name: projectName,
      site_address: siteAddress,
      vendor_id: data.vendor_id ?? null,
      ...vendorSnapshot,
      requested_delivery_date: data.requested_delivery_date ?? null,
      delivery_address: data.delivery_address ?? null,
      delivery_contact: data.delivery_contact ?? null,
      delivery_phone: data.delivery_phone ?? null,
      shipping_method: data.shipping_method ?? null,
      shipping_account: data.shipping_account ?? null,
      requested_by: user.id,
      requested_by_name: user.name,
      department: data.department ?? null,
      comments: data.comments ?? null,
      work_category: data.work_category ?? "uncategorized",
    };

    const { data: order, error } = await supabaseServer
      .from("parts_orders")
      .insert(insertData)
      .select("id, order_number")
      .single();

    if (error || !order) {
      return {
        success: false,
        error: `Failed to create parts order: ${error?.message ?? "Unknown error"}`,
      };
    }

    // Insert items
    const itemRows = data.items.map((it, idx) => ({
      parts_order_id: order.id,
      item_id: it.item_id ?? null,
      item_name: it.item_name,
      part_number: it.part_number ?? null,
      description: it.description ?? null,
      quantity: it.quantity,
      unit: it.unit ?? null,
      required_date: it.required_date ?? null,
      sort_order: idx,
    }));

    const { error: itemsErr } = await supabaseServer.from("parts_order_items").insert(itemRows);

    if (itemsErr) {
      return { success: false, error: `Order created but items failed: ${itemsErr.message}` };
    }

    await logAction(user, "create_parts_order", "parts_order", order.id, {
      order_number: order.order_number,
      vendor: vendorSnapshot.vendor_name ?? null,
      item_count: data.items.length,
    });

    return { success: true, id: order.id, order_number: order.order_number };
  });

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
const updatePartsOrderSchema = z.object({
  id: z.string().uuid(),
  block_id: z.string().uuid().nullable().optional(),
  project_name: z.string().optional(),
  site_address: z.string().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  order_type: z
    .enum(["Stock Order", "Project Requirement", "Emergency Requirement", "Replacement", "Other"])
    .optional(),
  requested_delivery_date: z.string().optional().nullable(),
  delivery_address: z.string().optional(),
  delivery_contact: z.string().optional(),
  delivery_phone: z.string().optional(),
  shipping_method: z.string().optional(),
  shipping_account: z.string().optional(),
  department: z.string().optional(),
  comments: z.string().optional(),
  work_category: z.string().optional(),
  items: z.array(partsOrderItemSchema).min(1).optional(),
});

export const updatePartsOrder = createServerFn({ method: "POST" })
  .validator(updatePartsOrderSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can edit parts orders" };
    }

    // Check it's not Received or Cancelled
    const { data: existing } = await supabaseServer
      .from("parts_orders")
      .select("status, order_number")
      .eq("id", data.id)
      .single();

    if (!existing) {
      return { success: false, error: "Parts order not found" };
    }
    if (existing.status === "Received" || existing.status === "Cancelled") {
      return { success: false, error: `Cannot edit a ${existing.status} order` };
    }

    // Fetch vendor snapshot if vendor_id changed
    let vendorSnapshot: any = {};
    if (data.vendor_id) {
      const { data: vendor } = await supabaseServer
        .from("vendors")
        .select("name, phone, email, address, gst_number")
        .eq("id", data.vendor_id)
        .single();
      if (vendor) {
        vendorSnapshot = {
          vendor_name: vendor.name,
          vendor_phone: vendor.phone,
          vendor_email: vendor.email,
          vendor_address: vendor.address,
          vendor_gst: vendor.gst_number,
        };
      }
    }

    const updateData: any = {
      block_id: data.block_id ?? null,
      project_name: data.project_name,
      site_address: data.site_address,
      vendor_id: data.vendor_id ?? null,
      ...vendorSnapshot,
      order_type: data.order_type,
      requested_delivery_date: data.requested_delivery_date ?? null,
      delivery_address: data.delivery_address,
      delivery_contact: data.delivery_contact,
      delivery_phone: data.delivery_phone,
      shipping_method: data.shipping_method,
      shipping_account: data.shipping_account,
      department: data.department,
      comments: data.comments,
      work_category: data.work_category,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseServer
      .from("parts_orders")
      .update(updateData)
      .eq("id", data.id);

    if (error) {
      return { success: false, error: `Failed to update: ${error.message}` };
    }

    // Replace items if provided
    if (data.items) {
      await supabaseServer.from("parts_order_items").delete().eq("parts_order_id", data.id);
      const itemRows = data.items.map((it, idx) => ({
        parts_order_id: data.id,
        item_id: it.item_id ?? null,
        item_name: it.item_name,
        part_number: it.part_number ?? null,
        description: it.description ?? null,
        quantity: it.quantity,
        unit: it.unit ?? null,
        required_date: it.required_date ?? null,
        sort_order: idx,
      }));
      const { error: itemsErr } = await supabaseServer.from("parts_order_items").insert(itemRows);
      if (itemsErr) {
        return { success: false, error: `Order updated but items failed: ${itemsErr.message}` };
      }
    }

    await logAction(user, "update_parts_order", "parts_order", data.id, {});
    return { success: true, id: data.id, order_number: existing.order_number };
  });

// ---------------------------------------------------------------------------
// Change status
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    "Draft",
    "Sent",
    "Approved",
    "Ordered",
    "Partially Received",
    "Received",
    "Cancelled",
  ]),
});

export const updatePartsOrderStatus = createServerFn({ method: "POST" })
  .validator(statusSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can change order status" };
    }

    const { data: existing } = await supabaseServer
      .from("parts_orders")
      .select("status, order_number")
      .eq("id", data.id)
      .single();

    if (!existing) {
      return { success: false, error: "Parts order not found" };
    }

    const { error } = await supabaseServer
      .from("parts_orders")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);

    if (error) {
      return { success: false, error: `Failed to update status: ${error.message}` };
    }

    await logAction(user, "change_parts_order_status", "parts_order", data.id, {
      from: existing.status,
      to: data.status,
      order_number: existing.order_number,
    });

    return { success: true };
  });

// ---------------------------------------------------------------------------
// Duplicate (creates new order with new number)
// ---------------------------------------------------------------------------
export const duplicatePartsOrder = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can duplicate orders" };
    }

    const { data: original, error } = await supabaseServer
      .from("parts_orders")
      .select("*")
      .eq("id", data.id)
      .single();

    if (error || !original) {
      return { success: false, error: "Original order not found" };
    }

    const { data: orderNumber } = await supabaseServer.rpc("next_parts_order_number");
    if (!orderNumber) return { success: false, error: "Failed to generate order number" };

    const {
      id: _id,
      order_number: _on,
      created_at: _ca,
      updated_at: _ua,
      pdf_path: _pp,
      ...rest
    } = original;
    const newOrder: any = {
      ...rest,
      order_number: orderNumber,
      status: "Draft",
      pdf_path: null,
      requested_by: user.id,
      requested_by_name: user.name,
    };

    const { data: newRec, error: insErr } = await supabaseServer
      .from("parts_orders")
      .insert(newOrder)
      .select("id, order_number")
      .single();

    if (insErr || !newRec) {
      return { success: false, error: `Failed to duplicate: ${insErr?.message}` };
    }

    // Copy items
    const { data: items } = await supabaseServer
      .from("parts_order_items")
      .select("*")
      .eq("parts_order_id", data.id)
      .order("sort_order", { ascending: true });

    if (items && items.length > 0) {
      const itemRows = items.map((it: any) => ({
        parts_order_id: newRec.id,
        item_id: it.item_id,
        item_name: it.item_name,
        part_number: it.part_number,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        required_date: it.required_date,
        sort_order: it.sort_order,
      }));
      await supabaseServer.from("parts_order_items").insert(itemRows);
    }

    await logAction(user, "duplicate_parts_order", "parts_order", newRec.id, {
      original_number: original.order_number,
      new_number: newRec.order_number,
    });

    return { success: true, id: newRec.id, order_number: newRec.order_number };
  });

// ---------------------------------------------------------------------------
// Generate WhatsApp message text
// ---------------------------------------------------------------------------
export function buildPartsOrderWhatsAppMessage(order: PartsOrderRow): string {
  const lines: string[] = [];
  lines.push(`Parts Order – ${order.order_number}`);
  lines.push("");
  lines.push(`Project: ${order.project_name ?? "—"}`);
  lines.push(`Site: ${order.site_address ?? "—"}`);
  lines.push(`Vendor: ${order.vendor_name ?? "—"}`);
  lines.push("");
  lines.push("Items:");
  order.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.item_name} — ${it.quantity} ${it.unit ?? ""}`);
  });
  lines.push("");
  if (order.requested_delivery_date) {
    lines.push(`Required Date: ${order.requested_delivery_date}`);
  }
  lines.push("Please refer to the generated Parts Order for complete details.");
  return lines.join("\n");
}
