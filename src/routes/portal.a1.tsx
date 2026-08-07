// A1 role portal landing page describing senior approval authority and workflow.
import { createFileRoute } from "@tanstack/react-router";
import { RolePortalLanding } from "@/components/RolePortal";

export const Route = createFileRoute("/portal/a1")({
  head: () => ({
    meta: [
      { title: "A1 Portal — Meditrust ERP" },
      {
        name: "description",
        content:
          "A1 portal: approve requests above the administrator limit, override project decisions and view organization reports.",
      },
      { property: "og:title", content: "A1 Portal — Meditrust ERP" },
      {
        property: "og:description",
        content: "Senior approval authority for ₹50,001 to ₹5,00,000.",
      },
    ],
  }),
  component: () => (
    <RolePortalLanding
      role="A1"
      tagline="Senior approvals and project overrides"
      workflow={[
        "Review escalated requisitions",
        "Approve ₹50,001 – ₹5,00,000",
        "Escalate above ₹5,00,000 to A1+",
        "Override project decisions",
        "Organization-wide reports",
        "Audit trail review",
      ]}
    />
  ),
});
