// Vendor Portal API — vendor self-service functions.
// Vendors can view their POs, payment status, upload invoices/challans, and update delivery status.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireVendorAccount, type PortalAccount } from "./portal-auth";
import { logAction } from "./audit";
import type { SessionUser } from "./session";

// Builds a pseudo SessionUser from a portal account for audit logging.
function vendorAuditUser(account: PortalAccount): SessionUser {
  return { id: account.id, name: account.name, role: "vendor" as any, phone: account.phone };
}

// Fetches the vendor's profile information.
export const fetchVendorProfile = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    const account = await requireVendorAccount();

    const { data: vendor, error } = await supabaseServer
      .from("vendors")
      .select(
        "id, name, gst_number, address, city, state, pincode, phone, email, total_amount, amount_paid, outstanding_amount",
      )
      .eq("id", account.vendor_id!)
      .single();

    if (error || !vendor) return { data: null, error: "Vendor not found" };
    return { data: vendor };
  });

// Fetches all requisitions (POs) assigned to this vendor.
export const fetchVendorPOs = createServerFn({ method: "GET" })
  .validator((input: { stage?: string }) => input)
  .handler(async ({ data }) => {
    const account = await requireVendorAccount();

    let query = supabaseServer
      .from("requisitions")
      .select(
        "id, pr_number, po_number, title, block, amount, stage, date, delivery_date, quantity_received, invoice_number, invoice_date, invoice_amount",
      )
      .eq("vendor_id", account.vendor_id!)
      .order("date", { ascending: false });

    if (data.stage) query = query.eq("stage", data.stage);

    const { data: pos, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: pos ?? [] };
  });

// Fetches all payments for this vendor.
export const fetchVendorPayments = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    const account = await requireVendorAccount();

    const { data: payments, error } = await supabaseServer
      .from("vendor_payments")
      .select("id, amount, payment_type, payment_date, notes, created_at, proof_path")
      .eq("vendor_id", account.vendor_id!)
      .order("payment_date", { ascending: false });

    if (error) return { data: [], error: error.message };
    return { data: payments ?? [] };
  });

// Updates the delivery status / delivery date for a PO.
const updateDeliverySchema = z.object({
  requisition_id: z.string().uuid(),
  delivery_date: z.string().optional(),
  quantity_received: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const updateDeliveryStatus = createServerFn({ method: "POST" })
  .validator(updateDeliverySchema)
  .handler(async ({ data }) => {
    const account = await requireVendorAccount();

    // Verify this PO belongs to this vendor
    const { data: req } = await supabaseServer
      .from("requisitions")
      .select("id, vendor_id, stage")
      .eq("id", data.requisition_id)
      .single();

    if (!req || req.vendor_id !== account.vendor_id) {
      return { success: false, error: "PO not found or not assigned to your account" };
    }

    const updates: Record<string, any> = {};
    if (data.delivery_date) updates["delivery_date"] = data.delivery_date;
    if (data.quantity_received !== undefined) updates["quantity_received"] = data.quantity_received;

    // If quantity received is set and stage is PO, advance to Material Received
    if (
      data.quantity_received !== undefined &&
      data.quantity_received > 0 &&
      req["stage"] === "PO"
    ) {
      updates["stage"] = "Material Received";
    }

    const { error } = await supabaseServer
      .from("requisitions")
      .update(updates)
      .eq("id", data.requisition_id);

    if (error) return { success: false, error: "Failed to update delivery status" };

    await logAction(
      vendorAuditUser(account),
      "vendor_update_delivery",
      "requisition",
      data.requisition_id,
      { delivery_date: data.delivery_date, quantity_received: data.quantity_received },
    );
    return { success: true };
  });

// Uploads an invoice or challan document for a PO (stores path in documents array).
const uploadDocSchema = z.object({
  requisition_id: z.string().uuid(),
  doc_type: z.enum(["invoice", "challan", "mtc", "other"]),
  file_path: z.string().min(1),
  file_name: z.string().optional(),
  notes: z.string().optional(),
});

export const uploadVendorDocument = createServerFn({ method: "POST" })
  .validator(uploadDocSchema)
  .handler(async ({ data }) => {
    const account = await requireVendorAccount();

    // Verify this PO belongs to this vendor
    const { data: req } = await supabaseServer
      .from("requisitions")
      .select("id, vendor_id, documents, invoice_number, invoice_amount")
      .eq("id", data.requisition_id)
      .single();

    if (!req || req.vendor_id !== account.vendor_id) {
      return { success: false, error: "PO not found or not assigned to your account" };
    }

    // Append to documents array
    const docs = Array.isArray(req.documents) ? req.documents : [];
    docs.push({
      type: data.doc_type,
      path: data.file_path,
      name: data.file_name,
      uploaded_by: "vendor",
      uploaded_at: new Date().toISOString(),
      notes: data.notes,
    });

    const updates: Record<string, any> = { documents: docs };

    // If it's an invoice and invoice_number is not set, we don't auto-set it (vendor can't set invoice numbers)

    const { error } = await supabaseServer
      .from("requisitions")
      .update(updates)
      .eq("id", data.requisition_id);

    if (error) return { success: false, error: "Failed to upload document" };

    await logAction(
      vendorAuditUser(account),
      "vendor_upload_document",
      "requisition",
      data.requisition_id,
      { doc_type: data.doc_type, file_name: data.file_name },
    );
    return { success: true };
  });

// Fetches outstanding payment summary (aging analysis).
export const fetchVendorOutstanding = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    const account = await requireVendorAccount();

    const { data: vendor } = await supabaseServer
      .from("vendors")
      .select("total_amount, amount_paid, outstanding_amount")
      .eq("id", account.vendor_id!)
      .single();

    if (!vendor) return { data: null };

    // Get unpaid invoices (requisitions at Invoice or Payment stage with outstanding)
    const { data: invoices } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, invoice_number, invoice_amount, invoice_date, stage, amount")
      .eq("vendor_id", account.vendor_id!)
      .in("stage", ["Invoice", "Payment", "Completed"])
      .order("invoice_date", { ascending: false });

    const now = Date.now();
    const aging = {
      current: 0, // not yet due
      days_30: 0, // 1-30 days overdue
      days_60: 0, // 31-60 days
      days_90: 0, // 61-90 days
      over_90: 0, // 90+ days
    };

    for (const inv of invoices ?? []) {
      const amt = Number(inv.invoice_amount ?? inv.amount ?? 0);
      if (amt <= 0 || !inv.invoice_date) continue;
      const daysOverdue = Math.floor(
        (now - new Date(inv.invoice_date).getTime()) / (1000 * 60 * 60 * 30),
      );
      if (daysOverdue <= 0) aging.current += amt;
      else if (daysOverdue <= 30) aging.days_30 += amt;
      else if (daysOverdue <= 60) aging.days_60 += amt;
      else if (daysOverdue <= 90) aging.days_90 += amt;
      else aging.over_90 += amt;
    }

    return {
      data: {
        total_amount: Number(vendor.total_amount ?? 0),
        amount_paid: Number(vendor.amount_paid ?? 0),
        outstanding_amount: Number(vendor.outstanding_amount ?? 0),
        aging,
        invoices: invoices ?? [],
      },
    };
  });
