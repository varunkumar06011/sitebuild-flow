import { createFileRoute } from "@tanstack/react-router";
import { InventoryPortal } from "@/components/InventoryPortal";
import { requireAuth } from "@/lib/auth-guards";

export const Route = createFileRoute("/inventory-portal")({
  head: () => ({
    meta: [{ title: "Inventory Portal — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: () => (
    <InventoryPortal
      canAdmin
      title="Inventory Portal"
      subtitle="Manage materials, purchases, usage and ledgers"
    />
  ),
});
