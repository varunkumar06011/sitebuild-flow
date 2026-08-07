import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { fetchVendors, createVendor, updateVendor } from "@/lib/api/vendors";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Plus, Search, Building2, Pencil } from "lucide-react";

export const Route = createFileRoute("/vendors")({
  head: () => ({
    meta: [
      { title: "Vendor Management — Meditrust ERP" },
      {
        name: "description",
        content: "Manage vendor master data: names, GST, addresses, contacts.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: VendorsPage,
});

function VendorsPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: "",
    gst_number: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    phone: "",
    email: "",
  });
  const [saving, setSaving] = useState(false);

  const canManage = role !== "Supervisor";

  const { data: vendorData } = useQuery({
    queryKey: ["vendors", search],
    queryFn: () => fetchVendors({ data: search ? { search } : {} }),
  });
  const vendors = vendorData?.data ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", gst_number: "", address: "", city: "", state: "", pincode: "", phone: "", email: "" });
    setDialogOpen(true);
  };

  const openEdit = (v: any) => {
    setEditing(v);
    setForm({
      name: v.name ?? "",
      gst_number: v.gst_number ?? "",
      address: v.address ?? "",
      city: v.city ?? "",
      state: v.state ?? "",
      pincode: v.pincode ?? "",
      phone: v.phone ?? "",
      email: v.email ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        gst_number: form.gst_number.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      };

      if (editing) {
        const result = await updateVendor({ data: { id: editing.id, ...payload } });
        if (result.success) {
          toast.success("Vendor updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["vendors"] });
        } else {
          toast.error(result.error ?? "Failed to update vendor");
        }
      } else {
        const result = await createVendor({ data: payload });
        if (result.success) {
          toast.success("Vendor created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["vendors"] });
        } else {
          toast.error(result.error ?? "Failed to create vendor");
        }
      }
    } catch {
      toast.error("Failed to save vendor");
    }
    setSaving(false);
  };

  return (
    <AppShell title="Vendor management" subtitle="Master vendor database with GST and contact details">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search vendors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 pl-9"
              />
            </div>
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 size-4" /> Add vendor
            </Button>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-semibold">Name</th>
                <th className="pb-2 font-semibold">GST</th>
                <th className="pb-2 font-semibold">City</th>
                <th className="pb-2 font-semibold">Phone</th>
                <th className="pb-2 font-semibold">Email</th>
                {canManage && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vendors.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="py-8 text-center text-muted-foreground">
                    No vendors found.
                  </td>
                </tr>
              )}
              {vendors.map((v: any) => (
                <tr key={v.id} className="align-middle">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 text-muted-foreground" />
                      <span className="font-medium">{v.name}</span>
                    </div>
                  </td>
                  <td className="py-3 font-mono text-xs text-muted-foreground">{v.gst_number ?? "—"}</td>
                  <td className="py-3 text-muted-foreground">
                    {v.city ? `${v.city}, ${v.state ?? ""}` : "—"}
                  </td>
                  <td className="py-3 text-muted-foreground">{v.phone ?? "—"}</td>
                  <td className="py-3 text-muted-foreground">{v.email ?? "—"}</td>
                  {canManage && (
                    <td className="py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(v)}>
                        <Pencil className="size-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit vendor" : "Add vendor"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update vendor details" : "Enter vendor master data"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vname">Name *</Label>
              <Input id="vname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vgst">GST number</Label>
                <Input id="vgst" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vphone">Phone</Label>
                <Input id="vphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vaddr">Address</Label>
              <Input id="vaddr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vcity">City</Label>
                <Input id="vcity" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vstate">State</Label>
                <Input id="vstate" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vpin">Pincode</Label>
                <Input id="vpin" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vemail">Email</Label>
              <Input id="vemail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
