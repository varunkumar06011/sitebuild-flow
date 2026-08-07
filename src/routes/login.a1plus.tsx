import { createFileRoute, redirect } from "@tanstack/react-router";
import { RoleLoginPortal, ROLE_DASHBOARD } from "@/components/RolePortal";
import { authStore } from "@/lib/auth-store";

export const Route = createFileRoute("/login/a1plus")({
  head: () => ({
    meta: [
      { title: "A1+ Login — Meditrust ERP" },
      {
        name: "description",
        content: "A1+ sign-in portal: final approval authority and full system control.",
      },
      { property: "og:title", content: "A1+ Login — Meditrust ERP" },
      { property: "og:description", content: "Sign in to the A1+ head administrator portal." },
    ],
  }),
  beforeLoad: () => {
    const s = authStore.getState();
    if (s.isAuthenticated && s.role) throw redirect({ to: ROLE_DASHBOARD[s.role] });
  },
  component: () => <RoleLoginPortal role="A1+" />,
});
