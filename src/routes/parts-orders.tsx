// Parts Order management page — create, list, edit, preview, send via WhatsApp, change status.
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
  fetchPartsOrders,
  createPartsOrder,
  updatePartsOrder,
  updatePartsOrderStatus,
  duplicatePartsOrder,
  buildPartsOrderWhatsAppMessage,
  type PartsOrderRow,
} from "@/lib/api/parts-orders";
import { fetchVendors } from "@/lib/api/vendors";
import { fetchItems } from "@/lib/api/inventory";
import { fetchBlocks } from "@/lib/api/inventory";
import { fetchOrgSettings } from "@/lib/api/settings";
import { WorkCategorySelect, WorkCategoryBadge } from "@/components/WorkCategory";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Package,
  Pencil,
  Eye,
  Copy,
  Send,
  X,
  Loader2,
  AlertCircle,
  FileText,
} from "lucide-react";

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "Received":
    case "Approved":
      return "success";
    case "Sent":
    case "Ordered":
      return "info";
    case "Partially Received":
      return "warning";
    case "Cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const Route = createFileRoute("/parts-orders")({
  head: () => ({
    meta: [
      { title: "Parts Orders — Meditrust ERP" },
      {
        name: "description",
        content: "Create and manage parts orders for materials and equipment.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: PartsOrdersPage,
});

const STATUS_OPTIONS = ["Draft", "Sent", "Approved", "Ordered", "Partially Received", "Received", "Cancelled"] as const;
const ORDER_TYPES = ["Stock Order", "Project Requirement", "Emergency Requirement", "Replacement", "Other"] as const;

type ItemRow = {
  item_id: string | null;
  item_name: string;
  part_number: string;
  description: string;
  quantity: string;
  unit: string;
  required_date: string;
};

function emptyItem(): ItemRow {
  return { item_id: null, item_name: "", part_number: "", description: "", quantity: "", unit: "", required_date: "" };
}

function PartsOrdersPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const canEdit = role === "Administrator" || role === "A1" || role === "A1+";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [workCatFilter, setWorkCatFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PartsOrderRow | null>(null);
  const [previewOrder, setPreviewOrder] = useState<PartsOrderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  // Form state
  const [form, setForm] = useState({
    block_id: "",
    project_name: "",
    site_address: "",
    vendor_id: "",
    order_type: "Project Requirement" as string,
    requested_delivery_date: "",
    delivery_address: "",
    delivery_contact: "",
    delivery_phone: "",
    shipping_method: "",
    shipping_account: "",
    department: "",
    comments: "",
    work_category: "uncategorized",
  });
  const [items, setItems] = useState<ItemRow[]>([emptyItem()]);

  // Queries
  const { data: ordersData, isLoading, isError, error } = useQuery({
    queryKey: ["partsOrders", search, statusFilter, workCatFilter],
    queryFn: () => fetchPartsOrders({ data: { search: search || undefined, status: statusFilter !== "all" ? statusFilter : undefined, workCategory: workCatFilter !== "all" ? workCatFilter : undefined } as any }),
  });

  const { data: vendorsData } = useQuery({
    queryKey: ["vendors", "all"],
    queryFn: () => fetchVendors({ data: { limit: 200 } }),
  });

  const { data: itemsData } = useQuery({
    queryKey: ["inventoryItems", itemSearch],
    queryFn: () => fetchItems({ data: { search: itemSearch || undefined } as any }),
    enabled: !!itemSearch,
  });

  const { data: blocksData } = useQuery({
    queryKey: ["blocks"],
    queryFn: () => fetchBlocks({ data: {} }),
  });

  const { data: orgData } = useQuery({
    queryKey: ["orgSettings"],
    queryFn: () => fetchOrgSettings(),
  });

  const org = orgData?.success ? orgData.data : null;
  const vendors = vendorsData?.data ?? [];
  const blocks = blocksData?.data ?? [];
  const inventoryItems = itemsData?.data ?? [];
  const orders = ordersData?.data ?? [];

  // Vendor selection auto-fills
  const selectedVendor = vendors.find((v: any) => v.id === form.vendor_id);

  function openCreate() {
    setEditing(null);
    setForm({
      block_id: "",
      project_name: "",
      site_address: "",
      vendor_id: "",
      order_type: "Project Requirement",
      requested_delivery_date: "",
      delivery_address: "",
      delivery_contact: "",
      delivery_phone: "",
      shipping_method: "",
      shipping_account: "",
      department: "",
      comments: "",
      work_category: "uncategorized",
    });
    setItems([emptyItem()]);
    setDialogOpen(true);
  }

  function openEdit(order: PartsOrderRow) {
    setEditing(order);
    setForm({
      block_id: order.block_id ?? "",
      project_name: order.project_name ?? "",
      site_address: order.site_address ?? "",
      vendor_id: order.vendor_id ?? "",
      order_type: order.order_type,
      requested_delivery_date: order.requested_delivery_date ?? "",
      delivery_address: order.delivery_address ?? "",
      delivery_contact: order.delivery_contact ?? "",
      delivery_phone: order.delivery_phone ?? "",
      shipping_method: order.shipping_method ?? "",
      shipping_account: order.shipping_account ?? "",
      department: order.department ?? "",
      comments: order.comments ?? "",
      work_category: order.work_category ?? "uncategorized",
    });
    setItems(order.items.map((it) => ({
      item_id: it.item_id,
      item_name: it.item_name,
      part_number: it.part_number ?? "",
      description: it.description ?? "",
      quantity: String(it.quantity),
      unit: it.unit ?? "",
      required_date: it.required_date ?? "",
    })));
    setDialogOpen(true);
  }

  function addItem() {
    setItems([...items, emptyItem()]);
  }

  function removeItem(idx: number) {
    if (items.length === 1) {
      toast.error("At least one item is required");
      return;
    }
    setItems(items.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: keyof ItemRow, value: string) {
    setItems(items.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function selectInventoryItem(idx: number, itemId: string) {
    const invItem = inventoryItems.find((i: any) => i.item_id === itemId);
    if (invItem) {
      setItems(items.map((it, i) => i === idx ? {
        ...it,
        item_id: invItem.item_id,
        item_name: invItem.item_name,
        unit: invItem.unit_of_measure ?? "",
      } : it));
    }
  }

  function validate(): string | null {
    if (!form.project_name.trim() && !form.block_id) return "Project is required";
    if (items.length === 0) return "At least one item is required";
    for (const [i, it] of items.entries()) {
      if (!it.item_name.trim()) return `Item ${i + 1}: Item name is required`;
      const qty = parseFloat(it.quantity);
      if (!qty || qty <= 0) return `Item ${i + 1}: Valid quantity is required`;
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
        site_address: form.site_address || undefined,
        vendor_id: form.vendor_id || null,
        order_type: form.order_type as any,
        requested_delivery_date: form.requested_delivery_date || null,
        delivery_address: form.delivery_address || undefined,
        delivery_contact: form.delivery_contact || undefined,
        delivery_phone: form.delivery_phone || undefined,
        shipping_method: form.shipping_method || undefined,
        shipping_account: form.shipping_account || undefined,
        department: form.department || undefined,
        comments: form.comments || undefined,
        work_category: form.work_category,
        items: items.map((it) => ({
          item_id: it.item_id || undefined,
          item_name: it.item_name,
          part_number: it.part_number || undefined,
          description: it.description || undefined,
          quantity: parseFloat(it.quantity),
          unit: it.unit || undefined,
          required_date: it.required_date || null,
        })),
      };

      let result: any;
      if (editing) {
        result = await updatePartsOrder({ data: { id: editing.id, ...payload } });
      } else {
        result = await createPartsOrder({ data: payload });
      }

      if (!result.success) {
        toast.error(result.error ?? "Failed to save parts order");
        setSaving(false);
        return;
      }

      // Update status to "Sent" if WhatsApp send requested
      if (sendWhatsApp && result.id) {
        await updatePartsOrderStatus({ data: { id: result.id, status: "Sent" } });
      }

      toast.success(editing ? "Parts order updated" : `Parts order ${result.order_number ?? ""} created`);

      queryClient.invalidateQueries({ queryKey: ["partsOrders"] });

      if (sendWhatsApp) {
        // Build WhatsApp message from the saved order
        const orderRow: PartsOrderRow = {
          id: result.id ?? editing?.id ?? "",
          order_number: result.order_number ?? editing?.order_number ?? "",
          order_date: new Date().toISOString(),
          status: "Sent",
          order_type: form.order_type as any,
          block_id: form.block_id || null,
          project_name: form.project_name || null,
          site_address: form.site_address || null,
          vendor_id: form.vendor_id || null,
          vendor_name: selectedVendor?.name ?? null,
          vendor_phone: selectedVendor?.phone ?? null,
          vendor_email: selectedVendor?.email ?? null,
          vendor_address: selectedVendor?.address ?? null,
          vendor_gst: selectedVendor?.gst_number ?? null,
          requested_delivery_date: form.requested_delivery_date || null,
          delivery_address: form.delivery_address || null,
          delivery_contact: form.delivery_contact || null,
          delivery_phone: form.delivery_phone || null,
          shipping_method: form.shipping_method || null,
          shipping_account: form.shipping_account || null,
          requested_by: "",
          requested_by_name: null,
          department: form.department || null,
          comments: form.comments || null,
          pdf_path: null,
          work_category: form.work_category ?? "uncategorized",
          items: items.map((it) => ({
            id: "",
            item_id: it.item_id,
            item_name: it.item_name,
            part_number: it.part_number || null,
            description: it.description || null,
            quantity: parseFloat(it.quantity),
            unit: it.unit || null,
            required_date: it.required_date || null,
            sort_order: 0,
          })),
          created_at: "",
          updated_at: "",
        };
        const message = buildPartsOrderWhatsAppMessage(orderRow);
        const phone = selectedVendor?.phone?.replace(/[^0-9]/g, "") ?? "";
        if (!phone) {
          toast.warning("Order saved, but no vendor phone number to send WhatsApp.");
        } else {
          const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
          window.open(waUrl, "_blank");
        }
      }

      setDialogOpen(false);
      setSaving(false);
    } catch (err) {
      toast.error("Unable to save parts order. Please try again.");
      setSaving(false);
    }
  }

  async function handleDuplicate(order: PartsOrderRow) {
    const result = await duplicatePartsOrder({ data: { id: order.id } });
    if (result.success) {
      toast.success(`Duplicated as ${result.order_number}`);
      queryClient.invalidateQueries({ queryKey: ["partsOrders"] });
    } else {
      toast.error(result.error ?? "Failed to duplicate");
    }
  }

  async function handleStatusChange(order: PartsOrderRow, newStatus: string) {
    const result = await updatePartsOrderStatus({ data: { id: order.id, status: newStatus as any } });
    if (result.success) {
      toast.success(`Status changed to ${newStatus}`);
      queryClient.invalidateQueries({ queryKey: ["partsOrders"] });
    } else {
      toast.error(result.error ?? "Failed to change status");
    }
  }

  function handleWhatsAppSend(order: PartsOrderRow) {
    const phone = order.vendor_phone?.replace(/[^0-9]/g, "") ?? "";
    if (!phone) {
      toast.error("No vendor phone number on this order. Add a phone number to send via WhatsApp.");
      return;
    }
    const message = buildPartsOrderWhatsAppMessage(order);
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank");
  }

  return (
    <AppShell title="Parts Orders" subtitle="Request materials, parts, and equipment from vendors">
      {isError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load parts orders: {error?.message ?? "Unknown error"}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order number, project, vendor..."
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
            <Plus className="mr-2 h-4 w-4" /> New Parts Order
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Work</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Req. Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  No parts orders yet. Click "New Parts Order" to create one.
                </TableCell>
              </TableRow>
            )}
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.order_number}</TableCell>
                <TableCell>{new Date(order.order_date).toLocaleDateString()}</TableCell>
                <TableCell>{order.project_name ?? "—"}</TableCell>
                <TableCell>{order.vendor_name ?? "—"}</TableCell>
                <TableCell><WorkCategoryBadge category={order.work_category} /></TableCell>
                <TableCell>{order.items.length}</TableCell>
                <TableCell>{order.requested_delivery_date ? new Date(order.requested_delivery_date).toLocaleDateString() : "—"}</TableCell>
                <TableCell>
                  <StatusPill tone={statusTone(order.status)}>{order.status}</StatusPill>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setPreviewOrder(order)} title="View">
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && order.status !== "Received" && order.status !== "Cancelled" && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(order)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button variant="ghost" size="icon" onClick={() => handleDuplicate(order)} title="Duplicate">
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => handleWhatsAppSend(order)} title="Send WhatsApp">
                      <Send className="h-4 w-4" />
                    </Button>
                    {canEdit && (
                      <Select onValueChange={(v) => handleStatusChange(order, v)}>
                        <SelectTrigger className="h-8 w-[140px]">
                          <SelectValue placeholder="Change Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
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
            <DialogTitle>{editing ? `Edit ${editing.order_number}` : "New Parts Order"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update parts order details" : "Create a new parts order for materials or equipment"}
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

          {/* Project & Vendor selection */}
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
              <Input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} placeholder="Project name" />
            </div>
            <div>
              <Label>Site Address</Label>
              <Input value={form.site_address} onChange={(e) => setForm({ ...form, site_address: e.target.value })} placeholder="Site address" />
            </div>
            <div>
              <Label>Vendor / Supplier</Label>
              <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVendor && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedVendor.phone} | {selectedVendor.address}, {selectedVendor.city}
                </p>
              )}
            </div>
            <div>
              <Label>Order Type</Label>
              <Select value={form.order_type} onValueChange={(v) => setForm({ ...form, order_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Department" />
            </div>
            <div>
              <Label>Work Category *</Label>
              <WorkCategorySelect
                value={form.work_category}
                onChange={(val) => setForm({ ...form, work_category: val })}
                placeholder="Select work category..."
              />
            </div>
          </div>

          {/* Delivery info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <Label>Requested Delivery Date</Label>
              <Input type="date" value={form.requested_delivery_date} onChange={(e) => setForm({ ...form, requested_delivery_date: e.target.value })} />
            </div>
            <div>
              <Label>Delivery Address</Label>
              <Input value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} placeholder="Delivery address" />
            </div>
            <div>
              <Label>Delivery Contact Person</Label>
              <Input value={form.delivery_contact} onChange={(e) => setForm({ ...form, delivery_contact: e.target.value })} placeholder="Contact person" />
            </div>
            <div>
              <Label>Delivery Contact Phone</Label>
              <Input value={form.delivery_phone} onChange={(e) => setForm({ ...form, delivery_phone: e.target.value })} placeholder="Phone" />
            </div>
            <div>
              <Label>Shipping Method</Label>
              <Input value={form.shipping_method} onChange={(e) => setForm({ ...form, shipping_method: e.target.value })} placeholder="Shipping method" />
            </div>
            <div>
              <Label>Shipping Account</Label>
              <Input value={form.shipping_account} onChange={(e) => setForm({ ...form, shipping_account: e.target.value })} placeholder="Shipping account" />
            </div>
          </div>

          {/* Items table */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <Label>Parts Request Items</Label>
              <Button variant="outline" size="sm" onClick={addItem}><Plus className="mr-1 h-3 w-3" /> Add Item</Button>
            </div>

            {/* Inventory search */}
            <div className="mb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search inventory to auto-fill items..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {inventoryItems.length > 0 && (
                <div className="mt-1 max-h-32 overflow-y-auto rounded border p-1">
                  {inventoryItems.slice(0, 10).map((it: any) => (
                    <button
                      key={it.item_id}
                      className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-accent"
                      onClick={() => {
                        setItems([...items, {
                          item_id: it.item_id,
                          item_name: it.item_name,
                          part_number: "",
                          description: it.category_path ?? "",
                          quantity: "",
                          unit: it.unit_of_measure ?? "",
                          required_date: "",
                        }]);
                        setItemSearch("");
                      }}
                    >
                      <span>{it.item_name}</span>
                      <span className="text-xs text-muted-foreground">Stock: {it.current_stock} {it.unit_of_measure ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px]">Item</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="min-w-[100px]">Part No.</TableHead>
                    <TableHead className="min-w-[200px]">Description</TableHead>
                    <TableHead className="w-[80px]">Unit</TableHead>
                    <TableHead className="w-[120px]">Req. Date</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Input value={it.item_name} onChange={(e) => updateItem(idx, "item_name", e.target.value)} placeholder="Item name" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} placeholder="0" />
                      </TableCell>
                      <TableCell>
                        <Input value={it.part_number} onChange={(e) => updateItem(idx, "part_number", e.target.value)} placeholder="Part no." />
                      </TableCell>
                      <TableCell>
                        <Input value={it.description} onChange={(e) => updateItem(idx, "description", e.target.value)} placeholder="Description" />
                      </TableCell>
                      <TableCell>
                        <Input value={it.unit} onChange={(e) => updateItem(idx, "unit", e.target.value)} placeholder="Unit" />
                      </TableCell>
                      <TableCell>
                        <Input type="date" value={it.required_date} onChange={(e) => updateItem(idx, "required_date", e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                          <X className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Comments */}
          <div className="mb-4">
            <Label>Order Comments / Special Instructions</Label>
            <Textarea
              value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })}
              placeholder="Special delivery instructions, material specifications, urgent requirements..."
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
            <DialogTitle>Parts Order — {previewOrder?.order_number}</DialogTitle>
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

              {/* Order info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-semibold">Parts Order Number</p>
                  <p>{previewOrder.order_number}</p>
                </div>
                <div>
                  <p className="font-semibold">Date</p>
                  <p>{new Date(previewOrder.order_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="font-semibold">Project</p>
                  <p>{previewOrder.project_name ?? "—"}</p>
                </div>
                <div>
                  <p className="font-semibold">Order Type</p>
                  <p>{previewOrder.order_type}</p>
                </div>
              </div>

              {/* Vendor info */}
              <div className="rounded border p-3">
                <p className="font-semibold mb-1">Vendor</p>
                <p className="text-sm">{previewOrder.vendor_name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">{previewOrder.vendor_address ?? ""}</p>
                <p className="text-sm text-muted-foreground">Phone: {previewOrder.vendor_phone ?? "—"} | Email: {previewOrder.vendor_email ?? "—"}</p>
                {previewOrder.vendor_gst && <p className="text-sm text-muted-foreground">GST: {previewOrder.vendor_gst}</p>}
              </div>

              {/* Delivery info */}
              <div className="rounded border p-3">
                <p className="font-semibold mb-1">Delivery Information</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <p>Delivery Address: {previewOrder.delivery_address ?? "—"}</p>
                  <p>Contact: {previewOrder.delivery_contact ?? "—"}</p>
                  <p>Phone: {previewOrder.delivery_phone ?? "—"}</p>
                  <p>Req. Date: {previewOrder.requested_delivery_date ? new Date(previewOrder.requested_delivery_date).toLocaleDateString() : "—"}</p>
                </div>
              </div>

              {/* Items */}
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Part No.</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewOrder.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium">{it.item_name}</TableCell>
                        <TableCell>{it.quantity}</TableCell>
                        <TableCell>{it.part_number ?? "—"}</TableCell>
                        <TableCell>{it.description ?? "—"}</TableCell>
                        <TableCell>{it.unit ?? "—"}</TableCell>
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
