import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireVendorAccount } from "../lib/portal-session.js";
import { logAction } from "../lib/audit.js";
import type { SessionUser } from "../lib/session.js";

export const vendorPortalRouter = Router();

function vendorAuditUser(account: any): SessionUser {
  return { id: account.id, name: account.name, role: "vendor" as any, phone: account.phone };
}

// GET /api/vendor-portal/profile
vendorPortalRouter.get("/profile", async (req: Request, res: Response) => {
  try {
    const account = await requireVendorAccount(req);

    const { data: vendor, error } = await supabaseServer
      .from("vendors")
      .select("id, name, gst_number, address, city, state, pincode, phone, email, total_amount, amount_paid, outstanding_amount")
      .eq("id", account.vendor_id!)
      .single();

    if (error || !vendor) {
      res.json({ data: null, error: "Vendor not found" });
      return;
    }
    res.json({ data: vendor });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Unauthorized") || err.message.startsWith("Forbidden"))) {
      res.status(401).json({ data: null, error: err.message });
      return;
    }
    console.error("fetchVendorProfile error:", err);
    res.status(500).json({ data: null, error: "Failed to fetch vendor profile" });
  }
});

// GET /api/vendor-portal/pos
vendorPortalRouter.get("/pos", async (req: Request, res: Response) => {
  try {
    const account = await requireVendorAccount(req);
    const stage = req.query["stage"] as string | undefined;

    let query = supabaseServer
      .from("requisitions")
      .select("id, pr_number, po_number, title, block, amount, stage, date, delivery_date, quantity_received, invoice_number, invoice_date, invoice_amount")
      .eq("vendor_id", account.vendor_id!)
      .order("date", { ascending: false });

    if (stage) query = query.eq("stage", stage);

    const { data: pos, error } = await query;
    if (error) {
      res.json({ data: [], error: error.message });
      return;
    }
    res.json({ data: pos ?? [] });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Unauthorized") || err.message.startsWith("Forbidden"))) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchVendorPOs error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch POs" });
  }
});

// GET /api/vendor-portal/payments
vendorPortalRouter.get("/payments", async (req: Request, res: Response) => {
  try {
    const account = await requireVendorAccount(req);

    const { data: payments, error } = await supabaseServer
      .from("vendor_payments")
      .select("id, amount, payment_type, payment_date, notes, created_at, proof_path")
      .eq("vendor_id", account.vendor_id!)
      .order("payment_date", { ascending: false });

    if (error) {
      res.json({ data: [], error: error.message });
      return;
    }
    res.json({ data: payments ?? [] });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Unauthorized") || err.message.startsWith("Forbidden"))) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchVendorPayments error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch payments" });
  }
});

// POST /api/vendor-portal/update-delivery
const updateDeliverySchema = z.object({
  requisition_id: z.string().uuid(),
  delivery_date: z.string().optional(),
  quantity_received: z.number().min(0).optional(),
  notes: z.string().optional(),
});

