// Budget vs Actual dashboard — project budgets by block/category with variance and utilisation.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { fetchBudgets, createBudget, updateBudget, deleteBudget } from "@/lib/api/budget";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  IndianRupee,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/budget")({
  head: () => ({
    meta: [
      { title: "Budget vs Actual — Meditrust ERP" },
      {
        name: "description",
        content:
          "Project budgets by block and category with variance, utilisation and committed spend.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: BudgetPage,
});

// Formats a number as Indian Rupees with lakh/crore grouping.
function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Main budget page with summary cards, budget table and create/edit dialog.
function BudgetPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["budgets"], queryFn: () => fetchBudgets() });
  const budgets = (data?.data ?? []) as any[];
  const summary = (data as any)?.summary;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [form, setForm] = useState({
    block: "",
    category: "",
    description: "",
    budgeted_amount: "",
    fiscal_year: String(new Date().getFullYear()),
    notes: "",
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      block: "",
      category: "",
      description: "",
      budgeted_amount: "",
      fiscal_year: String(new Date().getFullYear()),
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (b: any) => {
    setEditing(b);
    setForm({
      block: b.block ?? "",
      category: b.category ?? "",
      description: b.description ?? "",
      budgeted_amount: String(b.budgeted_amount ?? ""),
      fiscal_year: b.fiscal_year ?? String(new Date().getFullYear()),
      notes: b.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.description.trim() || !form.budgeted_amount) {
      toast.error("Description and budgeted amount are required");
      return;
    }
    if (!form.block.trim() && !form.category.trim()) {
      toast.error("At least block or category is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        block: form.block.trim() || undefined,
        category: form.category.trim() || undefined,
        description: form.description.trim(),
        budgeted_amount: Number(form.budgeted_amount),
        fiscal_year: form.fiscal_year,
        notes: form.notes.trim() || undefined,
      };

      if (editing) {
        const result = await updateBudget({ id: editing.id, ...payload });
        if (result.success) {
          toast.success("Budget updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["budgets"] });
        } else {
          toast.error(result.error ?? "Failed to update budget");
        }
      } else {
        const result = await createBudget(payload);
        if (result.success) {
          toast.success("Budget created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["budgets"] });
        } else {
          toast.error(result.error ?? "Failed to create budget");
        }
      }
    } catch {
      toast.error("Failed to save budget");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const result = await deleteBudget({ id });
      if (result.success) {
        toast.success("Budget deleted");
        queryClient.invalidateQueries({ queryKey: ["budgets"] });
      } else {
        toast.error(result.error ?? "Failed to delete budget");
      }
    } catch {
      toast.error("Failed to delete budget");
    }
    setDeleting(null);
  };

  return (
    <AppShell
      title="Budget vs actual"
      subtitle="Project budgets by block and category with variance and utilisation"
    >
      {/* Summary cards */}
      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="size-4" />
              <p className="text-xs font-medium">Total budget</p>
            </div>
            <p className="mt-2 text-2xl font-bold">₹{formatINR(summary.total_budget)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <IndianRupee className="size-4" />
              <p className="text-xs font-medium">Committed spend</p>
            </div>
            <p className="mt-2 text-2xl font-bold">₹{formatINR(summary.total_committed)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              {summary.overall_variance >= 0 ? (
                <TrendingUp className="size-4 text-success" />
              ) : (
                <TrendingDown className="size-4 text-destructive" />
              )}
              <p className="text-xs font-medium">Variance</p>
            </div>
            <p
              className={`mt-2 text-2xl font-bold ${summary.overall_variance >= 0 ? "text-success" : "text-destructive"}`}
            >
              ₹{formatINR(Math.abs(summary.overall_variance))}
            </p>
            <p className="text-xs text-muted-foreground">
              {summary.overall_variance >= 0 ? "under budget" : "over budget"}
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="size-4" />
              <p className="text-xs font-medium">Utilisation</p>
            </div>
            <p className="mt-2 text-2xl font-bold">{summary.overall_utilisation_pct}%</p>
            <Progress value={summary.overall_utilisation_pct} className="mt-2 h-1.5" />
          </Card>
        </div>
      )}

      {/* Budget table */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {budgets.length} budget line{budgets.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add budget
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Block</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 text-right font-medium">Budgeted</th>
                <th className="px-4 py-3 text-right font-medium">Actual</th>
                <th className="px-4 py-3 text-right font-medium">Variance</th>
                <th className="px-4 py-3 font-medium">Utilisation</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {budgets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No budget lines. Click "Add budget" to create one.
                  </td>
                </tr>
              )}
              {budgets.map((b: any) => {
                const variance = b.variance ?? 0;
                const utilisation = b.utilisation_pct ?? 0;
                return (
                  <tr key={b.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3 font-medium">{b.block ?? "—"}</td>
                    <td className="px-4 py-3">{b.category ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.description}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      ₹{formatINR(b.budgeted_amount ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-right">₹{formatINR(b.actual_amount ?? 0)}</td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${variance >= 0 ? "text-success" : "text-destructive"}`}
                    >
                      {variance >= 0 ? "+" : "−"}₹{formatINR(Math.abs(variance))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={Math.min(utilisation, 100)} className="h-1.5 w-20" />
                        <span
                          className={`text-xs ${utilisation > 90 ? "text-destructive" : utilisation > 75 ? "text-warning" : "text-muted-foreground"}`}
                        >
                          {utilisation}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(b.id)}
                          disabled={deleting === b.id}
                        >
                          {deleting === b.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {budgets.length > 0 && (
              <tfoot className="border-t border-border bg-surface text-sm font-bold">
                <tr>
                  <td className="px-4 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right">₹{formatINR(summary?.total_budget ?? 0)}</td>
                  <td className="px-4 py-3 text-right">
                    ₹{formatINR(summary?.total_committed ?? 0)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${(summary?.overall_variance ?? 0) >= 0 ? "text-success" : "text-destructive"}`}
                  >
                    {(summary?.overall_variance ?? 0) >= 0 ? "+" : "−"}₹
                    {formatINR(Math.abs(summary?.overall_variance ?? 0))}
                  </td>
                  <td className="px-4 py-3" colSpan={2}>
                    {summary?.overall_utilisation_pct ?? 0}%
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit budget" : "Add budget"}</DialogTitle>
            <DialogDescription>Set a budget line for a block or category.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-block">Block</Label>
                <Input
                  id="b-block"
                  value={form.block}
                  onChange={(e) => setForm({ ...form, block: e.target.value })}
                  placeholder="e.g. OT Block"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-cat">Category</Label>
                <Input
                  id="b-cat"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Civil, MEP"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-desc">Description *</Label>
              <Input
                id="b-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Budget description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-amt">Budgeted amount (₹) *</Label>
                <Input
                  id="b-amt"
                  type="number"
                  value={form.budgeted_amount}
                  onChange={(e) => setForm({ ...form, budgeted_amount: e.target.value })}
                  placeholder="8500000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-fy">Fiscal year</Label>
                <Input
                  id="b-fy"
                  value={form.fiscal_year}
                  onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}
                  placeholder="2026"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-notes">Notes</Label>
              <Textarea
                id="b-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Budget notes"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              {editing ? "Update budget" : "Create budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
