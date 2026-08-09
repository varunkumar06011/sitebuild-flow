import { Router, type Request, type Response } from "express";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";

export const dailyDiaryRouter = Router();

// GET /api/daily-diary/fetch
dailyDiaryRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const targetDate = (req.query["date"] as string) ?? new Date().toISOString().slice(0, 10);
    const dayStart = `${targetDate}T00:00:00+05:30`;
    const dayEnd = `${targetDate}T23:59:59+05:30`;

    const { data: labour } = await supabaseServer
      .from("labour")
      .select("trade, contractor, planned, present, block")
      .gte("date", dayStart)
      .lte("date", dayEnd)
      .order("trade", { ascending: true });

    const totalPlanned = (labour ?? []).reduce((s, l: any) => s + (l.planned ?? 0), 0);
    const totalPresent = (labour ?? []).reduce((s, l: any) => s + (l.present ?? 0), 0);

    const { data: visitors } = await supabaseServer
      .from("visitors")
      .select("name, org, purpose, in_time, out_time, host")
      .gte("in_time", dayStart)
      .lte("in_time", dayEnd)
      .order("in_time", { ascending: true });

    const { data: vehicles } = await supabaseServer
      .from("vehicles")
      .select("number, type, driver, material, in_time, out_time")
      .gte("in_time", dayStart)
      .lte("in_time", dayEnd)
      .order("in_time", { ascending: true });

    const { data: gatePasses } = await supabaseServer
      .from("gate_passes")
      .select("gp_number, material, qty, type, status, from_location, to_location")
      .gte("requested_at", dayStart)
      .lte("requested_at", dayEnd)
      .order("requested_at", { ascending: true });

    const { data: inspections } = await supabaseServer
      .from("inspections")
      .select("qc_number, activity, location, inspector, result")
      .gte("date", dayStart)
      .lte("date", dayEnd)
      .order("date", { ascending: true });

    const { data: batches } = await supabaseServer
      .from("batches")
      .select("batch_number, material, supplier, status")
      .gte("purchase_date", dayStart)
      .lte("purchase_date", dayEnd)
      .order("purchase_date", { ascending: true });

    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select("pr_number, title, block, amount, stage")
      .gte("date", dayStart)
      .lte("date", dayEnd)
      .order("date", { ascending: true });

    const { data: progress } = await supabaseServer
      .from("progress")
      .select("block, pct, updated_at")
      .gte("updated_at", dayStart)
      .lte("updated_at", dayEnd)
      .order("block", { ascending: true });

    const { data: invTxns } = await supabaseServer
      .from("inventory_transactions")
      .select("type, item_name, quantity, notes")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .order("created_at", { ascending: true });

    res.json({
      date: targetDate,
      summary: {
        total_labour_planned: totalPlanned,
        total_labour_present: totalPresent,
        labour_productivity_pct:
          totalPlanned > 0 ? Math.round((totalPresent / totalPlanned) * 100) : 0,
        labour_entries: labour?.length ?? 0,
        visitors_count: visitors?.length ?? 0,
        vehicles_count: vehicles?.length ?? 0,
        gate_passes_count: gatePasses?.length ?? 0,
        inspections_count: inspections?.length ?? 0,
        inspections_pass: (inspections ?? []).filter((i: any) => i.result === "Pass").length,
        inspections_fail: (inspections ?? []).filter((i: any) => i.result === "Fail").length,
        batches_count: batches?.length ?? 0,
        requisitions_count: requisitions?.length ?? 0,
        requisitions_amount: (requisitions ?? []).reduce((s, r: any) => s + (r.amount ?? 0), 0),
        progress_updates: progress?.length ?? 0,
        inventory_transactions: invTxns?.length ?? 0,
      },
      labour: labour ?? [],
      visitors: visitors ?? [],
      vehicles: vehicles ?? [],
      gate_passes: gatePasses ?? [],
      inspections: inspections ?? [],
      batches: batches ?? [],
      requisitions: requisitions ?? [],
      progress: progress ?? [],
      inventory_transactions: invTxns ?? [],
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("fetchDailyDiary error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch daily diary" });
  }
});
