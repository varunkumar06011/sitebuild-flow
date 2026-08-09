import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const labourRouter = Router();

// GET /api/labour/attendance
labourRouter.get("/attendance", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { fromDate, toDate, workCategory, contractorName, page, limit } = req.query as Record<string, string>;
    const p = parseInt(page ?? "1", 10);
    const l = parseInt(limit ?? "50", 10);
    const offset = (p - 1) * l;

    let query = supabaseServer
      .from("labour_attendance")
      .select(
        "id, date, work_category, contractor_name, headcount_skilled, headcount_unskilled, marked_by, marked_by_name, notes, created_at",
        { count: "exact" },
      )
      .order("date", { ascending: false })
      .range(offset, offset + l - 1);

    if (fromDate) query = query.gte("date", fromDate);
    if (toDate) query = query.lte("date", toDate);
    if (workCategory && workCategory !== "all") query = query.eq("work_category", workCategory);
    if (contractorName) query = query.ilike("contractor_name", `%${contractorName}%`);

    const { data: records, count } = await query;
    res.json({ data: records ?? [], total: count ?? 0, page: p, limit: l });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchAttendance error:", err);
    res.status(500).json({ error: "Failed to fetch attendance" });
  }
});

// POST /api/labour/mark-attendance
const markAttendanceSchema = z.object({
  date: z.string().min(1),
  work_category: z.string().default("uncategorized"),
  contractor_name: z.string().min(1),
  headcount_skilled: z.number().int().min(0).default(0),
  headcount_unskilled: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

labourRouter.post("/mark-attendance", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = markAttendanceSchema.parse(req.body);

    const { data: record, error } = await supabaseServer
      .from("labour_attendance")
      .insert({
        date: data.date,
        work_category: data.work_category,
        contractor_name: data.contractor_name,
        headcount_skilled: data.headcount_skilled,
        headcount_unskilled: data.headcount_unskilled,
        marked_by: user.id,
        marked_by_name: user.name,
        notes: data.notes ?? null,
      })
      .select("id, date, contractor_name")
      .single();

    if (error || !record) {
      res.json({ success: false, error: "Failed to mark attendance" });
      return;
    }

    await logAction(user, "mark_attendance", "labour_attendance", record.id, {
      date: record.date,
      contractor_name: record.contractor_name,
      headcount_skilled: data.headcount_skilled,
      headcount_unskilled: data.headcount_unskilled,
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
    console.error("markAttendance error:", err);
    res.status(500).json({ success: false, error: "Failed to mark attendance" });
  }
});

// POST /api/labour/update-attendance
labourRouter.post("/update-attendance", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { id, ...updates } = z.object({
      id: z.string().uuid(),
      date: z.string().optional(),
      work_category: z.string().optional(),
      contractor_name: z.string().optional(),
      headcount_skilled: z.number().int().min(0).optional(),
      headcount_unskilled: z.number().int().min(0).optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const { error } = await supabaseServer.from("labour_attendance").update(updates).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update attendance" });
      return;
    }

    await logAction(user, "update_attendance", "labour_attendance", id, updates);
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
    console.error("updateAttendance error:", err);
    res.status(500).json({ success: false, error: "Failed to update attendance" });
  }
});

// GET /api/labour/manpower-cost-summary
labourRouter.get("/manpower-cost-summary", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Only administrators can view manpower cost summary" });
      return;
    }

    const { fromDate, toDate, workCategory } = req.query as Record<string, string>;
    let query = supabaseServer
      .from("labour_attendance")
      .select("work_category, contractor_name, headcount_skilled, headcount_unskilled, date");

    if (fromDate) query = query.gte("date", fromDate);
    if (toDate) query = query.lte("date", toDate);
    if (workCategory && workCategory !== "all") query = query.eq("work_category", workCategory);

    const { data: attendance } = await query;

    const byCategory: Record<string, { skilled: number; unskilled: number; total: number }> = {};
    const byContractor: Record<string, { skilled: number; unskilled: number; total: number }> = {};

    for (const row of attendance ?? []) {
      const cat = row.work_category ?? "uncategorized";
      const con = row.contractor_name ?? "Unknown";
      if (!byCategory[cat]) byCategory[cat] = { skilled: 0, unskilled: 0, total: 0 };
      if (!byContractor[con]) byContractor[con] = { skilled: 0, unskilled: 0, total: 0 };
      byCategory[cat].skilled += row.headcount_skilled ?? 0;
      byCategory[cat].unskilled += row.headcount_unskilled ?? 0;
      byCategory[cat].total += (row.headcount_skilled ?? 0) + (row.headcount_unskilled ?? 0);
      byContractor[con].skilled += row.headcount_skilled ?? 0;
      byContractor[con].unskilled += row.headcount_unskilled ?? 0;
      byContractor[con].total += (row.headcount_skilled ?? 0) + (row.headcount_unskilled ?? 0);
    }

    const { data: budgets } = await supabaseServer
      .from("budgets")
      .select("block, category, budgeted_amount, fiscal_year");

    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name, total_amount, amount_paid, outstanding_amount, work_category")
      .eq("status", "Active");

    const totalBudget = (budgets ?? []).reduce((sum, b: any) => sum + (b.budgeted_amount ?? 0), 0);
    const totalOutstanding = (vendors ?? []).reduce((sum, v: any) => sum + (v.outstanding_amount ?? 0), 0);
    const totalPaid = (vendors ?? []).reduce((sum, v: any) => sum + (v.amount_paid ?? 0), 0);

    const categorySummary = Object.entries(byCategory).map(([category, counts]) => {
      const categoryBudget = (budgets ?? [])
        .filter((b: any) => (b.category ?? b.block ?? "").toLowerCase().includes(category.toLowerCase()))
        .reduce((sum, b: any) => sum + (b.budgeted_amount ?? 0), 0);
      const categoryVendorSpend = (vendors ?? [])
        .filter((v: any) => (v.work_category ?? "uncategorized") === category)
        .reduce((sum, v: any) => sum + (v.total_amount ?? 0), 0);
      const estimatedCost = Math.round(totalBudget > 0 ? (categoryBudget / totalBudget) * totalOutstanding : 0);

      return {
        work_category: category,
        headcount_skilled: counts.skilled,
        headcount_unskilled: counts.unskilled,
        total_headcount: counts.total,
        category_budget: categoryBudget,
        vendor_spend: categoryVendorSpend,
        estimated_manpower_cost: estimatedCost,
      };
    });

    const contractorSummary = Object.entries(byContractor).map(([contractor, counts]) => ({
      contractor_name: contractor,
      headcount_skilled: counts.skilled,
      headcount_unskilled: counts.unskilled,
      total_headcount: counts.total,
    }));

    const totalSkilled = Object.values(byCategory).reduce((s, c) => s + c.skilled, 0);
    const totalUnskilled = Object.values(byCategory).reduce((s, c) => s + c.unskilled, 0);

    res.json({
      summary: {
        total_skilled: totalSkilled,
        total_unskilled: totalUnskilled,
        total_headcount: totalSkilled + totalUnskilled,
        total_budget: totalBudget,
        total_vendor_outstanding: totalOutstanding,
        total_vendor_paid: totalPaid,
        estimated_total_manpower_cost: categorySummary.reduce((s, c) => s + c.estimated_manpower_cost, 0),
      },
      by_category: categorySummary,
      by_contractor: contractorSummary,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("getManpowerCostSummary error:", err);
    res.status(500).json({ error: "Failed to fetch manpower cost summary" });
  }
});
