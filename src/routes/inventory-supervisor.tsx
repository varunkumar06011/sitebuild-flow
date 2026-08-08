// Inventory material movement route: requires auth and renders the stock in/out/adjustment form.
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
import { Checkbox } from "@/components/ui/checkbox";
import { fetchItems, recordTransaction, fetchBlocks } from "@/lib/api/inventory";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Search, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from "lucide-react";

export const Route = createFileRoute("/inventory-supervisor")({
  head: () => ({
    meta: [
      { title: "Log Material Movement — Meditrust ERP" },
      {
        name: "description",
        content: "Log inventory stock movements: in, out, or adjustment.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: InventorySupervisorPage,
});

// Page for searching inventory items and logging stock in, out, or adjustment transactions.
function InventorySupervisorPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    item_id: "",
    type: "",
    quantity: "",
    block_id: "",
    reference: "",
    remarks: "",
    is_wastage: false,
  });
  const [saving, setSaving] = useState(false);
  const canAdjust = role !== "Supervisor";

  const { data: itemsData } = useQuery({
    queryKey: ["inventory-items", search],
    queryFn: () => fetchItems({ data: search ? { search } : {} }),
  });
  const items = itemsData?.data ?? [];

  const { data: blocksData } = useQuery({
    queryKey: ["inventory-blocks"],
    queryFn: () => fetchBlocks({ data: {} }),
  });
  const blocks = blocksData?.data ?? [];

  const selectedItem = items.find((i: any) => i.item_id === form.item_id);

  // Validates the movement form, submits the transaction, and refreshes the item list on success.
  const handleSubmit = async () => {
    if (!form.item_id) {
      toast.error("Select an item");
      return;
    }
    if (!form.type) {
      toast.error("Select transaction type");
      return;
    }
    if (!form.quantity || Number(form.quantity) <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    setSaving(true);
    try {
      const result = await recordTransaction({
        data: {
          item_id: form.item_id,
          type: form.type as any,
          quantity: Number(form.quantity),
          is_wastage: form.type === "out" ? form.is_wastage : undefined,
          block_id: form.block_id || null,
          reference: form.reference.trim() || undefined,
          remarks: form.remarks.trim() || undefined,
        },
      });
      if (result.success) {
        toast.success("Movement logged");
        setForm({ item_id: "", type: "", quantity: "", block_id: "", reference: "", remarks: "", is_wastage: false });
        queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      } else {
        toast.error(result.error ?? "Failed to log movement");
      }
    } catch {
      toast.error("Failed to log movement");
    }
    setSaving(false);
  };

  return (
    <AppShell title="Log material movement" subtitle="Record stock in / out / adjustment for any inventory item">
      <div className="mx-auto max-w-xl">
        <Card className="p-6">
          <div className="space-y-5">
            {/* Item search + select */}
            <div className="space-y-2">
              <Label htmlFor="isearch">Search item</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="isearch"
                  placeholder="Type item name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="iitem">Item *</Label>
              <Select
                value={form.item_id}
                onValueChange={(val) => setForm({ ...form, item_id: val })}
              >
                <SelectTrigger id="iitem">
                  <SelectValue placeholder="Select item..." />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i: any) => (
                    <SelectItem key={i.item_id} value={i.item_id}>
                      {i.item_name} ({i.unit_of_measure ?? "nos"}) — stock: {i.current_stock}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedItem && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Category: </span>
                  <span className="font-medium">{selectedItem.category_path}</span>
                  <span className="text-muted-foreground"> · Current stock: </span>
                  <span className="font-semibold">{selectedItem.current_stock} {selectedItem.unit_of_measure ?? ""}</span>
                </div>
              )}
            </div>

            {/* Transaction type */}
            <div className="space-y-2">
              <Label htmlFor="itype">Movement type *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "in" })}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors ${
                    form.type === "in"
                      ? "border-success bg-success-soft text-success"
                      : "border-input hover:border-muted-foreground"
                  }`}
                >
                  <ArrowDownToLine className="size-5" />
                  Stock In
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "out" })}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors ${
                    form.type === "out"
                      ? "border-destructive bg-danger-soft text-destructive"
                      : "border-input hover:border-muted-foreground"
                  }`}
                >
                  <ArrowUpFromLine className="size-5" />
                  Stock Out
                </button>
                <button
                  type="button"
                  disabled={!canAdjust}
                  onClick={() => canAdjust && setForm({ ...form, type: "adjustment" })}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors ${
                    !canAdjust
                      ? "cursor-not-allowed border-input opacity-40"
                      : form.type === "adjustment"
                      ? "border-warning bg-warning-soft text-warning-foreground"
                      : "border-input hover:border-muted-foreground"
                  }`}
                >
                  <SlidersHorizontal className="size-5" />
                  Adjust
                  {!canAdjust && <span className="text-[10px] font-normal">Admin only</span>}
                </button>
              </div>
            </div>

            {/* Quantity */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="iqty">Quantity *</Label>
                <Input
                  id="iqty"
                  type="number"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="iblock">Block (optional)</Label>
                <Select
                  value={form.block_id}
                  onValueChange={(val) => setForm({ ...form, block_id: val })}
                >
                  <SelectTrigger id="iblock">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {blocks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Wastage checkbox — only visible when type is 'out' */}
            {form.type === "out" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="iwastage"
                  checked={form.is_wastage}
                  onCheckedChange={(checked) => setForm({ ...form, is_wastage: checked === true })}
                />
                <Label htmlFor="iwastage" className="cursor-pointer text-sm">
                  Mark as wastage / damage
                </Label>
              </div>
            )}

            {/* Reference */}
            <div className="space-y-2">
              <Label htmlFor="iref">Reference (optional)</Label>
              <Input
                id="iref"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="PR number, gate pass number, etc."
              />
            </div>

            {/* Remarks */}
            <div className="space-y-2">
              <Label htmlFor="iremarks">Remarks (optional)</Label>
              <Textarea
                id="iremarks"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Any additional notes..."
                rows={2}
              />
            </div>

            <Button className="w-full" disabled={saving} onClick={handleSubmit}>
              {saving ? "Logging..." : "Log movement"}
            </Button>
          </div>
        </Card>

        {/* Recent items list for context */}
        <Card className="mt-4 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent items
          </p>
          <div className="space-y-1.5">
            {items.slice(0, 5).map((i: any) => (
              <div
                key={i.item_id}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{i.item_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{i.unit_of_measure ?? "nos"}</span>
                  <StatusPill
                    tone={Number(i.current_stock) <= Number(i.reorder_level) ? "danger" : "neutral"}
                  >
                    {i.current_stock}
                  </StatusPill>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">No items found.</p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
