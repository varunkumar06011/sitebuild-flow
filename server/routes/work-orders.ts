import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";
import { sanitizeSearch } from "../lib/sanitize.js";
import type { Role } from "../lib/erp-data.js";

export const workOrdersRouter = Router();

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

// GET /api/work-orders
const fetchWorkOrdersSchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.string().optional(),
  supervisorId: z.string().optional(),
  search: z.string().optional(),
  workCategory: z.string().optional(),
});

workOrdersRouter.get("/", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = fetchWorkOrdersSchema.parse(req.query);
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("work_orders")
      .select(
        "id, order_number, order_date, status, block_id, project_name, project_id, site_name, site_address, customer_name, customer_id, customer_contact, billing_address, billing_city, billing_state, billing_pincode, customer_phone, customer_email, requested_by, requested_by_name, department, assigned_supervisor_id, assigned_supervisor_name, assigned_at, work_description, subtotal, taxable_amount, tax_rate, tax_amount, shipping_handling, other_charges, grand_total, payment_terms, due_date, advance_amount, balance_due, comments, work_category, completed_date, completed_by_name, customer_acknowledgement, pdf_path, created_at, updated_at",
        { count: "exact" },
      )
      .order("order_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (user.role === "Supervisor") {
      query = query.eq("assigned_supervisor_id", user.id);
    }

    if (data.status) query = query.eq("status", data.status);
    if (data.supervisorId) query = query.eq("assigned_supervisor_id", data.supervisorId);
    if (data.workCategory && data.workCategory !== "all")
      query = query.eq("work_category", data.workCategory);
    if (data.search) {
      const s = sanitizeSearch(data.search);
      if (s) {
        query = query.or(
          `order_number.ilike.%${s}%,project_name.ilike.%${s}%,customer_name.ilike.%${s}%`,
        );
      }
    }

    const { data: orders, count } = await query;
    const orderIds = (orders ?? []).map((o: any) => o.id);

    const itemsMap = new Map<string, any[]>();
    if (orderIds.length > 0) {
      const { data: items } = await supabaseServer
        .from("work_order_items")
        .select("id, work_order_id, description, quantity, taxable, unit_price, total, sort_order")
        .in("work_order_id", orderIds)
        .order("sort_order", { ascending: true });
      for (const it of items ?? []) {
        const arr = itemsMap.get(it.work_order_id) ?? [];
        arr.push({
          id: it.id,
          description: it.description,
          quantity: Number(it.quantity),
          taxable: it.taxable ?? false,
          unit_price: Number(it.unit_price),
          total: Number(it.total),
          sort_order: it.sort_order ?? 0,
        });
        itemsMap.set(it.work_order_id, arr);
      }
    }

    res.json({
      data: (orders ?? []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        order_date: o.order_date,
        status: o.status,
        block_id: o.block_id ?? null,
        project_name: o.project_name ?? null,
        project_id: o.project_id ?? null,
        site_name: o.site_name ?? null,
        site_address: o.site_address ?? null,
        customer_name: o.customer_name ?? null,
        customer_id: o.customer_id ?? null,
        customer_contact: o.customer_contact ?? null,
        billing_address: o.billing_address ?? null,
        billing_city: o.billing_city ?? null,
        billing_state: o.billing_state ?? null,
        billing_pincode: o.billing_pincode ?? null,
        customer_phone: o.customer_phone ?? null,
        customer_email: o.customer_email ?? null,
        requested_by: o.requested_by,
        requested_by_name: o.requested_by_name ?? null,
        department: o.department ?? null,
        assigned_supervisor_id: o.assigned_supervisor_id ?? null,
        assigned_supervisor_name: o.assigned_supervisor_name ?? null,
        assigned_at: o.assigned_at ?? null,
        work_description: o.work_description ?? null,
        subtotal: Number(o.subtotal ?? 0),
        taxable_amount: Number(o.taxable_amount ?? 0),
        tax_rate: Number(o.tax_rate ?? 0),
        tax_amount: Number(o.tax_amount ?? 0),
        shipping_handling: Number(o.shipping_handling ?? 0),
        other_charges: Number(o.other_charges ?? 0),
        grand_total: Number(o.grand_total ?? 0),
        payment_terms: o.payment_terms ?? null,
        due_date: o.due_date ?? null,
        advance_amount: Number(o.advance_amount ?? 0),
        balance_due: Number(o.balance_due ?? 0),
        comments: o.comments ?? null,
        work_category: o.work_category ?? "uncategorized",
        completed_date: o.completed_date ?? null,
        completed_by_name: o.completed_by_name ?? null,
        customer_acknowledgement: o.customer_acknowledgement ?? null,
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
    handleErr(res, err, "fetchWorkOrders");
  }
});

// GET /api/work-orders/supervisors/list
workOrdersRouter.get("/supervisors/list", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: supervisors } = await supabaseServer
      .from("users")
      .select("id, name, phone")
      .eq("role", "Supervisor")
      .order("name", { ascending: true });

    res.json({ data: supervisors ?? [] });
  } catch (err) {
    handleErr(res, err, "fetchSupervisors");
  }
});

