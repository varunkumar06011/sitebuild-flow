import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { sanitizeSearch } from "../lib/sanitize.js";
import type { Role } from "../lib/erp-data.js";

export const partsOrdersRouter = Router();

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

function handleErr(res: Response, err: unknown, label: string) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: "Invalid input" });
    return;
  }
  if (err instanceof Error && err.message.startsWith("Unauthorized")) {
    res.status(401).json({ success: false, error: err.message });
    return;
  }
  console.error(`${label} error:`, err);
  res.status(500).json({ success: false, error: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Fetch list (paginated, filterable)
// ---------------------------------------------------------------------------

// GET /api/parts-orders
const fetchPartsOrdersSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.string().optional(),
  vendorId: z.string().optional(),
  search: z.string().optional(),
  workCategory: z.string().optional(),
});

partsOrdersRouter.get("/", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchPartsOrdersSchema.parse(req.query);
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
      const s = sanitizeSearch(data.search);
      if (s) {
        query = query.or(
          `order_number.ilike.%${s}%,project_name.ilike.%${s}%,vendor_name.ilike.%${s}%`,
        );
      }
    }

    const { data: orders, count } = await query;
    const orderIds = (orders ?? []).map((o: any) => o.id);

    const itemsMap = new Map<string, any[]>();
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

    res.json({
      data: (orders ?? []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        order_date: o.order_date,
        status: o.status,
        order_type: o.order_type,
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
    });
  } catch (err) {
    handleErr(res, err, "fetchPartsOrders");
  }
});

// GET /api/parts-orders/:id
partsOrdersRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const id = z.string().uuid().parse(req.params["id"]);

    const { data: order, error } = await supabaseServer
      .from("parts_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !order) {
      res.json({ success: false, error: "Parts order not found" });
      return;
    }

    const { data: items } = await supabaseServer
      .from("parts_order_items")
      .select("*")
      .eq("parts_order_id", id)
      .order("sort_order", { ascending: true });

    res.json({
      success: true,
      data: {
        ...order,
        items: (items ?? []).map((it: any) => ({
          ...it,
          quantity: Number(it.quantity),
        })),
      },
    });
  } catch (err) {
    handleErr(res, err, "fetchPartsOrder");
  }
});

// POST /api/parts-orders/create
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

partsOrdersRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can create parts orders" });
      return;
    }
    const data = createPartsOrderSchema.parse(req.body);

    const { data: orderNumber, error: seqErr } =
      await supabaseServer.rpc("next_parts_order_number");

    if (seqErr || !orderNumber) {
      res.json({ success: false, error: "Failed to generate order number" });
      return;
    }

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

    let projectName = data.project_name ?? null;
    const siteAddress = data.site_address ?? null;
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
      res.json({
        success: false,
        error: `Failed to create parts order: ${error?.message ?? "Unknown error"}`,
      });
      return;
    }

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
      res.json({ success: false, error: `Order created but items failed: ${itemsErr.message}` });
      return;
    }

    await logAction(user, "create_parts_order", "parts_order", order.id, {
      order_number: order.order_number,
      vendor: vendorSnapshot.vendor_name ?? null,
      item_count: data.items.length,
    });

    res.json({ success: true, id: order.id, order_number: order.order_number });
  } catch (err) {
    handleErr(res, err, "createPartsOrder");
  }
});

// POST /api/parts-orders/update
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

partsOrdersRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can edit parts orders" });
      return;
    }
    const data = updatePartsOrderSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("parts_orders")
      .select("status, order_number")
      .eq("id", data.id)
      .single();

    if (!existing) {
      res.json({ success: false, error: "Parts order not found" });
      return;
    }
    if (existing.status === "Received" || existing.status === "Cancelled") {
      res.json({ success: false, error: `Cannot edit a ${existing.status} order` });
      return;
    }

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
      res.json({ success: false, error: `Failed to update: ${error.message}` });
      return;
    }

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
        res.json({ success: false, error: `Order updated but items failed: ${itemsErr.message}` });
        return;
      }
    }

    await logAction(user, "update_parts_order", "parts_order", data.id, {});
    res.json({ success: true, id: data.id, order_number: existing.order_number });
  } catch (err) {
    handleErr(res, err, "updatePartsOrder");
  }
});

// POST /api/parts-orders/status
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

partsOrdersRouter.post("/status", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can change order status" });
      return;
    }
    const data = statusSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("parts_orders")
      .select("status, order_number")
      .eq("id", data.id)
      .single();

    if (!existing) {
      res.json({ success: false, error: "Parts order not found" });
      return;
    }

    const { error } = await supabaseServer
      .from("parts_orders")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);

    if (error) {
      res.json({ success: false, error: `Failed to update status: ${error.message}` });
      return;
    }

    await logAction(user, "change_parts_order_status", "parts_order", data.id, {
      from: existing.status,
      to: data.status,
      order_number: existing.order_number,
    });

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "updatePartsOrderStatus");
  }
});

// POST /api/parts-orders/duplicate
partsOrdersRouter.post("/duplicate", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can duplicate orders" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { data: original, error } = await supabaseServer
      .from("parts_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !original) {
      res.json({ success: false, error: "Original order not found" });
      return;
    }

    const { data: orderNumber } = await supabaseServer.rpc("next_parts_order_number");
    if (!orderNumber) {
      res.json({ success: false, error: "Failed to generate order number" });
      return;
    }

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
      res.json({ success: false, error: `Failed to duplicate: ${insErr?.message}` });
      return;
    }

    const { data: items } = await supabaseServer
      .from("parts_order_items")
      .select("*")
      .eq("parts_order_id", id)
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

    res.json({ success: true, id: newRec.id, order_number: newRec.order_number });
  } catch (err) {
    handleErr(res, err, "duplicatePartsOrder");
  }
});
