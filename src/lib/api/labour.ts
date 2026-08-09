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

// ---------------------------------------------------------------------------
// Fetch labour attendance records with optional date range and work_category filter
// ---------------------------------------------------------------------------
export const fetchAttendance = createServerFn({ method: "GET" })
  .validator(
    (input: {
      fromDate?: string;
      toDate?: string;
      workCategory?: string;
      contractorName?: string;
      page?: number;
      limit?: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSessionUser();
    const page = data.page ?? 1;
    const limit = data.limit ?? 50;
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from("labour_attendance")
      .select(
        "id, date, work_category, contractor_name, headcount_skilled, headcount_unskilled, marked_by, marked_by_name, notes, created_at",
        { count: "exact" },
      )
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.fromDate) query = query.gte("date", data.fromDate);
    if (data.toDate) query = query.lte("date", data.toDate);
    if (data.workCategory && data.workCategory !== "all") {
      query = query.eq("work_category", data.workCategory);
    }
    if (data.contractorName) {
      query = query.ilike("contractor_name", `%${data.contractorName}%`);
    }

    const { data: records, count } = await query;

    return { data: records ?? [], total: count ?? 0, page, limit };
  });

// ---------------------------------------------------------------------------
// Mark attendance (create) — Supervisors and above
// ---------------------------------------------------------------------------
const markAttendanceSchema = z.object({
  date: z.string().min(1),
  work_category: z.string().default("uncategorized"),
  contractor_name: z.string().min(1),
  headcount_skilled: z.number().int().min(0).default(0),
  headcount_unskilled: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

export const markAttendance = createServerFn({ method: "POST" })
  .validator(markAttendanceSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

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
      return { success: false, error: "Failed to mark attendance" };
    }

    await logAction(user, "mark_attendance", "labour_attendance", record.id, {
      date: record.date,
      contractor_name: record.contractor_name,
      headcount_skilled: data.headcount_skilled,
      headcount_unskilled: data.headcount_unskilled,
    });

    return { success: true, id: record.id };
  });

// ---------------------------------------------------------------------------
// Update attendance record
// ---------------------------------------------------------------------------
export const updateAttendance = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...markAttendanceSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("labour_attendance").update(updates).eq("id", id);

    if (error) return { success: false, error: "Failed to update attendance" };

    await logAction(user, "update_attendance", "labour_attendance", id, updates);
    return { success: true };
  });

// ---------------------------------------------------------------------------
// getManpowerCostSummary — rolls up attendance headcount against budget/cash-flow data
// Returns total headcounts by work_category and contractor, plus estimated cost
// based on budget allocations and vendor outstanding amounts.
// ---------------------------------------------------------------------------
export const getManpowerCostSummary = createServerFn({ method: "GET" })
  .validator((input: { fromDate?: string; toDate?: string; workCategory?: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can view manpower cost summary" };
    }

    // Fetch attendance records in the date range
    let query = supabaseServer
      .from("labour_attendance")
      .select("work_category, contractor_name, headcount_skilled, headcount_unskilled, date");

    if (data.fromDate) query = query.gte("date", data.fromDate);
    if (data.toDate) query = query.lte("date", data.toDate);
    if (data.workCategory && data.workCategory !== "all") {
      query = query.eq("work_category", data.workCategory);
    }

    const { data: attendance } = await query;

    // Aggregate by work_category
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

    // Fetch budget data for cost estimation per work_category
    const { data: budgets } = await supabaseServer
      .from("budgets")
      .select("block, category, budgeted_amount, fiscal_year");

    // Fetch vendor outstanding amounts for cash-flow context
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name, total_amount, amount_paid, outstanding_amount, work_category")
      .eq("status", "Active");

    const totalBudget = (budgets ?? []).reduce((sum, b: any) => sum + (b.budgeted_amount ?? 0), 0);
    const totalOutstanding = (vendors ?? []).reduce(
      (sum, v: any) => sum + (v.outstanding_amount ?? 0),
      0,
    );
    const totalPaid = (vendors ?? []).reduce((sum, v: any) => sum + (v.amount_paid ?? 0), 0);

    // Estimate manpower cost proportionally to budget allocation per category
    const categorySummary = Object.entries(byCategory).map(([category, counts]) => {
      const categoryBudget = (budgets ?? [])
        .filter((b: any) =>
          (b.category ?? b.block ?? "").toLowerCase().includes(category.toLowerCase()),
        )
        .reduce((sum, b: any) => sum + (b.budgeted_amount ?? 0), 0);

      const categoryVendorSpend = (vendors ?? [])
        .filter((v: any) => (v.work_category ?? "uncategorized") === category)
        .reduce((sum, v: any) => sum + (v.total_amount ?? 0), 0);

      const estimatedCost = Math.round(
        totalBudget > 0 ? (categoryBudget / totalBudget) * totalOutstanding : 0,
      );

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

    return {
      summary: {
        total_skilled: totalSkilled,
        total_unskilled: totalUnskilled,
        total_headcount: totalSkilled + totalUnskilled,
        total_budget: totalBudget,
        total_vendor_outstanding: totalOutstanding,
        total_vendor_paid: totalPaid,
        estimated_total_manpower_cost: categorySummary.reduce(
          (s, c) => s + c.estimated_manpower_cost,
          0,
        ),
      },
      by_category: categorySummary,
      by_contractor: contractorSummary,
    };
  });
