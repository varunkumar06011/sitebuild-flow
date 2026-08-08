// Work Order management page — create, list, edit, preview, send via WhatsApp, assign supervisor, change status.
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
  fetchWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  updateWorkOrderStatus,
  buildWorkOrderWhatsAppMessage,
  type WorkOrderRow,
} from "@/lib/api/work-orders";
import { fetchBlocks } from "@/lib/api/inventory";
import { fetchSupervisors } from "@/lib/api/work-orders";
import { fetchOrgSettings } from "@/lib/api/settings";
import { WorkCategorySelect, WorkCategoryBadge } from "@/components/WorkCategory";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { inr } from "@/lib/erp-data";
import { toast } from "sonner";
import {
  Plus,
  Search,
  ClipboardList,
  Pencil,
  Eye,
  Send,
  X,
  Loader2,
  AlertCircle,
  FileText,
  UserCheck,
} from "lucide-react";

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "Completed":
    case "Closed":
    case "Approved":
      return "success";
    case "Sent":
    case "Assigned":
    case "In Progress":
      return "info";
    case "Draft":
      return "neutral";
    case "Cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const Route = createFileRoute("/work-orders")({
  head: () => ({
    meta: [
      { title: "Work Orders — Meditrust ERP" },
      {
        name: "description",
        content: "Create and manage work orders with cost tracking and supervisor assignment.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: WorkOrdersPage,
});

const STATUS_OPTIONS = ["Draft", "Sent", "Approved", "Assigned", "In Progress", "Completed", "Closed", "Cancelled"] as const;

type CostRow = {
  description: string;
  quantity: string;
  taxable: boolean;
  unit_price: string;
};

function emptyCostRow(): CostRow {
  return { description: "", quantity: "1", taxable: false, unit_price: "0" };
}

function WorkOrdersPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const canEdit = role === "Administrator" || role === "A1" || role === "A1+";
  const isSupervisor = role === "Supervisor";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [workCatFilter, setWorkCatFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrderRow | null>(null);
  const [previewOrder, setPreviewOrder] = useState<WorkOrderRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    block_id: "",
    project_name: "",
    site_name: "",
    site_address: "",
    customer_name: "",
    customer_id: "",
    customer_contact: "",
    billing_address: "",
    billing_city: "",
    billing_state: "",
    billing_pincode: "",
    customer_phone: "",
    customer_email: "",
    department: "",
    work_description: "",
    payment_terms: "",
    due_date: "",
    comments: "",
    assigned_supervisor_id: "",
    work_category: "uncategorized",
  });
  const [costItems, setCostItems] = useState<CostRow[]>([emptyCostRow()]);

  // Queries
  const { data: ordersData, isLoading, isError, error } = useQuery({
    queryKey: ["workOrders", search, statusFilter, workCatFilter],
    queryFn: () => fetchWorkOrders({ data: { search: search || undefined, status: statusFilter !== "all" ? statusFilter : undefined, workCategory: workCatFilter !== "all" ? workCatFilter : undefined } as any }),
  });

  const { data: blocksData } = useQuery({
    queryKey: ["blocks"],
    queryFn: () => fetchBlocks({ data: {} }),
  });

  const { data: supervisorsData } = useQuery({
    queryKey: ["supervisors"],
    queryFn: () => fetchSupervisors({ data: {} }),
  });

  const { data: orgData } = useQuery({
    queryKey: ["orgSettings"],
    queryFn: () => fetchOrgSettings(),
  });

  const org = orgData?.success ? orgData.data : null;
  const blocks = blocksData?.data ?? [];
  const supervisors = supervisorsData?.data ?? [];
  const orders = ordersData?.data ?? [];


  function openCreate() {
    setEditing(null);
    setForm({
      block_id: "", project_name: "", site_name: "", site_address: "",
      customer_name: "", customer_id: "", customer_contact: "",
      billing_address: "", billing_city: "", billing_state: "", billing_pincode: "",
      customer_phone: "", customer_email: "", department: "",
      work_description: "", payment_terms: "", due_date: "", comments: "",
      assigned_supervisor_id: "",
      work_category: "uncategorized",
    });
    setCostItems([emptyCostRow()]);
    setDialogOpen(true);
  }

  function openEdit(order: WorkOrderRow) {
    setEditing(order);
    setForm({
      block_id: order.block_id ?? "",
      project_name: order.project_name ?? "",
      site_name: order.site_name ?? "",
      site_address: order.site_address ?? "",
      customer_name: order.customer_name ?? "",
      customer_id: order.customer_id ?? "",
      customer_contact: order.customer_contact ?? "",
      billing_address: order.billing_address ?? "",
      billing_city: order.billing_city ?? "",
      billing_state: order.billing_state ?? "",
      billing_pincode: order.billing_pincode ?? "",
      customer_phone: order.customer_phone ?? "",
      customer_email: order.customer_email ?? "",
      department: order.department ?? "",
      work_description: order.work_description ?? "",
      payment_terms: order.payment_terms ?? "",
      due_date: order.due_date ?? "",
      comments: order.comments ?? "",
      assigned_supervisor_id: order.assigned_supervisor_id ?? "",
      work_category: order.work_category ?? "uncategorized",
    });
    setCostItems(order.items.map((it) => ({
      description: it.description,
      quantity: String(it.quantity),
      taxable: it.taxable,
      unit_price: String(it.unit_price),
    })));
    setDialogOpen(true);
  }

  function addCostRow() {
    setCostItems([...costItems, emptyCostRow()]);
  }

  function removeCostRow(idx: number) {
    if (costItems.length === 1) {
      toast.error("At least one work/cost entry is required");
      return;
    }
    setCostItems(costItems.filter((_, i) => i !== idx));
  }

  function updateCostRow(idx: number, field: keyof CostRow, value: string | boolean) {
    setCostItems(costItems.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function validate(): string | null {
    if (!form.project_name.trim() && !form.block_id) return "Project is required";
    if (!form.work_description.trim()) return "Work description is required";
    if (costItems.length === 0) return "At least one work/cost entry is required";
    for (const [i, row] of costItems.entries()) {
      if (!row.description.trim()) return `Row ${i + 1}: Description is required`;
      const qty = parseFloat(row.quantity);
      if (!qty || qty <= 0) return `Row ${i + 1}: Valid quantity is required`;
      const price = parseFloat(row.unit_price);
      if (isNaN(price) || price < 0) return `Row ${i + 1}: Valid unit price is required`;
    }
    return null;
  }

  async function handleSave(sendWhatsApp: boolean) {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        block_id: form.block_id || null,
        project_name: form.project_name || undefined,
        site_name: form.site_name || undefined,
        site_address: form.site_address || undefined,
        customer_name: form.customer_name || undefined,
        customer_id: form.customer_id || undefined,
        customer_contact: form.customer_contact || undefined,
        billing_address: form.billing_address || undefined,
        billing_city: form.billing_city || undefined,
        billing_state: form.billing_state || undefined,
        billing_pincode: form.billing_pincode || undefined,
        customer_phone: form.customer_phone || undefined,
        customer_email: form.customer_email || undefined,
        department: form.department || undefined,
        work_description: form.work_description || undefined,
        payment_terms: form.payment_terms || undefined,
        due_date: form.due_date || null,
        comments: form.comments || undefined,
        assigned_supervisor_id: form.assigned_supervisor_id || null,
        work_category: form.work_category,
        items: costItems.map((it) => ({
          description: it.description,
          quantity: parseFloat(it.quantity),
          taxable: it.taxable,
          unit_price: parseFloat(it.unit_price),
        })),
      };

      let result: any;
      if (editing) {
        result = await updateWorkOrder({ data: { id: editing.id, ...payload } });
      } else {
        result = await createWorkOrder({ data: payload });
      }

      if (!result.success) {
        toast.error(result.error ?? "Failed to save work order");
        setSaving(false);
        return;
      }

      if (sendWhatsApp && result.id) {
        await updateWorkOrderStatus({ data: { id: result.id, status: "Sent" } });
      }

      toast.success(editing ? "Work order updated" : `Work order ${result.order_number ?? ""} created`);
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });

      if (sendWhatsApp) {
        const orderRow: WorkOrderRow = {
          id: result.id ?? editing?.id ?? "",
          order_number: result.order_number ?? editing?.order_number ?? "",
          order_date: new Date().toISOString(),
          status: "Sent",
          block_id: form.block_id || null,
          project_name: form.project_name || null,
          project_id: form.block_id || null,
          site_name: form.site_name || null,
          site_address: form.site_address || null,
          customer_name: form.customer_name || null,
          customer_id: form.customer_id || null,
          customer_contact: form.customer_contact || null,
          billing_address: form.billing_address || null,
          billing_city: form.billing_city || null,
          billing_state: form.billing_state || null,
          billing_pincode: form.billing_pincode || null,
          customer_phone: form.customer_phone || null,
          customer_email: form.customer_email || null,
          requested_by: "",
          requested_by_name: null,
          department: form.department || null,
          assigned_supervisor_id: form.assigned_supervisor_id || null,
          assigned_supervisor_name: supervisors.find((s: any) => s.id === form.assigned_supervisor_id)?.name ?? null,
          assigned_at: null,
          work_description: form.work_description || null,
          subtotal: 0,
          taxable_amount: 0,
          tax_rate: 0,
          tax_amount: 0,
          shipping_handling: 0,
          other_charges: 0,
          grand_total: 0,
          payment_terms: form.payment_terms || null,
          due_date: form.due_date || null,
          advance_amount: 0,
          balance_due: 0,
          comments: form.comments || null,
          work_category: form.work_category,
          completed_date: null,
          completed_by_name: null,
          customer_acknowledgement: null,
          pdf_path: null,
          items: [],
          created_at: "",
          updated_at: "",
        };
        const message = buildWorkOrderWhatsAppMessage(orderRow);
        const phone = form.customer_phone?.replace(/[^0-9]/g, "") ?? "";
        if (!phone) {
          toast.warning("Work order saved, but no customer phone number to send WhatsApp.");
        } else {
          const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
          window.open(waUrl, "_blank");
        }
      }

      setDialogOpen(false);
      setSaving(false);
    } catch (err) {
      toast.error("Unable to save work order. Please try again.");
      setSaving(false);
    }
  }

  async function handleStatusChange(order: WorkOrderRow, newStatus: string) {
    const result = await updateWorkOrderStatus({ data: { id: order.id, status: newStatus as any } });
    if (result.success) {
      toast.success(`Status changed to ${newStatus}`);
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
    } else {
      toast.error(result.error ?? "Failed to change status");
    }
  }

  function handleWhatsAppSend(order: WorkOrderRow) {
    const phone = order.customer_phone?.replace(/[^0-9]/g, "") ?? "";
    if (!phone) {
      toast.error("No customer phone number on this order. Add a phone number to send via WhatsApp.");
      return;
    }
    const message = buildWorkOrderWhatsAppMessage(order);
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank");
  }

  // Supervisors get limited status options
  const availableStatuses = isSupervisor
    ? STATUS_OPTIONS.filter((s) => s === "In Progress" || s === "Completed")
    : STATUS_OPTIONS;

  return (
    <AppShell title="Work Orders" subtitle="Formal work instructions with cost tracking and supervisor assignment">
      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load work orders: {error?.message ?? "Unknown error"}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order number, project, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <WorkCategorySelect
          value={workCatFilter}
          onChange={setWorkCatFilter}
          placeholder="All categories"
          className="w-[180px]"
        />
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Work Order
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>WO Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Work</TableHead>
              <TableHead>Supervisor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  No work orders yet. {canEdit ? 'Click "New Work Order" to create one.' : "You have no assigned work orders."}
                </TableCell>
              </TableRow>
            )}
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.order_number}</TableCell>
                <TableCell>{new Date(order.order_date).toLocaleDateString()}</TableCell>
                <TableCell>{order.project_name ?? "—"}</TableCell>
                <TableCell>{order.customer_name ?? "—"}</TableCell>
                <TableCell><WorkCategoryBadge category={order.work_category} /></TableCell>
                <TableCell>{order.assigned_supervisor_name ?? "—"}</TableCell>
                <TableCell><StatusPill tone={statusTone(order.status)}>{order.status}</StatusPill></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setPreviewOrder(order)} title="View">
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && order.status !== "Closed" && order.status !== "Cancelled" && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(order)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleWhatsAppSend(order)} title="Send WhatsApp">
                      <Send className="h-4 w-4" />
                    </Button>
                    {(canEdit || isSupervisor) && (
                      <Select onValueChange={(v) => handleStatusChange(order, v)}>
                        <SelectTrigger className="h-8 w-[140px]">
                          <SelectValue placeholder="Change Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableStatuses.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.order_number}` : "New Work Order"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update work order details" : "Create a new work order with cost tracking"}
            </DialogDescription>
          </DialogHeader>

          {/* Company header preview */}
          {org && (
            <div className="rounded-lg border p-4 mb-4">
              <div className="flex items-center gap-3">
                {org.logo_url && <img src={org.logo_url} alt="logo" className="h-10 w-10 rounded" />}
                <div>
                  <p className="font-semibold">{org.name}</p>
                  <p className="text-sm text-muted-foreground">{org.address}, {org.city}, {org.state} - {org.pincode}</p>
                  <p className="text-sm text-muted-foreground">Phone: {org.phone} | Email: {org.email}</p>
                </div>
              </div>
            </div>
          )}

          {/* Project & Site */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <Label>Project / Block</Label>
              <Select value={form.block_id} onValueChange={(v) => {
                const block = blocks.find((b: any) => b.id === v);
                setForm({ ...form, block_id: v, project_name: block?.name ?? form.project_name });
              }}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {blocks.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project Name</Label>
              <Input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} />
            </div>
            <div>
              <Label>Site Name</Label>
              <Input value={form.site_name} onChange={(e) => setForm({ ...form, site_name: e.target.value })} />
            </div>
            <div>
              <Label>Site Address</Label>
              <Input value={form.site_address} onChange={(e) => setForm({ ...form, site_address: e.target.value })} />
            </div>
            <div>
              <Label>Department</Label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <Label>Work Category *</Label>
              <WorkCategorySelect
                value={form.work_category}
                onChange={(val) => setForm({ ...form, work_category: val })}
                placeholder="Select work category..."
              />
            </div>
            <div>
              <Label>Assign Supervisor</Label>
              <Select value={form.assigned_supervisor_id} onValueChange={(v) => setForm({ ...form, assigned_supervisor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select supervisor" /></SelectTrigger>
                <SelectContent>
                  {supervisors.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bill To / Customer */}
          <div className="rounded border p-3 mb-4">
            <p className="font-semibold mb-2">Bill To / Customer</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Customer Name</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
              <div><Label>Customer ID</Label><Input value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} /></div>
              <div><Label>Contact Person</Label><Input value={form.customer_contact} onChange={(e) => setForm({ ...form, customer_contact: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
              <div className="md:col-span-2"><Label>Billing Address</Label><Input value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></div>
              <div><Label>City</Label><Input value={form.billing_city} onChange={(e) => setForm({ ...form, billing_city: e.target.value })} /></div>
              <div><Label>State</Label><Input value={form.billing_state} onChange={(e) => setForm({ ...form, billing_state: e.target.value })} /></div>
              <div><Label>PIN</Label><Input value={form.billing_pincode} onChange={(e) => setForm({ ...form, billing_pincode: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} /></div>
            </div>
          </div>

          {/* Job Details */}
          <div className="mb-4">
            <Label>General Description of Work</Label>
            <Textarea
              value={form.work_description}
              onChange={(e) => setForm({ ...form, work_description: e.target.value })}
              placeholder="Describe the work to be performed..."
              rows={3}
            />
          </div>

          {/* Cost table */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label>Work / Cost Items</Label>
              <Button variant="outline" size="sm" onClick={addCostRow}><Plus className="mr-1 h-3 w-3" /> Add Row</Button>
            </div>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Description</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[80px]">Taxable</TableHead>
                    <TableHead className="w-[100px]">Unit Price</TableHead>
                    <TableHead className="w-[100px]">Total</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costItems.map((it, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Input value={it.description} onChange={(e) => updateCostRow(idx, "description", e.target.value)} placeholder="Description" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={it.quantity} onChange={(e) => updateCostRow(idx, "quantity", e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <input type="checkbox" checked={it.taxable} onChange={(e) => updateCostRow(idx, "taxable", e.target.checked)} className="h-4 w-4" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={it.unit_price} onChange={(e) => updateCostRow(idx, "unit_price", e.target.value)} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {inr((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0))}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeCostRow(idx)}>
                          <X className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Payment terms */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <Label>Payment Terms</Label>
              <Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. Net 30" />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>

          {/* Comments */}
          <div className="mb-4">
            <Label>Other Comments / Special Instructions</Label>
            <Textarea
              value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })}
              placeholder="Site instructions, safety requirements, completion notes..."
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => handleSave(false)} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Save
            </Button>
            <Button onClick={() => handleSave(true)} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Save & Send to WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewOrder} onOpenChange={(v) => !v && setPreviewOrder(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Work Order — {previewOrder?.order_number}</DialogTitle>
          </DialogHeader>
          {previewOrder && (
            <div className="space-y-4">
              {/* Company header */}
              {org && (
                <div className="border-b pb-3">
                  <p className="text-lg font-bold">{org.name}</p>
                  <p className="text-sm text-muted-foreground">{org.address}, {org.city}, {org.state} - {org.pincode}</p>
                  <p className="text-sm text-muted-foreground">Phone: {org.phone} | Email: {org.email}</p>
                  {org.gst_number && <p className="text-sm text-muted-foreground">GST: {org.gst_number}</p>}
                </div>
              )}

              <p className="text-center text-xl font-bold tracking-wider">WORK ORDER</p>

              {/* Order info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="font-semibold">Work Order Number</p><p>{previewOrder.order_number}</p></div>
                <div><p className="font-semibold">Date</p><p>{new Date(previewOrder.order_date).toLocaleDateString()}</p></div>
                <div><p className="font-semibold">Project</p><p>{previewOrder.project_name ?? "—"}</p></div>
                <div><p className="font-semibold">Site</p><p>{previewOrder.site_name ?? "—"}</p></div>
                <div><p className="font-semibold">Work Category</p><div className="mt-0.5"><WorkCategoryBadge category={previewOrder.work_category} /></div></div>
              </div>

              {/* Bill To */}
              <div className="rounded border p-3">
                <p className="font-semibold mb-1">Bill To</p>
                <p className="text-sm">{previewOrder.customer_name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">{previewOrder.billing_address ?? ""}, {previewOrder.billing_city ?? ""}</p>
                <p className="text-sm text-muted-foreground">Phone: {previewOrder.customer_phone ?? "—"} | Email: {previewOrder.customer_email ?? "—"}</p>
              </div>

              {/* Job details */}
              {previewOrder.work_description && (
                <div className="rounded border p-3">
                  <p className="font-semibold mb-1">Job Details</p>
                  <p className="text-sm whitespace-pre-wrap">{previewOrder.work_description}</p>
                </div>
              )}

              {/* Supervisor */}
              {previewOrder.assigned_supervisor_name && (
                <div className="flex items-center gap-2 text-sm">
                  <UserCheck className="h-4 w-4" />
                  <span>Assigned Supervisor: <strong>{previewOrder.assigned_supervisor_name}</strong></span>
                </div>
              )}

              {/* Items */}
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Taxable</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewOrder.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.description}</TableCell>
                        <TableCell>{it.quantity}</TableCell>
                        <TableCell>{it.taxable ? "Yes" : "No"}</TableCell>
                        <TableCell>{inr(it.unit_price)}</TableCell>
                        <TableCell className="text-right">{inr(it.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Comments */}
              {previewOrder.comments && (
                <div className="rounded border p-3">
                  <p className="font-semibold mb-1">Comments</p>
                  <p className="text-sm">{previewOrder.comments}</p>
                </div>
              )}

              {/* Completion section */}
              {previewOrder.status === "Completed" || previewOrder.status === "Closed" ? (
                <div className="rounded border p-3">
                  <p className="font-semibold mb-2">Completion / Acknowledgement</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p>Completed Date: {previewOrder.completed_date ?? "—"}</p>
                    <p>Completed By: {previewOrder.completed_by_name ?? "—"}</p>
                    {previewOrder.customer_acknowledgement && (
                      <p className="col-span-2">Customer Acknowledgement: {previewOrder.customer_acknowledgement}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-dashed p-3 text-center text-sm text-muted-foreground">
                  Completion and acknowledgement fields will be filled when the work order is completed.
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleWhatsAppSend(previewOrder)}>
                  <Send className="mr-2 h-4 w-4" /> Send WhatsApp
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
