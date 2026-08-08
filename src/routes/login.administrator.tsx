import { createFileRoute, redirect } from "@tanstack/react-router";
import { RoleLoginPortal, ROLE_DASHBOARD } from "@/components/RolePortal";
import { authStore } from "@/lib/auth-store";

export const Route = createFileRoute("/login/administrator")({
  head: () => ({
    meta: [
      { title: "Administrator Login — Meditrust ERP" },
      {
        name: "description",
        content:
          "Administrator sign-in portal: approvals up to ₹50,000, vendors, finance and reports.",
      },
      { property: "og:title", content: "Administrator Login — Meditrust ERP" },
      { property: "og:description", content: "Sign in to the Administrator approvals portal." },
    ],
  }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const s = authStore.getState();
    if (s.isAuthenticated && s.role) throw redirect({ to: ROLE_DASHBOARD[s.role] });
  },
  component: () => <RoleLoginPortal role="Administrator" />,
});
