import { createFileRoute } from "@tanstack/react-router";
import { RolePortalLanding } from "@/components/RolePortal";

export const Route = createFileRoute("/portal/supervisor")({
  head: () => ({
    meta: [
      { title: "Supervisor Portal — Meditrust ERP" },
      {
        name: "description",
        content:
          "Supervisor portal for hospital construction: raise requisitions, upload quotations and POs, receive materials, gate passes and site registers.",
      },
      { property: "og:title", content: "Supervisor Portal — Meditrust ERP" },
      {
        property: "og:description",
        content: "Site execution workspace for supervisors — PR to material receipt.",
      },
    ],
  }),
  component: () => (
    <RolePortalLanding
      role="Supervisor"
      tagline="Run the site, raise the paperwork"
      workflow={[
        "Create purchase requisition",
        "Upload vendor quotations",
        "Upload approved PO",
        "Receive materials & update inventory",
        "Upload invoice and documents",
        "Track vendor payment status",
      ]}
    />
  ),
});
