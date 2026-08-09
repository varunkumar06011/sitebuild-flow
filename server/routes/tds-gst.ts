import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const tdsGstRouter = Router();

// GET /api/tds-gst/fetch — fetches TDS/GST records with optional type/status/period filter, joined with vendor name.
const fetchTdsGstSchema = z.object({
  recordType: z.string().optional(),
  status: z.string().optional(),
  period: z.string().optional(),
  search: z.string().optional(),
});

tdsGstRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchTdsGstSchema.parse(req.query);

    let query = supabaseServer
      .from("tds_gst_records")
      .select(
        "id, vendor_id, vendor_payment_id, record_type, invoice_number, invoice_amount, tds_section, tds_rate, tds_amount, gst_rate, gst_input_credit, eway_bill_number, eway_bill_date, period, status, notes, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (data.recordType) query = query.eq("record_type", data.recordType);
    if (data.status) query = query.eq("status", data.status);
    if (data.period) query = query.eq("period", data.period);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(
          `invoice_number.ilike.%${s}%,eway_bill_number.ilike.%${s}%,period.ilike.%${s}%`,
        );
      }
    }

    const { data: records, count } = await query;

    // Fetch vendor names for the records
    const vendorIds = [...new Set((records ?? []).map((r: any) => r.vendor_id).filter(Boolean))];
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);

    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    const enriched = (records ?? []).map((r: any) => ({
      ...r,
      vendor_name: vendorMap.get(r.vendor_id) ?? "Unknown",
    }));

    // Compute summary totals
    const tdsTotal = enriched
      .filter((r: any) => r.record_type === "TDS")
      .reduce((sum, r: any) => sum + (r.tds_amount ?? 0), 0);
    const gstTotal = enriched
      .filter((r: any) => r.record_type === "GST")
      .reduce((sum, r: any) => sum + (r.gst_input_credit ?? 0), 0);
    const pendingCount = enriched.filter((r: any) => r.status === "Pending").length;
    const filedCount = enriched.filter((r: any) => r.status === "Filed").length;
    const reconciledCount = enriched.filter((r: any) => r.status === "Reconciled").length;

    res.json({
      data: enriched,
      total: count ?? 0,
      summary: {
        tds_total: tdsTotal,
        gst_input_credit_total: gstTotal,
        pending: pendingCount,
        filed: filedCount,
        reconciled: reconciledCount,
      },
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
    console.error("fetchTdsGstRecords error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch TDS/GST records" });
  }
});

// POST /api/tds-gst/create — creates a new TDS/GST record and logs the action.
const tdsGstSchema = z.object({
  vendor_id: z.string().uuid(),
  vendor_payment_id: z.string().uuid().optional(),
  record_type: z.enum(["TDS", "GST"]),
  invoice_number: z.string().optional(),
  invoice_amount: z.number().min(0),
  tds_section: z.enum(["194C", "194J", "194Q", "194I", "Other"]).optional(),
  tds_rate: z.number().optional(),
  tds_amount: z.number().min(0).default(0),
  gst_rate: z.number().optional(),
  gst_input_credit: z.number().min(0).default(0),
  eway_bill_number: z.string().optional(),
  eway_bill_date: z.string().optional(),
  period: z.string().min(1),
  status: z.enum(["Pending", "Filed", "Reconciled"]).default("Pending"),
  notes: z.string().optional(),
});

tdsGstRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = tdsGstSchema.parse(req.body);

    const { data: record, error } = await supabaseServer
      .from("tds_gst_records")
      .insert(data)
      .select("id, record_type, period")
      .single();

    if (error || !record) {
      res.json({ success: false, error: "Failed to create TDS/GST record" });
      return;
    }

    await logAction(user, "create_tds_gst", "tds_gst_records", record.id, {
      record_type: record.record_type,
      period: record.period,
    });
    res.json({ success: true, id: record.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createTdsGstRecord error:", err);
    res.status(500).json({ success: false, error: "Failed to create TDS/GST record" });
  }
});

// POST /api/tds-gst/update — updates an existing TDS/GST record and logs the change.
const updateTdsGstSchema = z.object({
  id: z.string().uuid(),
  ...tdsGstSchema.partial().shape,
});

tdsGstRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateTdsGstSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("tds_gst_records").update(updates).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update TDS/GST record" });
      return;
    }

    await logAction(user, "update_tds_gst", "tds_gst_records", id, updates);
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
    console.error("updateTdsGstRecord error:", err);
    res.status(500).json({ success: false, error: "Failed to update TDS/GST record" });
  }
});
