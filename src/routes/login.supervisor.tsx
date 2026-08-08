import { createFileRoute, redirect } from "@tanstack/react-router";
import { RoleLoginPortal, ROLE_DASHBOARD } from "@/components/RolePortal";
import { authStore } from "@/lib/auth-store";

export const Route = createFileRoute("/login/supervisor")({
  head: () => ({
    meta: [
      { title: "Supervisor Login — Meditrust ERP" },
      {
        name: "description",
        content:
          "Supervisor sign-in portal: raise PRs, upload quotations, gate passes and site records.",
      },
      { property: "og:title", content: "Supervisor Login — Meditrust ERP" },
      { property: "og:description", content: "Sign in to the Supervisor site-operations portal." },
    ],
  }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const s = authStore.getState();
    if (s.isAuthenticated && s.role) throw redirect({ to: ROLE_DASHBOARD[s.role] });
  },
  component: () => <RoleLoginPortal role="Supervisor" />,
});
