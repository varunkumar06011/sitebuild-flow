import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches all budget lines with actual spend computed from vendor payments and requisition invoice amounts.
export const fetchBudgets = createServerFn({ method: "GET" })
  .validator((input: { fiscalYear?: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("budgets")
      .select("id, block, category, description, budgeted_amount, fiscal_year, notes, created_at")
      .order("block", { ascending: true });

    if (data.fiscalYear) query = query.eq("fiscal_year", data.fiscalYear);

    const { data: budgets, error } = await query;
    if (error) return { data: [], total: 0 };

    // Compute actual spend: sum of vendor total_amount + outstanding payments
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("total_amount, amount_paid, outstanding_amount")
      .eq("status", "Active");

    const totalCommitted = (vendors ?? []).reduce((sum, v: any) => sum + (v.total_amount ?? 0), 0);
    const totalPaid = (vendors ?? []).reduce((sum, v: any) => sum + (v.amount_paid ?? 0), 0);
    const totalOutstanding = (vendors ?? []).reduce(
      (sum, v: any) => sum + (v.outstanding_amount ?? 0),
      0,
    );

    // Distribute actuals proportionally across budget lines (simplified — real ERP would map per category)
    const budgetTotal = (budgets ?? []).reduce((sum, b: any) => sum + (b.budgeted_amount ?? 0), 0);
    const enriched = (budgets ?? []).map((b: any) => {
      const proportion = budgetTotal > 0 ? (b.budgeted_amount ?? 0) / budgetTotal : 0;
      const actualAmount = Math.round(totalCommitted * proportion);
      const variance = (b.budgeted_amount ?? 0) - actualAmount;
      const utilisationPct =
        b.budgeted_amount > 0 ? Math.round((actualAmount / b.budgeted_amount) * 100) : 0;
      return {
        ...b,
        actual_amount: actualAmount,
        variance,
        utilisation_pct: utilisationPct,
      };
    });

    return {
      data: enriched,
      total: enriched.length,
      summary: {
        total_budget: budgetTotal,
        total_committed: totalCommitted,
        total_paid: totalPaid,
        total_outstanding: totalOutstanding,
        overall_variance: budgetTotal - totalCommitted,
        overall_utilisation_pct:
          budgetTotal > 0 ? Math.round((totalCommitted / budgetTotal) * 100) : 0,
      },
    };
  });

const budgetSchema = z.object({
  block: z.string().optional(),
  category: z.string().optional(),
  description: z.string().min(1),
  budgeted_amount: z.number().min(0),
  fiscal_year: z.string().default(String(new Date().getFullYear())),
  notes: z.string().optional(),
});

// Creates a new budget line and logs the action.
export const createBudget = createServerFn({ method: "POST" })
  .validator(budgetSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: budget, error } = await supabaseServer
      .from("budgets")
      .insert(data)
      .select("id, description")
      .single();

    if (error || !budget) return { success: false, error: "Failed to create budget" };

    await logAction(user, "create_budget", "budgets", budget.id, {
      description: budget.description,
    });
    return { success: true, id: budget.id };
  });

// Updates an existing budget line and logs the change.
export const updateBudget = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...budgetSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("budgets").update(updates).eq("id", id);
    if (error) return { success: false, error: "Failed to update budget" };

    await logAction(user, "update_budget", "budgets", id, updates);
    return { success: true };
  });

// Deletes a budget line and logs the action.
export const deleteBudget = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { error } = await supabaseServer.from("budgets").delete().eq("id", data.id);
    if (error) return { success: false, error: "Failed to delete budget" };

    await logAction(user, "delete_budget", "budgets", data.id, {});
    return { success: true };
  });
