import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const budgetRouter = Router();

// GET /api/budget/fetch — fetches all budget lines with actual spend computed from vendor payments.
const fetchBudgetsSchema = z.object({
  fiscalYear: z.string().optional(),
});

budgetRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const data = fetchBudgetsSchema.parse(req.query);

    let query = supabaseServer
      .from("budgets")
      .select("id, block, category, description, budgeted_amount, fiscal_year, notes, created_at")
      .order("block", { ascending: true });

    if (data.fiscalYear) query = query.eq("fiscal_year", data.fiscalYear);

    const { data: budgets, error } = await query;
    if (error) {
      res.json({ data: [], total: 0 });
      return;
    }

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

    res.json({
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
    console.error("fetchBudgets error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch budgets" });
  }
});

// POST /api/budget/create — creates a new budget line and logs the action.
const budgetSchema = z.object({
  block: z.string().optional(),
  category: z.string().optional(),
  description: z.string().min(1),
  budgeted_amount: z.number().min(0),
  fiscal_year: z.string().default(String(new Date().getFullYear())),
  notes: z.string().optional(),
});

budgetRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = budgetSchema.parse(req.body);

    const { data: budget, error } = await supabaseServer
      .from("budgets")
      .insert(data)
      .select("id, description")
      .single();

    if (error || !budget) {
      res.json({ success: false, error: "Failed to create budget" });
      return;
    }

    await logAction(user, "create_budget", "budgets", budget.id, {
      description: budget.description,
    });
    res.json({ success: true, id: budget.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createBudget error:", err);
    res.status(500).json({ success: false, error: "Failed to create budget" });
  }
});

// POST /api/budget/update — updates an existing budget line and logs the change.
const updateBudgetSchema = z.object({
  id: z.string().uuid(),
  ...budgetSchema.partial().shape,
});

budgetRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = updateBudgetSchema.parse(req.body);
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("budgets").update(updates).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to update budget" });
      return;
    }

    await logAction(user, "update_budget", "budgets", id, updates);
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
    console.error("updateBudget error:", err);
    res.status(500).json({ success: false, error: "Failed to update budget" });
  }
});

// POST /api/budget/delete — deletes a budget line and logs the action.
const deleteBudgetSchema = z.object({
  id: z.string().uuid(),
});

budgetRouter.post("/delete", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = deleteBudgetSchema.parse(req.body);

    const { error } = await supabaseServer.from("budgets").delete().eq("id", data.id);
    if (error) {
      res.json({ success: false, error: "Failed to delete budget" });
      return;
    }

    await logAction(user, "delete_budget", "budgets", data.id, {});
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
    console.error("deleteBudget error:", err);
    res.status(500).json({ success: false, error: "Failed to delete budget" });
  }
});
