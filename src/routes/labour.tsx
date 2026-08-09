// Labour attendance entry (Supervisor) + manpower cost dashboard (Admin)
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchAttendance,
  markAttendance,
  updateAttendance,
  getManpowerCostSummary,
} from "@/lib/api/labour";
import { fetchWorkCategories } from "@/lib/api/work-categories";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { useOfflineSync } from "@/lib/useOfflineSync";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import { Plus, Search, Loader2, Users, TrendingUp, Wallet, Pencil } from "lucide-react";

export const Route = createFileRoute("/labour")({
  head: () => ({
    meta: [
      { title: "Labour Attendance — Meditrust ERP" },
      {
        name: "description",
        content: "Daily labour attendance tracking and manpower cost analysis.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: LabourPage,
});

function LabourPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const isAdmin = role === "Administrator" || role === "A1" || role === "A1+";
  const { withOfflineQueue } = useOfflineSync();

  const tourSteps: TourStep[] = isAdmin
    ? [
        {
          selector: '[data-tour="lab-headcount"]',
          title: "Total Headcount",
          description:
            "Current total workers on site — skilled and unskilled combined. Use this to verify your daily manpower deployment.",
        },
        {
          selector: '[data-tour="lab-budget"]',
          title: "Total Budget",
          description:
            "Approved manpower budget across all work categories — compare against Est. Manpower Cost to check if you're over budget.",
        },
        {
          selector: '[data-tour="lab-outstanding"]',
          title: "Vendor Outstanding",
          description:
            "Unpaid contractor invoices for labour — track this to avoid payment delays that could cause labour shortages.",
        },
        {
          selector: '[data-tour="lab-est-cost"]',
          title: "Est. Manpower Cost",
          description:
            "Calculated manpower cost based on headcount and wage rates — compare this against your budget to control spend.",
        },
        {
          selector: '[data-tour="lab-search"]',
          title: "Search Contractor",
          description: "Type a contractor name to find their attendance records quickly.",
        },
        {
          selector: '[data-tour="lab-cat-filter"]',
          title: "Work Category Filter",
          description:
            "Narrow records to a specific work category like Civil, Electrical, or Plumbing to review category-wise attendance.",
        },
        {
          selector: '[data-tour="lab-from-date"]',
          title: "From Date",
          description:
            "Set a start date to filter attendance records within a specific date range.",
        },
        {
          selector: '[data-tour="lab-to-date"]',
          title: "To Date",
          description: "Set an end date to filter attendance records within a specific date range.",
        },
        {
          selector: '[data-tour="lab-create"]',
          title: "Mark Attendance",
          description:
            "Record today's headcount for a contractor — enter skilled and unskilled counts separately for accurate cost tracking.",
        },
        {
          selector: '[data-tour="lab-edit"]',
          title: "Edit Attendance",
          description:
            "Click the pencil icon to correct a past attendance entry if the headcount was recorded incorrectly.",
        },
      ]
    : [
        {
          selector: '[data-tour="lab-search"]',
          title: "Search Contractor",
          description: "Type a contractor name to find their attendance records quickly.",
        },
        {
          selector: '[data-tour="lab-cat-filter"]',
          title: "Work Category Filter",
          description:
            "Narrow records to a specific work category like Civil, Electrical, or Plumbing.",
        },
        {
          selector: '[data-tour="lab-from-date"]',
          title: "From Date",
          description:
            "Set a start date to filter attendance records within a specific date range.",
        },
        {
          selector: '[data-tour="lab-to-date"]',
          title: "To Date",
          description: "Set an end date to filter attendance records within a specific date range.",
        },
        {
          selector: '[data-tour="lab-create"]',
          title: "Mark Attendance",
          description:
            "Record today's headcount for a contractor — enter skilled and unskilled counts separately. Works offline and syncs when reconnected.",
        },
        {
          selector: '[data-tour="lab-edit"]',
          title: "Edit Attendance",
          description: "Click the pencil icon to correct a past attendance entry you've submitted.",
        },
      ];

  const [search, setSearch] = useState("");
  const [workCatFilter, setWorkCatFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    work_category: "uncategorized",
    contractor_name: "",
    headcount_skilled: "0",
    headcount_unskilled: "0",
    notes: "",
  });

  const { data: attData, isLoading } = useQuery({
    queryKey: ["attendance", search, workCatFilter, fromDate, toDate],
    queryFn: () =>
      fetchAttendance({
        ...(workCatFilter !== "all" && { workCategory: workCatFilter }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(search && { contractorName: search }),
      }),
  });

  const { data: catData } = useQuery({
    queryKey: ["workCategories"],
    queryFn: () => fetchWorkCategories(),
  });
  const categories = catData?.data ?? [];

  const { data: costData } = useQuery({
    queryKey: ["manpowerCost", fromDate, toDate, workCatFilter],
    queryFn: () =>
      getManpowerCostSummary({
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(workCatFilter !== "all" && { workCategory: workCatFilter }),
      }),
    enabled: isAdmin,
  });

  const records = attData?.data ?? [];

  function openCreate() {
    setEditing(null);
    setForm({
      date: new Date().toISOString().slice(0, 10),
      work_category: "uncategorized",
      contractor_name: "",
      headcount_skilled: "0",
      headcount_unskilled: "0",
      notes: "",
    });
    setDialogOpen(true);
  }

  function openEdit(rec: any) {
    setEditing(rec);
    setForm({
      date: rec.date ? new Date(rec.date).toISOString().slice(0, 10) : "",
      work_category: rec.work_category ?? "uncategorized",
      contractor_name: rec.contractor_name ?? "",
      headcount_skilled: String(rec.headcount_skilled ?? 0),
      headcount_unskilled: String(rec.headcount_unskilled ?? 0),
      notes: rec.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.contractor_name.trim()) {
      toast.error("Contractor name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        work_category: form.work_category,
        contractor_name: form.contractor_name.trim(),
        headcount_skilled: parseInt(form.headcount_skilled, 10) || 0,
        headcount_unskilled: parseInt(form.headcount_unskilled, 10) || 0,
        notes: form.notes.trim() || undefined,
      };

      if (editing) {
        const result = await updateAttendance({ id: editing.id, ...payload } as any);
        if (result.success) {
          toast.success("Attendance updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["attendance"] });
          queryClient.invalidateQueries({ queryKey: ["manpowerCost"] });
        } else {
          toast.error(result.error ?? "Failed to update attendance");
        }
      } else {
        const result = await withOfflineQueue("labour-attendance", payload, () =>
          markAttendance(payload as any),
        );
        if ("queued" in result) {
          setDialogOpen(false);
        } else if (result.success) {
          toast.success("Attendance marked");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["attendance"] });
          queryClient.invalidateQueries({ queryKey: ["manpowerCost"] });
        } else {
          toast.error(result.error ?? "Failed to mark attendance");
        }
      }
    } catch {
      toast.error("Failed to save attendance");
    }
    setSaving(false);
  }

  return (
    <AppShell
      title="Labour Attendance"
      subtitle="Daily headcount tracking and manpower cost analysis"
    >
      <div className="mb-4 flex items-center justify-end">
        <SectionTour sectionKey="labour" steps={tourSteps} />
      </div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contractor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 pl-9"
            data-tour="lab-search"
          />
        </div>
        <Select value={workCatFilter} onValueChange={setWorkCatFilter}>
          <SelectTrigger className="w-40" data-tour="lab-cat-filter">
            <SelectValue placeholder="Work category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c: any) => (
              <SelectItem key={c.id} value={c.name}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="w-40"
          data-tour="lab-from-date"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="w-40"
          data-tour="lab-to-date"
        />
        <Button size="sm" onClick={openCreate} className="ml-auto" data-tour="lab-create">
          <Plus className="mr-1.5 size-4" /> Mark attendance
        </Button>
      </div>

      {/* Admin: Manpower cost dashboard */}
      {isAdmin && costData && (costData as any).summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4" data-tour="lab-headcount">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="size-4" />
              <span className="text-xs font-medium">Total Headcount</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{(costData as any).summary.total_headcount}</p>
            <p className="text-xs text-muted-foreground">
              {(costData as any).summary.total_skilled} skilled ·{" "}
              {(costData as any).summary.total_unskilled} unskilled
            </p>
          </Card>
          <Card className="p-4" data-tour="lab-budget">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="size-4" />
              <span className="text-xs font-medium">Total Budget</span>
            </div>
            <p className="mt-2 text-2xl font-bold">
              ₹{((costData as any).summary.total_budget ?? 0).toLocaleString("en-IN")}
            </p>
          </Card>
          <Card className="p-4" data-tour="lab-outstanding">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="size-4" />
              <span className="text-xs font-medium">Vendor Outstanding</span>
            </div>
            <p className="mt-2 text-2xl font-bold">
              ₹{((costData as any).summary.total_vendor_outstanding ?? 0).toLocaleString("en-IN")}
            </p>
          </Card>
          <Card className="p-4" data-tour="lab-est-cost">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="size-4" />
              <span className="text-xs font-medium">Est. Manpower Cost</span>
            </div>
            <p className="mt-2 text-2xl font-bold">
              ₹
              {((costData as any).summary.estimated_total_manpower_cost ?? 0).toLocaleString(
                "en-IN",
              )}
            </p>
          </Card>

          {/* Category breakdown */}
          {Array.isArray((costData as any).by_category) &&
            (costData as any).by_category.length > 0 && (
              <Card className="p-4 sm:col-span-2 lg:col-span-4">
                <p className="mb-3 text-sm font-semibold">Cost by Work Category</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Skilled</TableHead>
                      <TableHead className="text-right">Unskilled</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Budget</TableHead>
                      <TableHead className="text-right">Est. Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(costData as any).by_category.map((c: any) => (
                      <TableRow key={c.work_category}>
                        <TableCell className="font-medium">{c.work_category}</TableCell>
                        <TableCell className="text-right">{c.headcount_skilled}</TableCell>
                        <TableCell className="text-right">{c.headcount_unskilled}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {c.total_headcount}
                        </TableCell>
                        <TableCell className="text-right">
                          ₹{(c.category_budget ?? 0).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right">
                          ₹{(c.estimated_manpower_cost ?? 0).toLocaleString("en-IN")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
        </div>
      )}

      {/* Attendance table */}
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Contractor</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Skilled</TableHead>
              <TableHead className="text-right">Unskilled</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Marked by</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && records.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No attendance records. Click "Mark attendance" to add one.
                </TableCell>
              </TableRow>
            )}
            {records.map((rec: any) => (
              <TableRow key={rec.id}>
                <TableCell>
                  {rec.date ? new Date(rec.date).toLocaleDateString("en-IN") : "—"}
                </TableCell>
                <TableCell className="font-medium">{rec.contractor_name}</TableCell>
                <TableCell>
                  <StatusPill tone="info">{rec.work_category}</StatusPill>
                </TableCell>
                <TableCell className="text-right">{rec.headcount_skilled}</TableCell>
                <TableCell className="text-right">{rec.headcount_unskilled}</TableCell>
                <TableCell className="text-right font-semibold">
                  {(rec.headcount_skilled ?? 0) + (rec.headcount_unskilled ?? 0)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {rec.marked_by_name ?? "—"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(rec)}
                    data-tour="lab-edit"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit attendance" : "Mark attendance"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update attendance record" : "Record daily labour headcount by contractor"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="att-date">Date *</Label>
                <Input
                  id="att-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Work category</Label>
                <Select
                  value={form.work_category}
                  onValueChange={(v) => setForm({ ...form, work_category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c: any) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="att-contractor">Contractor name *</Label>
              <Input
                id="att-contractor"
                value={form.contractor_name}
                onChange={(e) => setForm({ ...form, contractor_name: e.target.value })}
                placeholder="e.g. Meenakshi Steels"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="att-skilled">Skilled headcount</Label>
                <Input
                  id="att-skilled"
                  type="number"
                  min="0"
                  value={form.headcount_skilled}
                  onChange={(e) => setForm({ ...form, headcount_skilled: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="att-unskilled">Unskilled headcount</Label>
                <Input
                  id="att-unskilled"
                  type="number"
                  min="0"
                  value={form.headcount_unskilled}
                  onChange={(e) => setForm({ ...form, headcount_unskilled: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="att-notes">Notes</Label>
              <Textarea
                id="att-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes"
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
              {editing ? "Update" : "Mark attendance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