vendorPortalRouter.post("/update-delivery", async (req: Request, res: Response) => {
  try {
    const account = await requireVendorAccount(req);
    const data = updateDeliverySchema.parse(req.body);

    const { data: reqRow } = await supabaseServer
      .from("requisitions")
      .select("id, vendor_id, stage")
      .eq("id", data.requisition_id)
      .single();

    if (!reqRow || reqRow.vendor_id !== account.vendor_id) {
      res.json({ success: false, error: "PO not found or not assigned to your account" });
      return;
    }

    const updates: Record<string, any> = {};
    if (data.delivery_date) updates["delivery_date"] = data.delivery_date;
    if (data.quantity_received !== undefined) updates["quantity_received"] = data.quantity_received;

    if (data.quantity_received !== undefined && data.quantity_received > 0 && reqRow["stage"] === "PO") {
      updates["stage"] = "Material Received";
    }

    const { error } = await supabaseServer
      .from("requisitions")
      .update(updates)
      .eq("id", data.requisition_id);

    if (error) {
      res.json({ success: false, error: "Failed to update delivery status" });
      return;
    }

    await logAction(vendorAuditUser(account), "vendor_update_delivery", "requisition", data.requisition_id, {
      delivery_date: data.delivery_date,
      quantity_received: data.quantity_received,
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Unauthorized") || err.message.startsWith("Forbidden"))) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateDeliveryStatus error:", err);
    res.status(500).json({ success: false, error: "Failed to update delivery status" });
  }
});

// POST /api/vendor-portal/upload-document
const uploadDocSchema = z.object({
  requisition_id: z.string().uuid(),
  doc_type: z.enum(["invoice", "challan", "mtc", "other"]),
  file_path: z.string().min(1),
  file_name: z.string().optional(),
  notes: z.string().optional(),
});

vendorPortalRouter.post("/upload-document", async (req: Request, res: Response) => {
  try {
    const account = await requireVendorAccount(req);
    const data = uploadDocSchema.parse(req.body);

    const { data: reqRow } = await supabaseServer
      .from("requisitions")
      .select("id, vendor_id, documents, invoice_number, invoice_amount")
      .eq("id", data.requisition_id)
      .single();

    if (!reqRow || reqRow.vendor_id !== account.vendor_id) {
      res.json({ success: false, error: "PO not found or not assigned to your account" });
      return;
    }

    const docs = Array.isArray(reqRow.documents) ? reqRow.documents : [];
    docs.push({
      type: data.doc_type,
      path: data.file_path,
      name: data.file_name,
      uploaded_by: "vendor",
      uploaded_at: new Date().toISOString(),
      notes: data.notes,
    });

    const { error } = await supabaseServer
      .from("requisitions")
      .update({ documents: docs })
      .eq("id", data.requisition_id);

    if (error) {
      res.json({ success: false, error: "Failed to upload document" });
      return;
    }

    await logAction(vendorAuditUser(account), "vendor_upload_document", "requisition", data.requisition_id, {
      doc_type: data.doc_type,
      file_name: data.file_name,
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Unauthorized") || err.message.startsWith("Forbidden"))) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("uploadVendorDocument error:", err);
    res.status(500).json({ success: false, error: "Failed to upload document" });
  }
});

// GET /api/vendor-portal/outstanding
vendorPortalRouter.get("/outstanding", async (req: Request, res: Response) => {
  try {
    const account = await requireVendorAccount(req);

    const { data: vendor } = await supabaseServer
      .from("vendors")
      .select("total_amount, amount_paid, outstanding_amount")
      .eq("id", account.vendor_id!)
      .single();

    if (!vendor) {
      res.json({ data: null });
      return;
    }

    const { data: invoices } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, invoice_number, invoice_amount, invoice_date, stage, amount")
      .eq("vendor_id", account.vendor_id!)
      .in("stage", ["Invoice", "Payment", "Completed"])
      .order("invoice_date", { ascending: false });

    const now = Date.now();
    const aging = { current: 0, days_30: 0, days_60: 0, days_90: 0, over_90: 0 };

    for (const inv of invoices ?? []) {
      const amt = Number((inv as any).invoice_amount ?? (inv as any).amount ?? 0);
      if (amt <= 0 || !(inv as any).invoice_date) continue;
      const daysOverdue = Math.floor((now - new Date((inv as any).invoice_date).getTime()) / (1000 * 60 * 60 * 30));
      if (daysOverdue <= 0) aging.current += amt;
      else if (daysOverdue <= 30) aging.days_30 += amt;
      else if (daysOverdue <= 60) aging.days_60 += amt;
      else if (daysOverdue <= 90) aging.days_90 += amt;
      else aging.over_90 += amt;
    }

    res.json({
      data: {
        total_amount: Number((vendor as any).total_amount ?? 0),
        amount_paid: Number((vendor as any).amount_paid ?? 0),
        outstanding_amount: Number((vendor as any).outstanding_amount ?? 0),
        aging,
        invoices: invoices ?? [],
      },
    });
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith("Unauthorized") || err.message.startsWith("Forbidden"))) {
      res.status(401).json({ data: null, error: err.message });
      return;
    }
    console.error("fetchVendorOutstanding error:", err);
    res.status(500).json({ data: null, error: "Failed to fetch outstanding" });
  }
});
