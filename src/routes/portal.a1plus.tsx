// A1+ role portal landing page describing final approval authority and full system control.
import { createFileRoute } from "@tanstack/react-router";
import { RolePortalLanding } from "@/components/RolePortal";

export const Route = createFileRoute("/portal/a1plus")({
  head: () => ({
    meta: [
      { title: "A1+ Portal — Meditrust ERP" },
      {
        name: "description",
        content:
          "A1+ head administrator portal: final approval authority above ₹5,00,000 and full system control.",
      },
      { property: "og:title", content: "A1+ Portal — Meditrust ERP" },
      {
        property: "og:description",
        content: "Final approvals and full control of the construction ERP.",
      },
    ],
  }),
  component: () => (
    <RolePortalLanding
      role="A1+"
      tagline="Final authority, full system control"
      workflow={[
        "Final approval above ₹5,00,000",
        "Set organization approval rules",
        "Override any decision",
        "Full module and user control",
        "Immutable audit oversight",
        "Executive reporting",
      ]}
    />
  ),
});
