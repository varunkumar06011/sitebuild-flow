import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches TDS/GST records with optional type/status/period filter, joined with vendor name.
export const fetchTdsGstRecords = createServerFn({ method: "GET" })
  .validator(
    (input: { recordType?: string; status?: string; period?: string; search?: string }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();

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

    return {
      data: enriched,
      total: count ?? 0,
      summary: {
        tds_total: tdsTotal,
        gst_input_credit_total: gstTotal,
        pending: pendingCount,
        filed: filedCount,
        reconciled: reconciledCount,
      },
    };
  });

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

// Creates a new TDS/GST record and logs the action.
export const createTdsGstRecord = createServerFn({ method: "POST" })
  .validator(tdsGstSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: record, error } = await supabaseServer
      .from("tds_gst_records")
      .insert(data)
      .select("id, record_type, period")
      .single();

    if (error || !record) return { success: false, error: "Failed to create TDS/GST record" };

    await logAction(user, "create_tds_gst", "tds_gst_records", record.id, {
      record_type: record.record_type,
      period: record.period,
    });
    return { success: true, id: record.id };
  });

// Updates an existing TDS/GST record and logs the change.
export const updateTdsGstRecord = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...tdsGstSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("tds_gst_records").update(updates).eq("id", id);
    if (error) return { success: false, error: "Failed to update TDS/GST record" };

    await logAction(user, "update_tds_gst", "tds_gst_records", id, updates);
    return { success: true };
  });
