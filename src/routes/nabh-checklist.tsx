// NABH pre-accreditation checklist — mapping construction activities to NABH compliance criteria.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchNabhChecklist,
  createNabhItem,
  updateNabhItem,
  deleteNabhItem,
} from "@/lib/api/nabh-checklist";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  CircleDot,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/nabh-checklist")({
  head: () => ({
    meta: [
      { title: "NABH Pre-Accreditation Checklist — Meditrust ERP" },
      {
        name: "description",
        content:
          "Track NABH compliance items: fire safety, electrical safety, bio-medical waste, accessibility and infrastructure.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: NabhChecklistPage,
});

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "danger"> = {
  Completed: "success",
  "In Progress": "warning",
  Pending: "info",
  "Not Applicable": "danger",
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  Completed: CheckCircle2,
  "In Progress": CircleDot,
  Pending: Clock,
  "Not Applicable": XCircle,
};

// Main NABH checklist page with category grouping, progress summary and CRUD dialog.
function NabhChecklistPage() {
  const queryClient = useQueryClient();
  const { data: nabhData } = useQuery({
    queryKey: ["nabh"],
    queryFn: () => fetchNabhChecklist({ data: {} }),
  });
  const items = nabhData?.data ?? [];

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [form, setForm] = useState({
    category: "",
    item: "",
    status: "Pending" as string,
    responsible_party: "",
    completed_date: "",
    expiry_date: "",
    notes: "",
  });

  const today = new Date().toISOString().slice(0, 10);

  const openCreate = () => {
    setEditing(null);
    setForm({
      category: "",
      item: "",
      status: "Pending",
      responsible_party: "",
      completed_date: "",
      expiry_date: "",
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      category: item.category ?? "",
      item: item.item ?? "",
      status: item.status ?? "Pending",
      responsible_party: item.responsible_party ?? "",
      completed_date: item.completed_date
        ? new Date(item.completed_date).toISOString().slice(0, 10)
        : "",
      expiry_date: item.expiry_date ? new Date(item.expiry_date).toISOString().slice(0, 10) : "",
      notes: item.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.category.trim() || !form.item.trim()) {
      toast.error("Category and item are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: form.category.trim(),
        item: form.item.trim(),
        status: form.status as "Pending" | "In Progress" | "Completed" | "Not Applicable",
        responsible_party: form.responsible_party.trim() || undefined,
        completed_date:
          form.status === "Completed"
            ? form.completed_date || today
            : form.completed_date || undefined,
        expiry_date: form.expiry_date || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (editing) {
        const result = await updateNabhItem({ data: { id: editing.id, ...payload } });
        if (result.success) {
          toast.success("Checklist item updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["nabh"] });
        } else {
          toast.error(result.error ?? "Failed to update item");
        }
      } else {
        const result = await createNabhItem({ data: payload });
        if (result.success) {
          toast.success("Checklist item created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["nabh"] });
        } else {
          toast.error(result.error ?? "Failed to create item");
        }
      }
    } catch {
      toast.error("Failed to save item");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const result = await deleteNabhItem({ data: { id } });
      if (result.success) {
        toast.success("Item deleted");
        queryClient.invalidateQueries({ queryKey: ["nabh"] });
      } else {
        toast.error(result.error ?? "Failed to delete item");
      }
    } catch {
      toast.error("Failed to delete item");
    }
    setDeleting(null);
  };

  const filtered = items.filter((item: any) => {
    if (filterStatus !== "all" && item.status !== filterStatus) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      item.item?.toLowerCase().includes(s) ||
      item.category?.toLowerCase().includes(s) ||
      item.responsible_party?.toLowerCase().includes(s)
    );
  });

  // Group by category
  const categories = [...new Set(filtered.map((i: any) => i.category))];
  const grouped = categories.map((cat) => ({
    category: cat,
    items: filtered.filter((i: any) => i.category === cat),
  }));

  // Overall progress
  const totalItems = items.length;
  const completedItems = items.filter((i: any) => i.status === "Completed").length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <AppShell
      title="NABH pre-accreditation checklist"
      subtitle="Construction compliance mapped to NABH accreditation criteria"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Completed">Completed</SelectItem>
              <SelectItem value="Not Applicable">Not Applicable</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add item
        </Button>
      </div>

      {/* Progress summary */}
      {totalItems > 0 && (
        <Card className="mb-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Overall NABH compliance progress</p>
              <p className="text-xs text-muted-foreground">
                {completedItems} of {totalItems} items completed ({progressPct}%)
              </p>
            </div>
            <div className="flex items-center gap-3">
              {Object.entries(
                items.reduce(
                  (acc: Record<string, number>, i: any) => {
                    acc[i.status] = (acc[i.status] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>,
                ),
              ).map(([status, count]) => (
                <div key={status} className="text-center">
                  <p className="text-lg font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground">{status}</p>
                </div>
              ))}
            </div>
          </div>
          <Progress value={progressPct} className="mt-3 h-2" />
        </Card>
      )}

      {/* Category groups */}
      <div className="space-y-4">
        {grouped.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No checklist items. Click "Add item" to create one.
          </Card>
        )}
        {grouped.map((group) => {
          const catTotal = group.items.length;
          const catCompleted = group.items.filter((i: any) => i.status === "Completed").length;
          const catPct = catTotal > 0 ? Math.round((catCompleted / catTotal) * 100) : 0;
          return (
            <Card key={group.category} className="p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{group.category}</p>
                  <p className="text-xs text-muted-foreground">
                    {catCompleted}/{catTotal} completed
                  </p>
                </div>
                <div className="w-32">
                  <Progress value={catPct} className="h-2" />
                </div>
              </div>
              <div className="space-y-2">
                {group.items.map((item: any) => {
                  const Icon = STATUS_ICON[item.status] ?? Clock;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <Icon
                        className={`size-4 shrink-0 ${
                          item.status === "Completed"
                            ? "text-success"
                            : item.status === "In Progress"
                              ? "text-warning"
                              : item.status === "Not Applicable"
                                ? "text-muted-foreground"
                                : "text-info"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{item.item}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.responsible_party ?? "Unassigned"}
                          {item.completed_date &&
                            ` · completed ${new Date(item.completed_date).toLocaleDateString("en-IN")}`}
                          {item.expiry_date &&
                            ` · expires ${new Date(item.expiry_date).toLocaleDateString("en-IN")}`}
                        </p>
                        {item.notes && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
                        )}
                      </div>
                      <StatusPill tone={STATUS_TONE[item.status] ?? "info"}>
                        {item.status}
                      </StatusPill>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(item.id)}
                          disabled={deleting === item.id}
                        >
                          {deleting === item.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit checklist item" : "Add checklist item"}</DialogTitle>
            <DialogDescription>Track a NABH compliance requirement.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="n-cat">Category *</Label>
                <Input
                  id="n-cat"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Fire Safety, Electrical Safety"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                    <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-item">Item *</Label>
              <Input
                id="n-item"
                value={form.item}
                onChange={(e) => setForm({ ...form, item: e.target.value })}
                placeholder="e.g. NOC from Fire Department"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="n-party">Responsible party</Label>
                <Input
                  id="n-party"
                  value={form.responsible_party}
                  onChange={(e) => setForm({ ...form, responsible_party: e.target.value })}
                  placeholder="e.g. Civil Team"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="n-completed">Completed date</Label>
                <Input
                  id="n-completed"
                  type="date"
                  value={form.completed_date}
                  onChange={(e) => setForm({ ...form, completed_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-expiry">Expiry date</Label>
              <Input
                id="n-expiry"
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-notes">Notes</Label>
              <Textarea
                id="n-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Additional notes"
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
              {editing ? "Update item" : "Create item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
