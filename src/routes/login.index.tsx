import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { ROLES, ROLE_SUMMARY } from "@/lib/erp-data";
import { authStore } from "@/lib/auth-store";
import {
  ROLE_ICONS,
  ROLE_THEME,
  ROLE_LOGIN_PATH,
  ROLE_DASHBOARD,
  useRedirectIfAuthenticated,
} from "@/components/RolePortal";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/login/")({
  head: () => ({
    meta: [
      { title: "Choose your login portal — Meditrust ERP" },
      {
        name: "description",
        content:
          "Pick your role portal: Supervisor, Administrator, A1 or A1+ sign-in for the hospital construction ERP.",
      },
      { property: "og:title", content: "Choose your login portal — Meditrust ERP" },
      {
        property: "og:description",
        content: "Separate sign-in portals for each ERP role.",
      },
    ],
  }),
  beforeLoad: () => {
    const state = authStore.getState();
    if (state.isAuthenticated && state.role) {
      throw redirect({ to: ROLE_DASHBOARD[state.role] });
    }
  },
  component: LoginChooser,
});

function LoginChooser() {
  useRedirectIfAuthenticated();
  return (
    <div className="min-h-screen bg-background px-5 py-14 font-sans">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold tracking-tight">Choose your login portal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Each role signs in through its own portal and only sees its own sections.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {ROLES.map((role) => {
            const Icon = ROLE_ICONS[role];
            const theme = ROLE_THEME[role];
            return (
              <Link key={role} to={ROLE_LOGIN_PATH[role]}>
                <Card className={`h-full border-2 p-5 transition-colors hover:${theme.ring}`}>
                  <span
                    className={`flex size-10 items-center justify-center rounded-xl ${theme.soft}`}
                  >
                    <Icon className={`size-5 ${theme.accent}`} />
                  </span>
                  <p className="mt-3 text-base font-bold">{role}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{ROLE_SUMMARY[role].limit}</p>
                  <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    Sign in <ArrowRight className="size-3.5" />
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