// GET /api/work-orders/:id
workOrdersRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const id = z.string().uuid().parse(req.params["id"]);

    const { data: order, error } = await supabaseServer
      .from("work_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !order) {
      res.json({ success: false, error: "Work order not found" });
      return;
    }

    if (user.role === "Supervisor" && order.assigned_supervisor_id !== user.id) {
      res.json({ success: false, error: "You are not authorized to view this work order" });
      return;
    }

    const { data: items } = await supabaseServer
      .from("work_order_items")
      .select("*")
      .eq("work_order_id", id)
      .order("sort_order", { ascending: true });

    res.json({
      success: true,
      data: {
        ...order,
        items: (items ?? []).map((it: any) => ({
          ...it,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          total: Number(it.total),
        })),
      },
    });
  } catch (err) {
    handleErr(res, err, "fetchWorkOrder");
  }
});

// ---------------------------------------------------------------------------
// Calculate totals server-side (never trust frontend-only calculations)
// ---------------------------------------------------------------------------
function calculateTotals(
  items: { quantity: number; unit_price: number; taxable: boolean }[],
  taxRate: number,
  shippingHandling: number,
  otherCharges: number,
) {
  let subtotal = 0;
  let taxableAmount = 0;

  for (const it of items) {
    const lineTotal = Math.round(it.quantity * it.unit_price * 100) / 100;
    subtotal += lineTotal;
    if (it.taxable) taxableAmount += lineTotal;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  taxableAmount = Math.round(taxableAmount * 100) / 100;
  const taxAmount = Math.round(taxableAmount * (taxRate / 100) * 100) / 100;
  const grandTotal =
    Math.round((subtotal + taxAmount + shippingHandling + otherCharges) * 100) / 100;

  return { subtotal, taxableAmount, taxAmount, grandTotal };
}

// POST /api/work-orders/create
const workOrderItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  taxable: z.boolean().default(false),
  unit_price: z.number().min(0),
});

const createWorkOrderSchema = z.object({
  block_id: z.string().uuid().nullable().optional(),
  project_name: z.string().optional(),
  site_name: z.string().optional(),
  site_address: z.string().optional(),
  customer_name: z.string().optional(),
  customer_id: z.string().optional(),
  customer_contact: z.string().optional(),
  billing_address: z.string().optional(),
  billing_city: z.string().optional(),
  billing_state: z.string().optional(),
  billing_pincode: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().optional(),
  department: z.string().optional(),
  work_description: z.string().optional(),
  tax_rate: z.number().min(0).max(100).default(0),
  shipping_handling: z.number().min(0).default(0),
  other_charges: z.number().min(0).default(0),
  payment_terms: z.string().optional(),
  due_date: z.string().optional().nullable(),
  advance_amount: z.number().min(0).default(0),
  comments: z.string().optional(),
  work_category: z.string().optional(),
  assigned_supervisor_id: z.string().uuid().nullable().optional(),
  items: z.array(workOrderItemSchema).min(1, "At least one work/cost entry is required"),
});

workOrdersRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can create work orders" });
      return;
    }
    const data = createWorkOrderSchema.parse(req.body);

    const { data: orderNumber, error: seqErr } = await supabaseServer.rpc("next_work_order_number");

    if (seqErr || !orderNumber) {
      res.json({ success: false, error: "Failed to generate work order number" });
      return;
    }

    const totals = calculateTotals(
      data.items,
      data.tax_rate,
      data.shipping_handling,
      data.other_charges,
    );
    const balanceDue = Math.round((totals.grandTotal - data.advance_amount) * 100) / 100;

    let projectName = data.project_name ?? null;
    if (data.block_id) {
      const { data: block } = await supabaseServer
        .from("progress_blocks")
        .select("name")
        .eq("id", data.block_id)
        .single();
      if (block && !projectName) projectName = block.name;
    }

    let supervisorName: string | null = null;
    let assignedAt: string | null = null;
    if (data.assigned_supervisor_id) {
      const { data: sup } = await supabaseServer
        .from("users")
        .select("name")
        .eq("id", data.assigned_supervisor_id)
        .single();
      if (sup) {
        supervisorName = sup.name;
        assignedAt = new Date().toISOString();
      }
    }

    const insertData: any = {
      order_number: orderNumber,
      status: assignedAt ? "Assigned" : "Draft",
      block_id: data.block_id ?? null,
      project_name: projectName,
      project_id: data.block_id ?? null,
      site_name: data.site_name ?? null,
      site_address: data.site_address ?? null,
      customer_name: data.customer_name ?? null,
      customer_id: data.customer_id ?? null,
      customer_contact: data.customer_contact ?? null,
      billing_address: data.billing_address ?? null,
      billing_city: data.billing_city ?? null,
      billing_state: data.billing_state ?? null,
      billing_pincode: data.billing_pincode ?? null,
      customer_phone: data.customer_phone ?? null,
      customer_email: data.customer_email ?? null,
      requested_by: user.id,
      requested_by_name: user.name,
      department: data.department ?? null,
      assigned_supervisor_id: data.assigned_supervisor_id ?? null,
      assigned_supervisor_name: supervisorName,
      assigned_at: assignedAt,
      work_description: data.work_description ?? null,
      ...totals,
      tax_rate: data.tax_rate,
      shipping_handling: data.shipping_handling,
      other_charges: data.other_charges,
      balance_due: balanceDue,
      advance_amount: data.advance_amount,
      payment_terms: data.payment_terms ?? null,
      due_date: data.due_date ?? null,
      comments: data.comments ?? null,
      work_category: data.work_category ?? "uncategorized",
    };

    const { data: order, error } = await supabaseServer
      .from("work_orders")
      .insert(insertData)
      .select("id, order_number")
      .single();

    if (error || !order) {
      res.json({
        success: false,
        error: `Failed to create work order: ${error?.message ?? "Unknown error"}`,
      });
      return;
    }

    const itemRows = data.items.map((it, idx) => ({
      work_order_id: order.id,
      description: it.description,
      quantity: it.quantity,
      taxable: it.taxable,
      unit_price: it.unit_price,
      total: Math.round(it.quantity * it.unit_price * 100) / 100,
      sort_order: idx,
    }));

    const { error: itemsErr } = await supabaseServer.from("work_order_items").insert(itemRows);

    if (itemsErr) {
      res.json({ success: false, error: `Work order created but items failed: ${itemsErr.message}` });
      return;
    }

    if (data.assigned_supervisor_id) {
      await supabaseServer.from("notifications").insert({
        user_id: data.assigned_supervisor_id,
        type: "work_order_assigned",
        title: `Work Order ${order.order_number} assigned`,
        body: data.work_description?.slice(0, 200) ?? null,
        data: { work_order_id: order.id, order_number: order.order_number },
      });
    }

    await logAction(user, "create_work_order", "work_order", order.id, {
      order_number: order.order_number,
      supervisor: supervisorName,
      grand_total: totals.grandTotal,
    });

    res.json({ success: true, id: order.id, order_number: order.order_number });
  } catch (err) {
    handleErr(res, err, "createWorkOrder");
  }
});

// POST /api/work-orders/update
const updateWorkOrderSchema = z.object({
  id: z.string().uuid(),
  block_id: z.string().uuid().nullable().optional(),
  project_name: z.string().optional(),
  site_name: z.string().optional(),
  site_address: z.string().optional(),
  customer_name: z.string().optional(),
  customer_id: z.string().optional(),
  customer_contact: z.string().optional(),
  billing_address: z.string().optional(),
  billing_city: z.string().optional(),
  billing_state: z.string().optional(),
  billing_pincode: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().optional(),
  department: z.string().optional(),
  work_description: z.string().optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  shipping_handling: z.number().min(0).optional(),
  other_charges: z.number().min(0).optional(),
  payment_terms: z.string().optional(),
  due_date: z.string().optional().nullable(),
  advance_amount: z.number().min(0).optional(),
  comments: z.string().optional(),
  work_category: z.string().optional(),
  assigned_supervisor_id: z.string().uuid().nullable().optional(),
  items: z.array(workOrderItemSchema).min(1).optional(),
});

workOrdersRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Only administrators can edit work orders" });
      return;
    }
    const data = updateWorkOrderSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("work_orders")
      .select("status, order_number, assigned_supervisor_id, assigned_at")
      .eq("id", data.id)
      .single();

    if (!existing) {
      res.json({ success: false, error: "Work order not found" });
      return;
    }
    if (existing.status === "Closed" || existing.status === "Cancelled") {
      res.json({ success: false, error: `Cannot edit a ${existing.status} work order` });
      return;
    }

    let supervisorName: string | null = null;
    let assignedAt: string | null = null;
    if (data.assigned_supervisor_id) {
      const { data: sup } = await supabaseServer
        .from("users")
        .select("name")
        .eq("id", data.assigned_supervisor_id)
        .single();
      if (sup) {
        supervisorName = sup.name;
        if (existing.assigned_supervisor_id !== data.assigned_supervisor_id) {
          assignedAt = new Date().toISOString();
        } else {
          assignedAt = existing.assigned_at ?? new Date().toISOString();
        }
      }
    }

    let totals: any = {};
    let balanceDue: number | undefined;
    if (data.items) {
      totals = calculateTotals(
        data.items,
        data.tax_rate ?? 0,
        data.shipping_handling ?? 0,
        data.other_charges ?? 0,
      );
      balanceDue = Math.round((totals.grandTotal - (data.advance_amount ?? 0)) * 100) / 100;
    }

    const updateData: any = {
      block_id: data.block_id,
      project_name: data.project_name,
      site_name: data.site_name,
      site_address: data.site_address,
      customer_name: data.customer_name,
      customer_id: data.customer_id,
      customer_contact: data.customer_contact,
      billing_address: data.billing_address,
      billing_city: data.billing_city,
      billing_state: data.billing_state,
      billing_pincode: data.billing_pincode,
      customer_phone: data.customer_phone,
      customer_email: data.customer_email,
      department: data.department,
      work_description: data.work_description,
      tax_rate: data.tax_rate,
      shipping_handling: data.shipping_handling,
      other_charges: data.other_charges,
      advance_amount: data.advance_amount,
      payment_terms: data.payment_terms,
      due_date: data.due_date,
      comments: data.comments,
      work_category: data.work_category,
      assigned_supervisor_id: data.assigned_supervisor_id,
      assigned_supervisor_name: supervisorName,
      assigned_at: assignedAt,
      updated_at: new Date().toISOString(),
      ...totals,
    };
    if (balanceDue !== undefined) updateData.balance_due = balanceDue;

    const { error } = await supabaseServer.from("work_orders").update(updateData).eq("id", data.id);

    if (error) {
      res.json({ success: false, error: `Failed to update: ${error.message}` });
      return;
    }

    if (data.items) {
      await supabaseServer.from("work_order_items").delete().eq("work_order_id", data.id);
      const itemRows = data.items.map((it, idx) => ({
        work_order_id: data.id,
        description: it.description,
        quantity: it.quantity,
        taxable: it.taxable,
        unit_price: it.unit_price,
        total: Math.round(it.quantity * it.unit_price * 100) / 100,
        sort_order: idx,
      }));
      const { error: itemsErr } = await supabaseServer.from("work_order_items").insert(itemRows);
      if (itemsErr) {
        res.json({
          success: false,
          error: `Work order updated but items failed: ${itemsErr.message}`,
        });
        return;
      }
    }

    await logAction(user, "update_work_order", "work_order", data.id, {});
    res.json({ success: true, id: data.id, order_number: existing.order_number });
  } catch (err) {
    handleErr(res, err, "updateWorkOrder");
  }
});

// POST /api/work-orders/status
const woStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    "Draft",
    "Sent",
    "Approved",
    "Assigned",
    "In Progress",
    "Completed",
    "Closed",
    "Cancelled",
  ]),
  completed_by_name: z.string().optional(),
  customer_acknowledgement: z.string().optional(),
});

workOrdersRouter.post("/status", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = woStatusSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("work_orders")
      .select("status, order_number, assigned_supervisor_id")
      .eq("id", data.id)
      .single();

    if (!existing) {
      res.json({ success: false, error: "Work order not found" });
      return;
    }

    if (user.role === "Supervisor") {
      if (existing.assigned_supervisor_id !== user.id) {
        res.json({ success: false, error: "You are not authorized to update this work order" });
        return;
      }
      if (data.status !== "In Progress" && data.status !== "Completed") {
        res.json({
          success: false,
          error: "Supervisors can only mark work as In Progress or Completed",
        });
        return;
      }
    } else if (!isAdmin(user.role)) {
      res.json({ success: false, error: "Not authorized" });
      return;
    }

    const updateData: any = {
      status: data.status,
      updated_at: new Date().toISOString(),
    };

    if (data.status === "Completed") {
      updateData.completed_date = new Date().toISOString().split("T")[0];
      updateData.completed_by_name = data.completed_by_name ?? user.name;
      if (data.customer_acknowledgement) {
        updateData.customer_acknowledgement = data.customer_acknowledgement;
      }
    }

    const { error } = await supabaseServer.from("work_orders").update(updateData).eq("id", data.id);

    if (error) {
      res.json({ success: false, error: `Failed to update status: ${error.message}` });
      return;
    }

    await logAction(user, "change_work_order_status", "work_order", data.id, {
      from: existing.status,
      to: data.status,
      order_number: existing.order_number,
    });

    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, "updateWorkOrderStatus");
  }
});
