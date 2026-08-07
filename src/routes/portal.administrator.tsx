import { createFileRoute } from "@tanstack/react-router";
import { RolePortalLanding } from "@/components/RolePortal";

export const Route = createFileRoute("/portal/administrator")({
  head: () => ({
    meta: [
      { title: "Administrator Portal — Meditrust ERP" },
      {
        name: "description",
        content:
          "Administrator portal: review and approve requests up to ₹50,000, manage vendors, finance, users and reports.",
      },
      { property: "og:title", content: "Administrator Portal — Meditrust ERP" },
      {
        property: "og:description",
        content: "Approvals within limit, vendor and finance management.",
      },
    ],
  }),
  component: () => (
    <RolePortalLanding
      role="Administrator"
      tagline="Approve within limit, keep procurement moving"
      workflow={[
        "Review requisitions & quotations",
        "Approve up to ₹50,000",
        "Escalate higher value to A1",
        "Manage vendors",
        "Finance & payment tracking",
        "Reports and user management",
      ]}
    />
  ),
});
