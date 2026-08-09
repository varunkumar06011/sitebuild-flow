import { createFileRoute } from "@tanstack/react-router";
import { InventoryPortal } from "@/components/InventoryPortal";
import { requireAuth } from "@/lib/auth-guards";

export const Route = createFileRoute("/inventory-portal/supervisor")({
  head: () => ({
    meta: [{ title: "Inventory Portal — Supervisor — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: () => (
    <InventoryPortal
      canAdmin={false}
      title="Inventory Portal"
      subtitle="View materials, record purchases and usage, view ledgers"
    />
  ),
});
